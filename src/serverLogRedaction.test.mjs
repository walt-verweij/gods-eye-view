import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import test from 'node:test';
import { firmsProxy } from '../server/providers/firms.js';
import { gbfsProxy } from '../server/providers/gbfs.js';

const secret = 'https://fixture.invalid/path?token=fixture-secret-value';

function install(plugin) {
  let route;
  plugin.configureServer({
    middlewares: {
      use(_path, handler) {
        route = handler;
      },
    },
  });
  return async (url = '/', method = 'GET') => {
    const response = {
      headersSent: false,
      writeHead(status, headers) {
        Object.assign(this, { status, headers, headersSent: true });
      },
      end(body) {
        this.body = body;
      },
    };
    await route({ url, method }, response);
    return response;
  };
}

function environment(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}

test('GBFS rejects userinfo and logs a fixed upstream failure code', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error(secret); });
  const request = install(gbfsProxy());

  const userinfo = await request(
    '/' + encodeURIComponent('https://client:fixture-secret-value@gbfs.lyft.com/station_status.json'),
  );
  assert.equal(userinfo.status, 400);
  assert.deepEqual(JSON.parse(userinfo.body), { error: 'GBFS targets must not include userinfo' });

  const failed = await request('/' + encodeURIComponent('https://gbfs.lyft.com/station_status.json'));
  assert.equal(failed.status, 502);
  assert.deepEqual(logs, ['[GBFS Proxy] GBFS_UPSTREAM_REQUEST_FAILED']);
  assert.doesNotMatch(logs.join('\n'), /fixture-secret-value|fixture\.invalid/);
});

test('OpenSky OAuth and invalid mode warnings omit upstream and configuration values', async (t) => {
  const logs = [];
  environment(t, {
    OPENSKY_AUTH_MODE: 'fixture-secret-value',
    OPENSKY_CLIENT_ID: 'fixture-client',
    OPENSKY_CLIENT_SECRET: 'fixture-secret-value',
  });
  t.mock.method(console, 'warn', (...args) => logs.push(args.join(' ')));
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    error: 'invalid_client',
    error_description: secret,
  }, { status: 401 }));
  const opensky = await import(`../server/providers/aircraft/opensky.js?log-redaction=${Date.now()}`);

  assert.equal(await opensky.getOpenSkyToken(), null);
  const request = install(opensky.openSkyProxy());
  await request('/?lat=30&lon=-97');
  assert.match(logs.join('\n'), /HTTP 401 \(invalid_client\)/);
  assert.match(logs.join('\n'), /Invalid OPENSKY_AUTH_MODE; using default/);
  assert.doesNotMatch(logs.join('\n'), /fixture-secret-value|fixture\.invalid/);
});

test('CCTV source loader failure logs never echo provider URLs or keys', async (t) => {
  const logs = [];
  environment(t, {
    CCTV_FORCE_AUSTIN: '1',
    CCTV_AUSTIN_ROWS_URL: secret,
    CCTV_CALTRANS_DISTRICTS: '1',
    CCTV_TFL_ENABLED: '1',
    TFL_APP_KEY: 'fixture-secret-value',
  });
  t.mock.method(console, 'warn', (...args) => logs.push(args.join(' ')));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error(secret); });
  const providers = await import(`../server/providers/local.js?cctv-log-redaction=${Date.now()}`);
  const cctv = providers.localProviderPlugins().find((plugin) => plugin.name === 'cctv-proxy');
  const request = install(cctv);

  assert.equal((await request('/sources')).status, 200);
  assert.deepEqual(logs.sort(), [
    '[CCTV] AUSTIN_SOURCE_DOWNLOAD_FAILED',
    '[CCTV] TFL_JAMCAM_DOWNLOAD_FAILED',
    '[CCTV] CALTRANS_DISTRICT_FETCH_FAILED',
  ].sort());
  assert.doesNotMatch(logs.join('\n'), /fixture-secret-value|fixture\.invalid/);
});

test('FIRMS transport failures use fixed codes', async (t) => {
  const logs = [];
  environment(t, { FIRMS_MAP_KEY: 'fixture-key' });
  t.mock.method(fsp, 'readFile', async () => { throw new Error('cache absent'); });
  t.mock.method(fsp, 'mkdir', async () => {});
  t.mock.method(fsp, 'writeFile', async () => {});
  t.mock.method(console, 'warn', (...args) => logs.push(args.join(' ')));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error(secret); });
  const response = await install(firmsProxy())();

  assert.equal(response.status, 502);
  assert.ok(logs.includes('[firms-proxy] FIRMS_REFRESH_FAILED; serving cache if any'));
  assert.ok(logs.includes('[firms-proxy] VIIRS_NOAA20_NRT FIRMS_SOURCE_FETCH_FAILED'));
  assert.doesNotMatch(logs.join('\n'), /fixture-secret-value|fixture\.invalid/);
});
