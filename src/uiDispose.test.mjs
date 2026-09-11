import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const disposeStart = source.indexOf('  async dispose() {');
const disposeEnd = source.indexOf('\n  }\n}', disposeStart) + 4;
assert.ok(disposeStart >= 0 && disposeEnd > disposeStart, 'StyleManager.dispose source exists');

const dispose = new Function(
  'window', 'document', 'clearTimeout', 'clearInterval', 'cancelAnimationFrame',
  'releaseContinuousRender', 'radioLayer', 'destroyTrackedReadout', 'destroyDetection', 'destroyWorldOverlay',
  `return ${source.slice(disposeStart, disposeEnd).replace('async dispose()', 'async function dispose()')};`,
)(
  { removeEventListener() {} },
  { removeEventListener() {}, getElementById() { return null; } },
  () => {}, () => {}, () => {}, () => {}, { endTuning() {} }, () => {}, () => {}, () => {},
);

test('dispose completes cleanup and surfaces a failed context restore once', async () => {
  const calls = [];
  const restoreError = new Error('restore failed');
  const manager = {
    _shareTrackingNoticeGeneration: 0,
    _contextModeGeneration: 0,
    _cockpitDisplayPortalRecords: [],
    _restoreContextSession: async () => { calls.push('restore'); throw restoreError; },
    _settleInitialShareRestore() { calls.push('settle'); },
    _stampNavigation() { calls.push('stamp-navigation'); },
    _setCockpitDisplayPortalActive() { calls.push('disable-portal'); },
    _stopLoadingFeedbackTicker() { calls.push('stop-loading-ticker'); },
    cockpitView: { dispose() { calls.push('dispose-cockpit'); } },
    _dataManagerUnsubscribe() { calls.push('unsubscribe-data-manager'); },
    transitions: { clear() { calls.push('clear-transitions'); } },
  };

  await assert.rejects(dispose.call(manager), restoreError);
  assert.deepEqual(calls, [
    'settle', 'stamp-navigation', 'restore', 'dispose-cockpit', 'disable-portal',
    'unsubscribe-data-manager', 'stop-loading-ticker', 'clear-transitions',
  ]);
  await assert.doesNotReject(dispose.call(manager));
  assert.equal(calls.filter((call) => call === 'restore').length, 1);
});
