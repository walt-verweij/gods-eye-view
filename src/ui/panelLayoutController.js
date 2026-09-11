/**
 * Owns the persistence and pointer mechanics of movable panels. Policy about
 * which panels may open, collapse, or share a rail remains with StyleManager.
 */
export class PanelLayoutController {
  constructor({
    getStorageKey,
    onLayoutRightPanels = () => {},
    onSyncCctvPanelViewport = () => {},
    panelZBase = 100,
    panelZMax = 139,
  }) {
    this.getStorageKey = getStorageKey;
    this.onLayoutRightPanels = onLayoutRightPanels;
    this.onSyncCctvPanelViewport = onSyncCctvPanelViewport;
    this.panelZBase = panelZBase;
    this.panelZMax = panelZMax;
    this.panelZCounter = panelZBase + 10;
  }

  pinPanelToRight(panelEl) {
    if (!panelEl) return;
    const rect = panelEl.getBoundingClientRect();
    const rightOffset = Math.max(6, Math.round(window.innerWidth - rect.right));
    panelEl.style.right = `${rightOffset}px`;
    panelEl.style.left = 'auto';
  }

  restorePanelPosition(panelId, panelEl) {
    try {
      const raw = localStorage.getItem(this.getStorageKey(panelId));
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
      const { left, top } = this.clampToViewport(Math.round(pos.left), Math.round(pos.top), panelEl);
      panelEl.style.left = `${left}px`;
      panelEl.style.top = `${top}px`;
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';
      if (panelId === 'pp-toggles') this.pinPanelToRight(panelEl);
    } catch {
      // Storage is optional and malformed positions are intentionally ignored.
    }
  }

  clampToViewport(left, top, panelEl) {
    const rect = panelEl.getBoundingClientRect();
    const maxLeft = Math.max(6, window.innerWidth - rect.width - 6);
    const maxTop = Math.max(6, window.innerHeight - rect.height - 6);
    return {
      left: Math.max(6, Math.min(maxLeft, left)),
      top: Math.max(6, Math.min(maxTop, top)),
    };
  }

  savePanelPosition(panelId, panelEl) {
    const rect = panelEl.getBoundingClientRect();
    try {
      localStorage.setItem(this.getStorageKey(panelId), JSON.stringify({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
      }));
    } catch {
      // Storage can be unavailable in private or embedded contexts.
    }
  }

  promotePanelZ(panelEl) {
    this.panelZCounter += 1;
    if (this.panelZCounter > this.panelZMax) {
      const promoted = [...document.querySelectorAll('.panel-draggable')]
        .filter((el) => el.style.zIndex)
        .sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex));
      let z = this.panelZBase + 1;
      for (const el of promoted) {
        el.style.zIndex = String(z);
        z += 1;
      }
      this.panelZCounter = z;
    }
    panelEl.style.zIndex = String(this.panelZCounter);
  }

  makePanelDraggable(panelId, panelEl, handleEl) {
    panelEl.addEventListener('pointerdown', () => this.promotePanelZ(panelEl));

    handleEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('.panel-collapse-btn')) return;
      if (event.target.closest('input, select, option, button:not(.panel-collapse-btn)')) return;

      event.preventDefault();
      const rect = panelEl.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      panelEl.style.left = `${rect.left}px`;
      panelEl.style.top = `${rect.top}px`;
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';
      panelEl.classList.add('panel-dragging');
      this.promotePanelZ(panelEl);

      const onMove = (moveEvent) => {
        const { left, top } = this.clampToViewport(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY, panelEl);
        panelEl.style.left = `${left}px`;
        panelEl.style.top = `${top}px`;
        if (panelId === 'pp-toggles') this.onLayoutRightPanels();
        if (panelId === 'cctv-panel') this.onSyncCctvPanelViewport();
      };
      const onUp = () => {
        panelEl.classList.remove('panel-dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (panelId === 'pp-toggles') this.pinPanelToRight(panelEl);
        this.savePanelPosition(panelId, panelEl);
        if (panelId === 'cctv-panel') this.onSyncCctvPanelViewport();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }
}
