import test from 'node:test';
import assert from 'node:assert/strict';
import { MapStackStyleController } from './mapStackStyleController.js';

test('map stack facade reports unavailable and rejected stacks without claiming a share lane', async () => {
  const claims = [];
  const controller = new MapStackStyleController({
    mapStackController: {
      getStacks: () => [{ id: 'osm', label: 'OpenStreetMap', available: true }, { id: 'ion', label: 'Ion', available: false }],
      getActiveId: () => 'osm',
      getState: () => ({ activeId: 'osm', lastError: null }),
    },
    shareLinkManager: { claimRestoreLane: (...args) => claims.push(args) },
  });

  assert.deepEqual(await controller.setMapStack('unknown'), {
    ok: false, error: 'Unknown map stack: unknown', available: ['osm', 'ion'],
  });
  assert.deepEqual(await controller.setMapStack('ion'), {
    ok: false, error: 'Ion requires a Cesium ion token', activeStack: 'osm',
  });
  assert.deepEqual(claims, []);
});
