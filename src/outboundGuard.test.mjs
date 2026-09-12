import assert from 'node:assert/strict';
import test from 'node:test';
import { guardedFetch } from '../server/providers/common/outbound-guard.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const okFetch = async () => new Response('ok', { status: 200 });

test('guardedFetch denies private IPv4 and IPv6 destinations', async () => {
  for (const address of ['192.168.1.1', '::1']) {
    await assert.rejects(
      guardedFetch('https://upstream.example/data', {
        lookupImpl: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
        fetchImpl: okFetch,
      }),
      /forbidden address/,
    );
  }
});

test('guardedFetch denies DNS answers that include a rebinding address', async () => {
  let called = false;
  await assert.rejects(
    guardedFetch('https://upstream.example/data', {
      lookupImpl: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
      fetchImpl: async () => { called = true; return new Response('unexpected'); },
    }),
    /forbidden address/,
  );
  assert.equal(called, false);
});

test('guardedFetch revalidates redirects before connecting', async () => {
  let calls = 0;
  await assert.rejects(
    guardedFetch('https://public.example/start', {
      lookupImpl: async (hostname) => [{
        address: hostname === 'private.example' ? '10.0.0.1' : '93.184.216.34',
        family: 4,
      }],
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 302, headers: { location: 'https://private.example/nope' } });
      },
    }),
    /forbidden address/,
  );
  assert.equal(calls, 1);
});

test('guardedFetch caps redirects', async () => {
  await assert.rejects(
    guardedFetch('https://public.example/start', {
      lookupImpl: publicLookup,
      maxRedirects: 1,
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: '/again' } }),
    }),
    /redirect limit/,
  );
});

test('guardedFetch applies its timeout to the injected transport', async () => {
  await assert.rejects(
    guardedFetch('https://public.example/data', {
      lookupImpl: publicLookup,
      timeoutMs: 5,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    }),
    /timed out/,
  );
});

test('guardedFetch enforces a declared byte cap', async () => {
  await assert.rejects(
    guardedFetch('https://public.example/data', {
      lookupImpl: publicLookup,
      maxBytes: 2,
      fetchImpl: async () => new Response('too large', { headers: { 'content-length': '9' } }),
    }),
    /byte cap/,
  );
});

test('guardedFetch returns legitimate responses and pins their DNS answer', async () => {
  let seenAddresses;
  const response = await guardedFetch('https://public.example/data', {
    lookupImpl: publicLookup,
    fetchImpl: async (_url, options) => {
      seenAddresses = options.resolvedAddresses;
      return new Response('legitimate');
    },
  });
  assert.equal(await response.text(), 'legitimate');
  assert.deepEqual(seenAddresses, [{ address: '93.184.216.34', family: 4 }]);
});
