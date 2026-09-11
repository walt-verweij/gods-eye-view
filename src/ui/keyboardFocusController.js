/** Keeps global and Location-panel keyboard routing independent of UI construction. */
export class KeyboardFocusController {
  constructor({
    getLocationSearch,
    onSetStyle,
    onToggleHud,
    onToggleOrbit,
    onToggleCleanView,
    onToggleDataPanel,
    onCycleDetection,
    onToggleCctv,
    getExpandedCityId,
    getPoiCount,
    onPoiSelect,
  }) {
    this.getLocationSearch = getLocationSearch;
    this.onSetStyle = onSetStyle;
    this.onToggleHud = onToggleHud;
    this.onToggleOrbit = onToggleOrbit;
    this.onToggleCleanView = onToggleCleanView;
    this.onToggleDataPanel = onToggleDataPanel;
    this.onCycleDetection = onCycleDetection;
    this.onToggleCctv = onToggleCctv;
    this.getExpandedCityId = getExpandedCityId;
    this.getPoiCount = getPoiCount;
    this.onPoiSelect = onPoiSelect;
    this.globalKeydownHandler = null;
    this.poiKeydownHandler = null;
  }

  attach() {
    if (this.globalKeydownHandler) return;
    this.globalKeydownHandler = (event) => {
      const locationSearch = this.getLocationSearch();
      const isFormControl = event.target?.matches?.('select, input, textarea')
        || event.target === locationSearch;
      if (isFormControl && event.key !== 'Escape') return;

      const keyMap = {
        '1': 'normal', '2': 'retro', '3': 'surveillance', '4': 'thermal',
        '5': 'anime', '6': 'noir', '7': 'snow',
      };
      if (keyMap[event.key]) this.onSetStyle(keyMap[event.key]);
      if (event.key === 'Escape' && locationSearch?.classList.contains('expanded')) {
        locationSearch.classList.remove('expanded');
        locationSearch.value = '';
        locationSearch.blur();
      }
      if (event.key.toLowerCase() === 'h') this.onToggleHud();
      if (event.key.toLowerCase() === 'o') this.onToggleOrbit();
      if (event.key.toLowerCase() === 'v') this.onToggleCleanView();
      if (event.key.toLowerCase() === 'f') this.onToggleDataPanel();
      if (event.key.toLowerCase() === 'd') this.onCycleDetection();
      if (event.key.toLowerCase() === 'c') this.onToggleCctv();
    };
    document.addEventListener('keydown', this.globalKeydownHandler);
  }

  attachPoiNavigation() {
    if (this.poiKeydownHandler) return;
    const keys = ['Q', 'W', 'E', 'R', 'T'];
    this.poiKeydownHandler = (event) => {
      const cityId = this.getExpandedCityId();
      if (!cityId) return;
      const locationSearch = this.getLocationSearch();
      if (event.target?.matches?.('select, input, textarea') || event.target === locationSearch) return;
      const index = keys.indexOf(event.key.toUpperCase());
      if (index !== -1 && index < this.getPoiCount(cityId)) this.onPoiSelect(cityId, index);
    };
    document.addEventListener('keydown', this.poiKeydownHandler);
  }

  dispose() {
    if (this.globalKeydownHandler) document.removeEventListener('keydown', this.globalKeydownHandler);
    if (this.poiKeydownHandler) document.removeEventListener('keydown', this.poiKeydownHandler);
    this.globalKeydownHandler = null;
    this.poiKeydownHandler = null;
  }
}
