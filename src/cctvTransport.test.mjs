import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CCTV_FRAME_MAX_BYTES,
  fetchCctvResponse,
  fetchCctvFrame,
} from '../server/providers/common/cctv-transport.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function imageResponse(body = Uint8Array.from([1, 2, 3])) {
  return new Response(body, { headers: { 'Content-Type': 'image/jpeg' } });
}

test('CCTV catalog destinations reject private IPv4 and IPv6 addresses', async () => {
  for (const address of ['127.0.0.1', '10.0.0.5', '::1', 'fc00::1']) {
    await assert.rejects(
      fetchCctvResponse('https://camera.example/frame.jpg', {
        lookupImpl: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
        fetchImpl: async () => imageResponse(),
      }),
      /forbidden address/,
    );
  }
});

test('CCTV denies DNS rebinding before it asks the transport to connect', async () => {
  let calls = 0;
  await assert.rejects(
    fetchCctvResponse('https://camera.example/frame.jpg', {
      lookupImpl: async () => [{ address: '192.168.1.4', family: 4 }],
      fetchImpl: async () => { calls += 1; return imageResponse(); },
    }),
    /forbidden address/,
  );
  assert.equal(calls, 0);
});

test('CCTV revalidates redirect destinations and rejects private hops', async () => {
  let calls = 0;
  await assert.rejects(
    fetchCctvResponse('https://camera.example/first.jpg', {
      lookupImpl: async (hostname) => [{
        address: hostname === 'private.example' ? '127.0.0.1' : '93.184.216.34',
        family: 4,
      }],
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 302, headers: { Location: 'http://private.example/secret' } });
      },
    }),
    /forbidden address/,
  );
  assert.equal(calls, 1);
});

test('CCTV caps redirect chains at three hops', async () => {
  let calls = 0;
  await assert.rejects(
    fetchCctvResponse('https://camera.example/0.jpg', {
      lookupImpl: publicLookup,
      fetchImpl: async (url) => {
        calls += 1;
        const step = Number(new URL(url).pathname.match(/\d+/)?.[0] || 0);
        return new Response(null, { status: 302, headers: { Location: `/step-${step + 1}.jpg` } });
      },
    }),
    /redirect limit/,
  );
  assert.equal(calls, 4);
});

test('CCTV transport aborts a stalled fetch at its timeout', async () => {
  let signal;
  await assert.rejects(
    fetchCctvResponse('https://camera.example/frame.jpg', {
      lookupImpl: publicLookup,
      timeoutMs: 20,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        signal = options.signal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    }),
    /timed out/,
  );
  assert.equal(signal?.aborted, true);
});

test('CCTV transport forwards client disconnects to the upstream request', async () => {
  const client = new AbortController();
  let signal;
  let started;
  const startedUpstream = new Promise((resolve) => { started = resolve; });
  const pending = fetchCctvResponse('https://camera.example/frame.jpg', {
    lookupImpl: publicLookup,
    signal: client.signal,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      signal = options.signal;
      started();
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  await startedUpstream;
  client.abort(new Error('client disconnected'));
  await assert.rejects(pending, /client disconnected/);
  assert.equal(signal?.aborted, true);
});

test('CCTV frame reads stop at the byte cap', async () => {
  const result = await fetchCctvFrame('https://camera.example/frame.jpg', {
    lookupImpl: publicLookup,
    maxBytes: 3,
    fetchImpl: async () => imageResponse(Uint8Array.from([1, 2, 3, 4])),
  });
  assert.equal(result, null);
  assert.ok(CCTV_FRAME_MAX_BYTES > 0);
});

test('CCTV media forwards Range requests and preserves a legitimate stream', async () => {
  let request;
  const upstream = await fetchCctvResponse('https://camera.example/live.mp4', {
    lookupImpl: publicLookup,
    headers: { Range: 'bytes=100-199' },
    fetchImpl: async (_url, options) => {
      request = options;
      return new Response(Uint8Array.from([7, 8]), {
        status: 206,
        headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 100-101/200' },
      });
    },
  });
  assert.equal(request.headers.Range, 'bytes=100-199');
  assert.deepEqual(request.resolvedAddresses, [{ address: '93.184.216.34', family: 4 }]);
  assert.equal(upstream.status, 206);
  assert.deepEqual(Buffer.from(await upstream.arrayBuffer()), Buffer.from([7, 8]));
});

test('operator-configured CCTV sources may use a private camera address', async () => {
  const upstream = await fetchCctvResponse('http://camera.lan/frame.jpg', {
    allowPrivateAddress: true,
    lookupImpl: async () => [{ address: '192.168.0.30', family: 4 }],
    fetchImpl: async () => imageResponse(),
  });
  assert.equal(upstream.ok, true);
});
