import { renderMapStackChips, syncMapStackChips } from '../mapStackChips.js';
import { setDetectionStyle } from '../data/detection.js';

/** Owns the two map-source seams: basemap transitions and post-process styles. */
export class MapStackStyleController {
  constructor({
    mapStackController = null,
    mapStackChips = null,
    shareLinkManager = null,
    onSyncShareState = () => {},
    onShowToast = () => {},
    getActiveStyle = () => 'normal',
    setActiveStyle = () => {},
    stages = {},
    onSetCelestialRingEnabled = () => {},
    onStartTransition = () => {},
    onApplyStylePresetDefaults = () => {},
    styleIndicator = null,
    onUpdateStyleMiniStatus = () => {},
    onUpdateSliderPanel = () => {},
    onRevealStyleParameters = () => {},
    hud = null,
    onUpdateHudButtonState = () => {},
    onSyncIrBoost = () => {},
    onSyncCockpitInheritedStyle = () => {},
  } = {}) {
    Object.assign(this, {
      mapStackController, mapStackChips, shareLinkManager, onSyncShareState, onShowToast,
      getActiveStyle, setActiveStyle, stages, onSetCelestialRingEnabled, onStartTransition,
      onApplyStylePresetDefaults, styleIndicator, onUpdateStyleMiniStatus, onUpdateSliderPanel,
      hud, onUpdateHudButtonState, onSyncIrBoost, onSyncCockpitInheritedStyle, onRevealStyleParameters,
    });
    this.mapStackChangeHandler = null;
  }

  initMapStackControl() {
    if (!this.mapStackChips || !this.mapStackController) return;
    if (!this.mapStackChangeHandler) {
      this.mapStackChangeHandler = (event) => {
        this.renderMapStackState(event.detail);
        this.onSyncShareState();
      };
      window.addEventListener('gev:map-stack-changed', this.mapStackChangeHandler);
    }
    renderMapStackChips(this.mapStackChips, this.mapStackController.getStacks(), {
      activeId: this.mapStackController.getActiveId(),
      onSelect: (stackId) => { this.setMapStackInternal(stackId); },
    });
    this.renderMapStackState(this.mapStackController.getState());
  }

  async setMapStackInternal(stackId, { syncShare = true } = {}) {
    if (!this.mapStackController) return;
    if (syncShare) this.shareLinkManager?.claimRestoreLane?.('map');
    const before = this.mapStackController.getActiveId();
    this.renderMapStackState(this.mapStackController.getState('switching'));
    const state = await this.mapStackController.setStack(stackId);
    this.renderMapStackState(state);
    if (state?.activeId === before && stackId !== before && state?.lastError) this.onShowToast(state.lastError);
    if (syncShare) this.onSyncShareState();
  }

  renderMapStackState(state) {
    if (!state) return;
    syncMapStackChips(this.mapStackChips, state.activeId);
  }

  async setMapStack(stackId) {
    if (!this.mapStackController) return { ok: false, error: 'Map stack controller unavailable' };
    const stacks = this.mapStackController.getStacks();
    const target = stacks.find((stack) => stack.id === stackId);
    if (!target) return { ok: false, error: `Unknown map stack: ${stackId}`, available: stacks.map((stack) => stack.id) };
    if (!target.available) {
      return { ok: false, error: `${target.label} requires a Cesium ion token`, activeStack: this.mapStackController.getActiveId() };
    }
    await this.setMapStackInternal(stackId);
    const state = this.mapStackController.getState();
    const landed = state.activeId === stackId;
    return { ok: landed, activeStack: state.activeId, error: landed ? null : (state.lastError || 'Map stack did not switch') };
  }

  setStyle(styleName, { applyPreset = true, revealParameters = applyPreset, restore = false } = {}) {
    if (!restore) this.shareLinkManager?.claimRestoreLane?.('visual');
    if (styleName === this.getActiveStyle()) {
      if (revealParameters && styleName !== 'normal') this.onRevealStyleParameters();
      return;
    }
    const previousStyle = this.getActiveStyle();
    this.setActiveStyle(styleName);
    document.documentElement.dataset.gevStyle = styleName;
    this.onSetCelestialRingEnabled(false, { syncShare: false, focus: false });
    if (previousStyle !== 'normal' && this.stages[previousStyle]) {
      this.onStartTransition(previousStyle, this.stages[previousStyle].uniforms.intensity, 0.0);
    }
    if (styleName !== 'normal' && this.stages[styleName]) {
      this.onStartTransition(styleName, this.stages[styleName].uniforms.intensity, 1.0);
    }
    if (applyPreset) this.onApplyStylePresetDefaults(styleName);
    document.querySelectorAll('.style-btn').forEach((button) => button.classList.toggle('active', button.dataset.style === styleName));
    const displayNames = { surveillance: 'NVG', thermal: 'FLIR', retro: 'CRT' };
    if (this.styleIndicator) this.styleIndicator.textContent = displayNames[styleName] || styleName.toUpperCase();
    this.onUpdateStyleMiniStatus(styleName);
    this.onUpdateSliderPanel(styleName, { reveal: revealParameters });
    this.hud?.onStyleChange(styleName);
    this.onUpdateHudButtonState();
    setDetectionStyle(styleName);
    this.onSyncIrBoost();
    window.dispatchEvent(new CustomEvent('gev:style-change', { detail: { style: styleName } }));
    this.onSyncCockpitInheritedStyle();
    this.shareLinkManager?.onStyleChange?.(styleName);
    this.onSyncShareState();
  }

  dispose() {
    if (this.mapStackChangeHandler) window.removeEventListener('gev:map-stack-changed', this.mapStackChangeHandler);
    this.mapStackChangeHandler = null;
  }
}
