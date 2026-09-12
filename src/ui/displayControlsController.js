/** Owns the shared HUD and detection controls that move between standard and Cockpit display rails. */
export class DisplayControlsController {
  constructor({
    hud,
    hudButton = null,
    hudLayoutRow = null,
    hudLayoutSelect = null,
    detectionButton = null,
    detectionSliderRow = null,
    detectionAllocationRow = null,
    detectionFadeRow = null,
    detectionOpacityRow = null,
    cockpitDisplayToggleButton = null,
    shareLinkManager = null,
    onSyncShareState = () => {},
    onSetHudVariant = () => {},
    onScheduleAdaptivePanelLayout = () => {},
    onLayoutRightPanels = () => {},
    onSetDetectionUserOverridden = () => {},
    onCycleDetection = () => {},
    onSetCockpitDisclosure = () => {},
    onInitCockpitDisplayPortal = () => {},
  } = {}) {
    Object.assign(this, {
      hud, hudButton, hudLayoutRow, hudLayoutSelect, detectionButton, detectionSliderRow,
      detectionAllocationRow, detectionFadeRow, detectionOpacityRow, cockpitDisplayToggleButton,
      shareLinkManager, onSyncShareState, onSetHudVariant, onScheduleAdaptivePanelLayout,
      onLayoutRightPanels, onSetDetectionUserOverridden, onCycleDetection,
      onSetCockpitDisclosure, onInitCockpitDisplayPortal,
    });
  }

  init() {
    this.hudButton?.addEventListener('click', () => this.toggleHud());

    if (this.hudLayoutSelect) this.hudLayoutSelect.value = 'tactical';
    this.onSetHudVariant('tactical');
    this.hud.setMode('on');
    this.updateHudButtonState();

    this.detectionButton?.addEventListener('click', () => this.cycleDetection());
    this.cockpitDisplayToggleButton?.addEventListener('click', () => {
      const open = this.cockpitDisplayToggleButton.getAttribute('aria-expanded') === 'true';
      this.onSetCockpitDisclosure('display', !open);
    });
    this.onInitCockpitDisplayPortal();
  }

  toggleHud() {
    this.shareLinkManager?.claimRestoreLane?.('visual');
    this.hud.toggle();
    this.updateHudButtonState();
    this.onSyncShareState();
  }

  cycleDetection() {
    this.shareLinkManager?.claimRestoreLane?.('visual');
    this.onSetDetectionUserOverridden();
    this.onCycleDetection();
    this.onSyncShareState();
  }

  updateHudButtonState() {
    this.hudButton?.classList.toggle('active', this.hud.visible);
    this.hudLayoutRow?.classList.toggle('visible', this.hud.visible);
    this.onScheduleAdaptivePanelLayout({ settle: true });
  }

  updateDetectionButton(modeLabel) {
    const enabled = modeLabel !== 'OFF';
    this.detectionButton?.setAttribute('aria-pressed', String(enabled));
    this.detectionButton?.setAttribute('aria-label', enabled
      ? `Detection overlay: ${String(modeLabel).toLowerCase()}`
      : 'Detection overlay: off');
    this.detectionButton?.classList.remove('active', 'god', 'panoptic');
    const label = this.detectionButton?.querySelector('.pp-label');
    if (modeLabel === 'SPARSE') {
      if (label) label.textContent = 'SPARSE';
      this.detectionButton?.classList.add('active');
    } else if (modeLabel === 'BALANCED') {
      if (label) label.textContent = 'BALANCED';
      this.detectionButton?.classList.add('active');
    } else if (modeLabel === 'DENSE') {
      if (label) label.textContent = 'DENSE';
      this.detectionButton?.classList.add('active', 'panoptic');
    } else if (label) {
      label.textContent = 'DETECT';
    }
    const visible = modeLabel !== 'OFF';
    this.detectionSliderRow?.classList.toggle('visible', visible);
    this.detectionAllocationRow?.classList.toggle('visible', visible);
    this.detectionFadeRow?.classList.toggle('visible', visible);
    this.detectionOpacityRow?.classList.toggle('visible', visible);
    this.onLayoutRightPanels();
  }
}
