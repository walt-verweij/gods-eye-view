import test from 'node:test';
import assert from 'node:assert/strict';
import { AwarenessSelectionController } from './awarenessSelectionController.js';

function installDom() {
  const savedWindow = globalThis.window;
  const listeners = new Map();
  globalThis.window = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    dispatch(type, detail) {
      for (const handler of listeners.get(type) || []) handler({ detail });
    },
  };
  return {
    listeners,
    restore() { globalThis.window = savedWindow; },
  };
}

test('awareness selection adopts visibility, clears the other families, and persists a normalized id', () => {
  const calls = [];
  const controller = new AwarenessSelectionController({
    getDataManager: () => ({
      adoptLayerVisibility(...args) { calls.push(['visibility', ...args]); return true; },
      setLayerParams(...args) { calls.push(['clear', ...args]); },
      adoptLayerParams(...args) { calls.push(['persist', ...args]); },
    }),
  });

  controller.persistSelection({ detail: { origin: 'user', layerId: 'flights', id: ' AbC123 ' } });

  assert.deepEqual(calls, [
    ['visibility', 'flights', true, { origin: 'user', adoptedFromSelection: true }],
    ['clear', 'military', { selectedMilitaryTrackingId: null }, { origin: 'user' }],
    ['clear', 'satellites', { selectedSatTrackingId: null }, { origin: 'user' }],
    ['persist', 'flights', { selectedFlightsTrackingId: 'abc123' }, { origin: 'user' }],
  ]);
});

test('awareness controller ignores programmatic selection and removes both event listeners on disposal', () => {
  const dom = installDom();
  const calls = [];
  const controller = new AwarenessSelectionController({
    getDataManager: () => ({ adoptLayerParams(...args) { calls.push(args); } }),
  });
  try {
    controller.attach();
    controller.attach();
    assert.equal(dom.listeners.get('gev:awareness-subject-selected').size, 1);
    assert.equal(dom.listeners.get('gev:awareness-subject-cleared').size, 1);
    dom.window?.dispatch?.();
    globalThis.window.dispatch('gev:awareness-subject-selected', {
      origin: 'programmatic', layerId: 'flights', id: 'ignored',
    });
    globalThis.window.dispatch('gev:awareness-subject-cleared', {
      origin: 'user', layerId: 'satellites', id: 44,
    });
    assert.deepEqual(calls, [['satellites', { selectedSatTrackingId: null }, { origin: 'user' }]]);
    controller.dispose();
    assert.equal(dom.listeners.get('gev:awareness-subject-selected').size, 0);
    assert.equal(dom.listeners.get('gev:awareness-subject-cleared').size, 0);
  } finally {
    dom.restore();
  }
});
