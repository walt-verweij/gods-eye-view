import assert from 'node:assert/strict';
import test from 'node:test';
import viteConfig from '../vite.config.js';

const FEED_PROXY_NAMES = [
  'opensky-proxy',
  'celestrak-proxy',
  'tomtom-proxy',
  'firms-proxy',
  'rocket-launches-proxy',
  'terrain-heights-proxy',
  'adsbdb-proxy',
  'overpass-proxy',
  'military-installations-proxy',
  'regional-brief-proxy',
  'weather-effects-proxy',
  'cctv-proxy',
  'radio-browser-proxy',
  'gbfs-proxy',
  'adsblol-proxy',
  'ais-live-proxy',
  'track-backfill-proxies',
  'openai-realtime-proxy',
  'google-places-context-proxy',
];

function proxyPlugins() {
  return viteConfig({ mode: 'test' }).plugins;
}

function installedRoutes(plugin, hook) {
  const routes = [];
  plugin[hook]({
    middlewares: {
      use(path, handler) {
        routes.push({ path, handler });
      },
    },
    httpServer: { on() {} },
  });
  return routes;
}

test('every data-feed proxy installs the same routes in dev and preview', () => {
  const pluginsByName = new Map(proxyPlugins().map((plugin) => [plugin.name, plugin]));
  assert.deepEqual(
    [...pluginsByName.keys()].filter((name) => FEED_PROXY_NAMES.includes(name)).sort(),
    [...FEED_PROXY_NAMES].sort(),
    'the config should make every feed proxy explicit in this contract',
  );

  for (const name of FEED_PROXY_NAMES) {
    const plugin = pluginsByName.get(name);
    assert.equal(typeof plugin.configureServer, 'function', `${name} must install in dev`);
    assert.equal(typeof plugin.configurePreviewServer, 'function', `${name} must install in preview`);

    const devRoutes = installedRoutes(plugin, 'configureServer');
    const previewRoutes = installedRoutes(plugin, 'configurePreviewServer');
    assert.ok(devRoutes.length > 0, `${name} must install a dev route`);
    assert.deepEqual(
      previewRoutes.map(({ path }) => path),
      devRoutes.map(({ path }) => path),
      `${name} preview routes must match dev routes`,
    );
  }
});

test('key setup remains explicitly dev-only', () => {
  const setup = proxyPlugins().find((plugin) => plugin.name === 'gev-key-setup');
  assert.ok(setup, 'key setup plugin must remain registered');
  assert.equal(setup.apply({}, { command: 'serve', isPreview: false }), true);
  assert.equal(setup.apply({}, { command: 'serve', isPreview: true }), false);
  assert.equal(typeof setup.configurePreviewServer, 'undefined');
  assert.deepEqual(
    installedRoutes(setup, 'configureServer').map(({ path }) => path),
    ['/api/setup/status', '/api/setup/keys'],
  );
});
