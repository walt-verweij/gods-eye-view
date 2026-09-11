import test from 'node:test';
import assert from 'node:assert/strict';
import { CockpitViewController } from './cockpitViewController.js';

function installDom() {
  const saved = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    CustomEvent: globalThis.CustomEvent,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const listeners = new Map();
  const events = [];
  const timers = new Map();
  let nextTimer = 0;

  class Element {
    constructor(id) {
      this.id = id;
      this.hidden = false;
      this.dataset = {};
      this.style = { removeProperty() {}, setProperty() {} };
      this.attributes = new Map();
      this.classSet = new Set();
      this.classList = {
        add: (name) => this.classSet.add(name),
        remove: (name) => this.classSet.delete(name),
        contains: (name) => this.classSet.has(name),
        toggle: (name, enabled) => (enabled ? this.classSet.add(name) : this.classSet.delete(name)),
      };
      this.isConnected = true;
    }

    addEventListener(type, callback) {
      if (!listeners.has(this)) listeners.set(this, new Map());
      const handlers = listeners.get(this);
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(callback);
    }

    removeEventListener(type, callback) {
      listeners.get(this)?.get(type)?.delete(callback);
    }

    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) || null; }
    focus() { globalThis.document.activeElement = this; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    contains(node) { return node === this; }
    matches() { return false; }
  }

  const nodes = new Map();
  for (const id of ['cockpit-entry', 'tr3b-toggle', 'map-view-switch', 'cockpit-reset-globe', 'cockpit-hud', 'cockpit-signal-stream']) {
    nodes.set(id, new Element(id));
  }
  const body = new Element('body');
  globalThis.HTMLElement = Element;
  globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  };
  globalThis.document = {
    activeElement: nodes.get('cockpit-entry'),
    body,
    hidden: false,
    getElementById: (id) => nodes.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(event) { events.push(event); },
    setTimeout(callback) {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    matchMedia: () => ({ matches: false }),
    innerWidth: 1440,
    innerHeight: 900,
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  return {
    nodes,
    body,
    events,
    timers,
    listenerCount: () => [...listeners.values()]
      .flatMap((handlers) => [...handlers.values()])
      .reduce((count, handlers) => count + handlers.size, 0),
    restore() { Object.assign(globalThis, saved); },
  };
}

test('Cockpit controller enters, exits, and disposes its DOM, events, and timers', () => {
  const dom = installDom();
  try {
    const entity = { position: {}, show: true, gevTrackedId: 'flights:abc123' };
    const viewer = {
      trackedEntity: entity,
      camera: { cancelFlight() {} },
      scene: {
        preUpdate: { addEventListener: () => () => {} },
        screenSpaceCameraController: { enableInputs: true },
      },
      trackedEntityChanged: { addEventListener: () => () => {} },
      entities: { contains: (candidate) => candidate === entity },
    };
    const controller = new CockpitViewController(viewer, { isEntryAllowed: () => true });
    controller.readAircraftInfo = () => ({ icao24: 'abc123', track: 90, layerId: 'flights' });
    controller.updateHud = () => {};
    controller.briefAutoRotateEnabled = true;

    assert.equal(controller.enter(), true);
    assert.equal(dom.body.classList.contains('cockpit-mode'), true);
    assert.equal(dom.nodes.get('cockpit-hud').hidden, false);
    assert.equal(dom.nodes.get('map-view-switch').hidden, false);
    assert.equal(viewer.scene.screenSpaceCameraController.enableInputs, false);
    assert.equal(dom.timers.size, 1, 'enter starts the enabled briefing timer');
    assert.deepEqual(dom.events.map((event) => [event.type, event.detail.active]), [
      ['gev:cockpit-mode-changed', true],
    ]);

    assert.equal(controller.exit(), true);
    assert.equal(dom.body.classList.contains('cockpit-mode'), false);
    assert.equal(dom.nodes.get('cockpit-hud').hidden, true);
    assert.equal(dom.nodes.get('map-view-switch').hidden, true);
    assert.equal(viewer.scene.screenSpaceCameraController.enableInputs, true);
    assert.equal(dom.timers.size, 0, 'exit clears the briefing timer');
    assert.deepEqual(dom.events.map((event) => [event.type, event.detail.active]), [
      ['gev:cockpit-mode-changed', true],
      ['gev:cockpit-mode-changed', false],
    ]);

    assert.equal(controller.enter(), true);
    assert.ok(dom.listenerCount() > 0, 'construction registers controller listeners');
    controller.dispose();
    assert.equal(dom.body.classList.contains('cockpit-mode'), false);
    assert.equal(dom.timers.size, 0, 'dispose clears the active briefing timer through exit');
    assert.equal(dom.listenerCount(), 0, 'dispose unregisters every controller listener');
  } finally {
    dom.restore();
  }
});
