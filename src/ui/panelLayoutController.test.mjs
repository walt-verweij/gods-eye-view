import test from 'node:test';
import assert from 'node:assert/strict';
import { PanelLayoutController } from './panelLayoutController.js';

function installDom() {
  const saved = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  const listeners = new Map();
  const windowListeners = new Map();
  const storage = new Map();
  const makeElement = ({ left = 100, top = 100, width = 320, height = 240 } = {}) => ({
    style: {},
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }),
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
  });
  globalThis.window = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener(type, callback) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(callback);
    },
    removeEventListener(type, callback) {
      windowListeners.set(type, (windowListeners.get(type) || []).filter((item) => item !== callback));
    },
  };
  globalThis.document = { querySelectorAll: () => [] };
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  return {
    makeElement,
    storage,
    emit(element, type, event) { for (const callback of listeners.get(type) || []) callback(event); },
    emitWindow(type, event) { for (const callback of windowListeners.get(type) || []) callback(event); },
    restore() { Object.assign(globalThis, saved); },
  };
}

test('panel layout restores a clamped position, keeps the right rail anchored, and persists a drag', () => {
  const dom = installDom();
  try {
    const panel = dom.makeElement({ left: 460, top: 490, width: 320, height: 240 });
    const handle = dom.makeElement();
    const controller = new PanelLayoutController({
      getStorageKey: (id) => `panel:${id}`,
    });
    dom.storage.set('panel:pp-toggles', JSON.stringify({ left: -20, top: 900 }));

    controller.restorePanelPosition('pp-toggles', panel);
    assert.deepEqual(
      { left: panel.style.left, top: panel.style.top, right: panel.style.right, bottom: panel.style.bottom },
      { left: 'auto', top: '354px', right: '20px', bottom: 'auto' },
    );

    controller.makePanelDraggable('pp-toggles', panel, handle);
    dom.emit(handle, 'pointerdown', {
      button: 0,
      target: { closest: () => null },
      preventDefault() {},
      clientX: 500,
      clientY: 520,
    });
    dom.emitWindow('pointermove', { clientX: 900, clientY: 800 });
    dom.emitWindow('pointerup', {});

    assert.equal(dom.storage.get('panel:pp-toggles'), JSON.stringify({ left: 460, top: 490 }));
    assert.equal(panel.style.right, '20px');
  } finally {
    dom.restore();
  }
});
