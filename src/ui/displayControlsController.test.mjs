import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayControlsController } from './displayControlsController.js';

function control() {
  const handlers = new Map();
  const classes = new Set();
  const attrs = new Map();
  const label = { textContent: '' };
  return {
    handlers, classes, attrs, label,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)),
    },
    addEventListener(type, handler) { handlers.set(type, handler); },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.get(name) || null; },
    querySelector(selector) { return selector === '.pp-label' ? label : null; },
  };
}

test('HUD and detection controls claim visual restoration before mutating and synchronize their state', () => {
  const hudButton = control();
  const hudLayoutRow = control();
  const detectionButton = control();
  const detectionSliderRow = control();
  const detectionAllocationRow = control();
  const detectionFadeRow = control();
  const detectionOpacityRow = control();
  const calls = [];
  const hud = { visible: true, toggle() { calls.push('toggle-hud'); }, setMode(mode) { calls.push(`hud:${mode}`); } };
  const controller = new DisplayControlsController({
    hud,
    hudButton,
    hudLayoutRow,
    hudLayoutSelect: { value: '' },
    detectionButton,
    detectionSliderRow,
    detectionAllocationRow,
    detectionFadeRow,
    detectionOpacityRow,
    shareLinkManager: { claimRestoreLane: (lane) => calls.push(`claim:${lane}`) },
    onSyncShareState: () => calls.push('sync-share'),
    onSetHudVariant: (variant) => calls.push(`variant:${variant}`),
    onScheduleAdaptivePanelLayout: () => calls.push('layout-adaptive'),
    onLayoutRightPanels: () => calls.push('layout-right'),
    onSetDetectionUserOverridden: () => calls.push('detection-overridden'),
    onCycleDetection: () => calls.push('cycle-detection'),
  });

  controller.init();
  hudButton.handlers.get('click')();
  detectionButton.handlers.get('click')();
  controller.updateDetectionButton('DENSE');

  assert.deepEqual(calls, [
    'variant:tactical', 'hud:on', 'layout-adaptive', 'claim:visual', 'toggle-hud',
    'layout-adaptive', 'sync-share', 'claim:visual', 'detection-overridden',
    'cycle-detection', 'sync-share', 'layout-right',
  ]);
  assert.equal(hudButton.classes.has('active'), true);
  assert.equal(hudLayoutRow.classes.has('visible'), true);
  assert.equal(detectionButton.label.textContent, 'DENSE');
  assert.equal(detectionButton.classes.has('panoptic'), true);
  for (const row of [detectionSliderRow, detectionAllocationRow, detectionFadeRow, detectionOpacityRow]) {
    assert.equal(row.classes.has('visible'), true);
  }
});
