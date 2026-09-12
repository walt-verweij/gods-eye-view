import { isExplicitLayerStateOrigin } from '../data/layerState.js';

/** Persists explicit awareness-subject selections into durable layer state. */
export class AwarenessSelectionController {
  constructor({ getDataManager = () => null } = {}) {
    this.getDataManager = getDataManager;
    this.selectedHandler = null;
    this.clearedHandler = null;
  }

  persistSelection(event, cleared = false) {
    const dataManager = this.getDataManager();
    if (!dataManager) return;
    const origin = String(event?.detail?.origin || 'programmatic');
    if (!isExplicitLayerStateOrigin(origin)) return;
    const layerId = String(event?.detail?.layerId || '');
    const config = {
      flights: {
        key: 'selectedFlightsTrackingId',
        normalize: (value) => String(value ?? '').trim().toLowerCase() || null,
      },
      military: {
        key: 'selectedMilitaryTrackingId',
        normalize: (value) => String(value ?? '').trim().toLowerCase() || null,
      },
      satellites: {
        key: 'selectedSatTrackingId',
        normalize: (value) => {
          const candidate = Number(value);
          return Number.isFinite(candidate) && candidate > 0 ? Math.trunc(candidate) : null;
        },
      },
    }[layerId];
    if (!config) return;
    const selectedValue = cleared ? null : config.normalize(event?.detail?.id);
    if (cleared || selectedValue === null) {
      dataManager.adoptLayerParams?.(layerId, {
        [config.key]: selectedValue,
      }, { origin });
      return;
    }
    const visibilityAdopted = dataManager.adoptLayerVisibility?.(
      layerId,
      true,
      { origin, adoptedFromSelection: true },
    );
    if (visibilityAdopted === false) return;
    for (const [otherLayerId, otherKey] of [
      ['flights', 'selectedFlightsTrackingId'],
      ['military', 'selectedMilitaryTrackingId'],
      ['satellites', 'selectedSatTrackingId'],
    ]) {
      if (otherLayerId === layerId) continue;
      dataManager.setLayerParams(otherLayerId, { [otherKey]: null }, { origin });
    }
    dataManager.adoptLayerParams?.(layerId, {
      [config.key]: selectedValue,
    }, { origin });
  }

  attach() {
    if (this.selectedHandler) return;
    this.selectedHandler = (event) => this.persistSelection(event, false);
    this.clearedHandler = (event) => this.persistSelection(event, true);
    window.addEventListener('gev:awareness-subject-selected', this.selectedHandler);
    window.addEventListener('gev:awareness-subject-cleared', this.clearedHandler);
  }

  dispose() {
    if (this.selectedHandler) {
      window.removeEventListener('gev:awareness-subject-selected', this.selectedHandler);
    }
    if (this.clearedHandler) {
      window.removeEventListener('gev:awareness-subject-cleared', this.clearedHandler);
    }
    this.selectedHandler = null;
    this.clearedHandler = null;
  }
}
