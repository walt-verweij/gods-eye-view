import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyboardFocusController } from './keyboardFocusController.js';

test('keyboard controller preserves form-control guards, global shortcuts, and POI QWERTY focus', () => {
  const savedDocument = globalThis.document;
  const listeners = new Map();
  globalThis.document = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
  };
  try {
    const calls = [];
    const locationSearch = {
      value: 'Austin',
      classList: { contains: (name) => name === 'expanded', remove: (name) => calls.push(['remove', name]) },
      blur: () => calls.push(['blur']),
    };
    const controller = new KeyboardFocusController({
      getLocationSearch: () => locationSearch,
      onSetStyle: (style) => calls.push(['style', style]),
      onToggleHud: () => calls.push(['hud']),
      onToggleOrbit: () => calls.push(['orbit']),
      onToggleCleanView: () => calls.push(['clean']),
      onToggleDataPanel: () => calls.push(['data']),
      onCycleDetection: () => calls.push(['detection']),
      onToggleCctv: () => calls.push(['cctv']),
      getExpandedCityId: () => 'austin',
      getPoiCount: (cityId) => cityId === 'austin' ? 2 : 0,
      onPoiSelect: (cityId, index) => calls.push(['poi', cityId, index]),
    });
    controller.attach();
    controller.attachPoiNavigation();

    controller.globalKeydownHandler({ key: '2', target: { matches: () => false } });
    assert.deepEqual(calls, [['style', 'retro']]);
    calls.length = 0;
    controller.globalKeydownHandler({ key: 'h', target: { matches: () => true } });
    assert.deepEqual(calls, [], 'form controls suppress global shortcuts');
    controller.globalKeydownHandler({ key: 'Escape', target: locationSearch });
    assert.deepEqual(calls, [['remove', 'expanded'], ['blur']]);
    assert.equal(locationSearch.value, '');
    calls.length = 0;
    controller.poiKeydownHandler({ key: 'W', target: { matches: () => false } });
    assert.deepEqual(calls, [['poi', 'austin', 1]]);
    controller.dispose();
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.document = savedDocument;
  }
});
