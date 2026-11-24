(function initHud(root) {
  'use strict';

  const ns = (root.ArbZoom = root.ArbZoom || {});
  const ZMath = ns.Math;

  const HUD_STYLES = `
    :host {
      all: initial !important;
      display: block !important;
      direction: ltr !important;
      unicode-bidi: isolate !important;
      visibility: visible !important;
      line-height: normal !important;
      font-size: 16px !important;
      position: fixed !important;
      z-index: 2147483647 !important;
      inset: 0 !important;
      pointer-events: none !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif !important;
    }

    * {
      box-sizing: border-box;
    }

    .hud-dock {
      position: fixed;
      right: 18px;
      bottom: 18px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      pointer-events: none;
      visibility: hidden;
      opacity: 0;
      transform: translateY(8px) scale(0.97);
      transition: opacity 140ms ease, transform 160ms ease, visibility 0ms linear 140ms;
    }

    .hud-dock.visible {
      visibility: visible;
      opacity: 1;
      transform: translateY(0) scale(1);
      transition: opacity 140ms ease, transform 160ms ease, visibility 0ms linear 0ms;
    }

    .minimap-card {
      pointer-events: none;
      display: none;
      flex-direction: column;
      gap: 6px;
      width: 194px;
      padding: 10px;
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(148, 163, 184, 0.22);
      box-shadow: 0 12px 32px rgba(2, 6, 23, 0.45);
      color: #e2e8f0;
      user-select: none;
    }

    .hud-dock.visible .minimap-card.open {
      display: flex;
      pointer-events: auto;
    }

    .minimap-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #94a3b8;
    }

    .minimap-meta {
      font-variant-numeric: tabular-nums;
      color: #cbd5e1;
      text-transform: none;
      letter-spacing: 0;
    }

    .minimap-canvas {
      position: relative;
      width: 100%;
      height: 112px;
      border-radius: 8px;
      background:
        linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px),
        linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px),
        rgba(30, 41, 59, 0.9);
      background-size: 16px 16px;
      border: 1px solid rgba(148, 163, 184, 0.2);
      overflow: hidden;
      cursor: crosshair;
      touch-action: none;
    }

    .minimap-viewport {
      position: absolute;
      border: 1.5px solid #38bdf8;
      background: rgba(56, 189, 248, 0.22);
      border-radius: 2px;
      box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.6);
      min-width: 6px;
      min-height: 6px;
      pointer-events: none;
    }

    .minimap-viewport.hyper {
      border-color: #a78bfa;
      background: rgba(167, 139, 250, 0.28);
    }

    .pill {
      pointer-events: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 7px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(148, 163, 184, 0.24);
      box-shadow: 0 10px 28px rgba(2, 6, 23, 0.45);
      color: #f8fafc;
      user-select: none;
    }

    .hud-dock.visible .pill {
      pointer-events: auto;
    }

    .drag-handle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 24px;
      color: #64748b;
      cursor: grab;
      flex-shrink: 0;
      touch-action: none;
    }

    .drag-handle:active {
      cursor: grabbing;
      color: #94a3b8;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #38bdf8;
      box-shadow: 0 0 8px rgba(56, 189, 248, 0.7);
      flex-shrink: 0;
      margin-right: 2px;
    }

    .status-dot.hyper {
      background: #a78bfa;
      box-shadow: 0 0 10px rgba(167, 139, 250, 0.85);
    }

    .btn {
      appearance: none;
      border: none;
      background: transparent;
      color: #e2e8f0;
      width: 26px;
      height: 26px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      padding: 0;
      transition: background 120ms ease, color 120ms ease, opacity 120ms ease;
    }

    .btn:hover:not(:disabled) {
      background: rgba(148, 163, 184, 0.2);
      color: #ffffff;
    }

    .btn:active:not(:disabled) {
      background: rgba(148, 163, 184, 0.32);
    }

    .btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }

    .btn.active {
      background: rgba(99, 102, 241, 0.32);
      color: #c7d2fe;
      box-shadow: inset 0 0 0 1px rgba(129, 140, 248, 0.55);
    }

    .btn.reset {
      width: auto;
      padding: 0 8px;
      font-size: 11px;
      font-weight: 600;
      color: #cbd5e1;
    }

    .zoom-readout {
      appearance: none;
      border: 1px solid transparent;
      background: rgba(30, 41, 59, 0.78);
      color: #f8fafc;
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: center;
      width: 84px;
      height: 26px;
      border-radius: 999px;
      padding: 0 6px;
      outline: none;
      transition: border-color 120ms ease, background 120ms ease;
    }

    .zoom-readout:hover {
      border-color: rgba(148, 163, 184, 0.35);
    }

    .zoom-readout:focus {
      background: rgba(15, 23, 42, 0.98);
      border-color: #818cf8;
    }

    .zoom-readout.invalid {
      border-color: #f87171;
      background: rgba(127, 29, 29, 0.45);
    }

    .sep {
      width: 1px;
      height: 16px;
      background: rgba(148, 163, 184, 0.22);
      margin: 0 2px;
    }

    .pill.collapsed .collapsible {
      display: none;
    }

    .pill.collapsed .zoom-readout {
      width: 72px;
      cursor: pointer;
    }

    svg {
      width: 14px;
      height: 14px;
      display: block;
    }
  `;

  class ZoomHud {
    constructor(actions = {}) {
      this.actions = actions;
      this.host = null;
      this.shadow = null;
      this.els = null;
      this.mounted = false;
      this.collapsed = false;
      this.minimapOpen = false;
      this.isEditingInput = false;
      this.isDraggingMinimap = false;
      this.isDraggingDock = false;
      this.dockRight = 18;
      this.dockBottom = 18;
      this.lastState = null;
      this._onResize = this._clampDockPosition.bind(this);

      this._mount();
    }

    _mount() {
      // Only mount Shadow DOM HUD on HTML documents with a body & documentElement.
      // Standalone SVG/XML documents throw NotSupportedError on attachShadow.
      if (!document.body || !document.documentElement) return;

      let host;
      let shadow;
      try {
        host = document.createElement('arb-zoom-hud');
        host.setAttribute('data-arb-zoom-hud', 'true');
        shadow = host.attachShadow({ mode: 'open' });
      } catch (_) {
        return;
      }

      const style = document.createElement('style');
      style.textContent = HUD_STYLES;
      shadow.appendChild(style);

      const dock = document.createElement('div');
      dock.className = 'hud-dock';
      dock.inert = true;
      dock.innerHTML = `
        <div class="minimap-card" part="minimap">
          <div class="minimap-header">
            <span>Navigator</span>
            <span class="minimap-meta"></span>
          </div>
          <div class="minimap-canvas" title="Click or drag to pan across page">
            <div class="minimap-viewport"></div>
          </div>
        </div>
        <div class="pill" part="pill">
          <span class="drag-handle collapsible" title="Drag HUD position" aria-label="Drag HUD position">
            <svg viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
              <circle cx="3.5" cy="4" r="1.2"/><circle cx="8.5" cy="4" r="1.2"/>
              <circle cx="3.5" cy="8" r="1.2"/><circle cx="8.5" cy="8" r="1.2"/>
              <circle cx="3.5" cy="12" r="1.2"/><circle cx="8.5" cy="12" r="1.2"/>
            </svg>
          </span>
          <span class="status-dot" title="Active zoom" aria-hidden="true"></span>
          <button class="btn collapsible" data-action="out" aria-label="Zoom out" title="Zoom out (Alt + -)">−</button>
          <input class="zoom-readout" type="text" aria-label="Zoom percentage" title="Type any zoom % or multiplier (e.g. 2500, 50x, 10k)" />
          <button class="btn collapsible" data-action="in" aria-label="Zoom in" title="Zoom in (Alt + =)">+</button>
          <span class="sep collapsible" aria-hidden="true"></span>
          <button class="btn collapsible" data-action="pan" aria-label="Toggle pan mode" aria-pressed="false" title="Drag-to-pan hand mode (or hold Space)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/>
              <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/>
              <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/>
              <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
            </svg>
          </button>
          <button class="btn collapsible" data-action="pixelated" aria-label="Toggle crisp pixels" aria-pressed="false" title="Crisp pixel rendering (image-rendering: pixelated)">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="3" y="3" width="6" height="6" rx="1"/>
              <rect x="15" y="3" width="6" height="6" rx="1"/>
              <rect x="9" y="9" width="6" height="6" rx="1"/>
              <rect x="3" y="15" width="6" height="6" rx="1"/>
              <rect x="15" y="15" width="6" height="6" rx="1"/>
            </svg>
          </button>
          <button class="btn collapsible" data-action="minimap" aria-label="Toggle viewport minimap" aria-pressed="false" title="Toggle viewport minimap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <rect x="10" y="10" width="7" height="7" rx="1"/>
            </svg>
          </button>
          <button class="btn reset collapsible" data-action="reset" aria-label="Reset zoom to 100%" title="Reset zoom to 100% (Alt + 0)">100%</button>
          <button class="btn" data-action="collapse" aria-label="Collapse or expand HUD" aria-expanded="true" title="Collapse / expand HUD">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      `;

      shadow.appendChild(dock);

      // Attach to <html> directly (sibling of <body>) so body transforms never scale the HUD
      document.documentElement.appendChild(host);

      this.host = host;
      this.shadow = shadow;
      this.mounted = true;
      this.els = {
        dock,
        pill: dock.querySelector('.pill'),
        dragHandle: dock.querySelector('.drag-handle'),
        statusDot: dock.querySelector('.status-dot'),
        input: dock.querySelector('.zoom-readout'),
        btnPan: dock.querySelector('[data-action="pan"]'),
        btnPixelated: dock.querySelector('[data-action="pixelated"]'),
        btnMinimap: dock.querySelector('[data-action="minimap"]'),
        btnCollapse: dock.querySelector('[data-action="collapse"]'),
        minimapCard: dock.querySelector('.minimap-card'),
        minimapMeta: dock.querySelector('.minimap-meta'),
        minimapCanvas: dock.querySelector('.minimap-canvas'),
        minimapViewport: dock.querySelector('.minimap-viewport'),
      };

      this._wireEvents();
      window.addEventListener('resize', this._onResize, { passive: true });
    }

    isEventInside(event) {
      if (!this.host || !event) return false;
      if (event.target === this.host) return true;
      if (typeof event.composedPath === 'function') {
        return event.composedPath().includes(this.host);
      }
      return false;
    }

    _clampDockPosition() {
      if (!this.mounted || !this.els) return;
      const vw = window.innerWidth || document.documentElement?.clientWidth || 1000;
      const vh = window.innerHeight || document.documentElement?.clientHeight || 800;
      const rect = this.els.dock.getBoundingClientRect();
      const dockW = rect.width > 0 ? rect.width : this.collapsed ? 120 : 370;
      const dockH = rect.height > 0 ? rect.height : this.minimapOpen ? 200 : 42;

      const maxR = Math.max(8, vw - dockW - 8);
      const maxB = Math.max(8, vh - dockH - 8);
      this.dockRight = ZMath.clamp(this.dockRight, 8, maxR);
      this.dockBottom = ZMath.clamp(this.dockBottom, 8, maxB);
      this.els.dock.style.right = `${Math.round(this.dockRight)}px`;
      this.els.dock.style.bottom = `${Math.round(this.dockBottom)}px`;
    }

    _wireEvents() {
      // Prevent HUD interactions from bubbling out and dismissing host-page dropdowns/modals
      for (const container of [this.els.pill, this.els.minimapCard]) {
        for (const evType of ['pointerdown', 'mousedown', 'click', 'wheel']) {
          container.addEventListener(evType, (e) => e.stopPropagation());
        }
      }

      this.els.pill.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn || btn.disabled) return;
        const action = btn.dataset.action;
        if (action === 'in') this.actions.stepZoom?.(1);
        else if (action === 'out') this.actions.stepZoom?.(-1);
        else if (action === 'reset') this.actions.resetZoom?.();
        else if (action === 'pan') this.actions.togglePan?.();
        else if (action === 'pixelated') this.actions.togglePixelated?.();
        else if (action === 'minimap') {
          this.minimapOpen = !this.minimapOpen;
          this._renderMinimapVisibility();
          this._clampDockPosition();
          this.actions.onMinimapToggle?.(this.minimapOpen);
        } else if (action === 'collapse') {
          this.collapsed = !this.collapsed;
          this.els.pill.classList.toggle('collapsed', this.collapsed);
          this.els.btnCollapse.setAttribute('aria-expanded', String(!this.collapsed));
          if (this.collapsed) {
            this.els.minimapCard.classList.remove('open');
          } else {
            this._renderMinimapVisibility();
          }
          this._updateCollapseIcon();
          this._clampDockPosition();
        }
      });

      // Editable zoom input
      const input = this.els.input;
      input.addEventListener('click', () => {
        if (this.collapsed) {
          this.collapsed = false;
          this.els.pill.classList.remove('collapsed');
          this.els.btnCollapse.setAttribute('aria-expanded', 'true');
          this._renderMinimapVisibility();
          this._updateCollapseIcon();
          this._clampDockPosition();
        }
      });

      input.addEventListener('focus', () => {
        this.isEditingInput = true;
        input.classList.remove('invalid');
        input.removeAttribute('aria-invalid');
        input.select();
        // Keep selection intact against the mouseup immediately following mousedown->focus
        input.addEventListener('mouseup', (e) => e.preventDefault(), { once: true });
      });

      input.addEventListener('input', () => {
        input.classList.remove('invalid');
        input.removeAttribute('aria-invalid');
      });

      input.addEventListener('blur', () => {
        this.isEditingInput = false;
        input.classList.remove('invalid');
        input.removeAttribute('aria-invalid');
        if (this.lastState) {
          input.value = ZMath.formatPercent(this.lastState.totalScale);
        }
      });

      input.addEventListener('keyup', (e) => e.stopPropagation());
      input.addEventListener('keypress', (e) => e.stopPropagation());
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          const parsed = ZMath.parseZoomInput(input.value);
          if (parsed !== null) {
            input.classList.remove('invalid');
            input.removeAttribute('aria-invalid');
            this.actions.setZoom?.(parsed);
            input.blur();
          } else {
            input.classList.add('invalid');
            input.setAttribute('aria-invalid', 'true');
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          input.blur();
        }
      });

      // Interactive minimap drag/click navigation (left-click only)
      const canvas = this.els.minimapCanvas;
      const navigateFromPointer = (e) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const nx = ZMath.clamp((e.clientX - rect.left) / rect.width, 0, 1);
        const ny = ZMath.clamp((e.clientY - rect.top) / rect.height, 0, 1);
        this.actions.panToNormalized?.(nx, ny);
      };

      canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.isDraggingMinimap = true;
        try {
          canvas.setPointerCapture?.(e.pointerId);
        } catch (_) {
          // Ignore
        }
        navigateFromPointer(e);
      });

      canvas.addEventListener('pointermove', (e) => {
        if (!this.isDraggingMinimap) return;
        navigateFromPointer(e);
      });

      const endMinimapDrag = (e) => {
        if (!this.isDraggingMinimap) return;
        this.isDraggingMinimap = false;
        try {
          if (canvas.hasPointerCapture?.(e.pointerId)) {
            canvas.releasePointerCapture(e.pointerId);
          }
        } catch (_) {
          // Ignore
        }
      };
      canvas.addEventListener('pointerup', endMinimapDrag);
      canvas.addEventListener('pointercancel', endMinimapDrag);
      canvas.addEventListener('lostpointercapture', endMinimapDrag);

      // Draggable HUD pill (left-click only)
      let startX = 0;
      let startY = 0;
      let startRight = 18;
      let startBottom = 18;

      this.els.dragHandle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.isDraggingDock = true;
        startX = e.clientX;
        startY = e.clientY;
        startRight = this.dockRight;
        startBottom = this.dockBottom;
        try {
          this.els.dragHandle.setPointerCapture?.(e.pointerId);
        } catch (_) {
          // Ignore
        }
      });

      this.els.dragHandle.addEventListener('pointermove', (e) => {
        if (!this.isDraggingDock) return;
        this.dockRight = startRight - (e.clientX - startX);
        this.dockBottom = startBottom - (e.clientY - startY);
        this._clampDockPosition();
      });

      const endDockDrag = (e) => {
        if (!this.isDraggingDock) return;
        this.isDraggingDock = false;
        try {
          if (this.els.dragHandle.hasPointerCapture?.(e.pointerId)) {
            this.els.dragHandle.releasePointerCapture(e.pointerId);
          }
        } catch (_) {
          // Ignore
        }
      };
      this.els.dragHandle.addEventListener('pointerup', endDockDrag);
      this.els.dragHandle.addEventListener('pointercancel', endDockDrag);
      this.els.dragHandle.addEventListener('lostpointercapture', endDockDrag);
    }

    _updateCollapseIcon() {
      if (!this.mounted) return;
      const svg = this.els.btnCollapse.querySelector('svg');
      if (!svg) return;
      svg.style.transform = this.collapsed ? 'rotate(180deg)' : '';
    }

    _renderMinimapVisibility() {
      if (!this.mounted) return;
      const canShow =
        this.minimapOpen &&
        !this.collapsed &&
        Boolean(this.lastState?.isCssActive) &&
        this.els.dock.classList.contains('visible');
      this.els.minimapCard.classList.toggle('open', canShow);
      this.els.btnMinimap.classList.toggle('active', canShow);
      this.els.btnMinimap.setAttribute('aria-pressed', String(canShow));
      if (canShow && this.lastState) {
        this._renderMinimapContent(this.lastState);
      }
    }

    _renderMinimapContent(state) {
      if (!this.mounted || !state || !state.isCssActive || !state.minimapRect) return;
      const isHyper = state.totalScale > 5.001;
      const r = state.minimapRect;
      const vp = this.els.minimapViewport;
      vp.style.left = `${(r.x * 100).toFixed(2)}%`;
      vp.style.top = `${(r.y * 100).toFixed(2)}%`;
      vp.style.width = `${(r.w * 100).toFixed(2)}%`;
      vp.style.height = `${(r.h * 100).toFixed(2)}%`;
      vp.classList.toggle('hyper', isHyper);

      if (state.mode === 'hybrid' && Math.abs(state.nativeZoom - 1) > 0.01) {
        const nStr = `${Math.round(state.nativeZoom * 10) / 10}×`;
        const cStr = `${Math.round(state.cssScale * 10) / 10}×`;
        this.els.minimapMeta.textContent = `Native ${nStr} · Opt ${cStr}`;
      } else {
        const sStr =
          state.totalScale >= 10
            ? `${Math.round(state.totalScale * 10) / 10}×`
            : `${Math.round(state.totalScale * 100) / 100}×`;
        this.els.minimapMeta.textContent = `Optical ${sStr}`;
      }
    }

    setMinimapPreference(open) {
      this.minimapOpen = Boolean(open);
      this._renderMinimapVisibility();
    }

    update(state) {
      this.lastState = state;
      if (!this.mounted) return;

      const isZoomed = Math.abs(state.totalScale - 1) > 0.002;
      const shouldShow = Boolean(state.settings?.showHud) && isZoomed;

      this.els.dock.classList.toggle('visible', shouldShow);
      this.els.dock.inert = !shouldShow;

      if (!shouldShow) {
        this.els.minimapCard.classList.remove('open');
        if (this.isEditingInput) {
          this.els.input.blur();
        }
        return;
      }

      const isHyper = state.totalScale > 5.001;
      this.els.statusDot.classList.toggle('hyper', isHyper);
      this.els.statusDot.title = isHyper
        ? 'Past 500% browser cap (arbitrary optical zoom)'
        : 'Zoom active';

      if (!this.isEditingInput) {
        this.els.input.value = ZMath.formatPercent(state.totalScale);
      }

      const cssActive = Boolean(state.isCssActive);
      this.els.btnPan.disabled = !cssActive;
      this.els.btnMinimap.disabled = !cssActive;

      const panOn = cssActive && Boolean(state.panMode);
      this.els.btnPan.classList.toggle('active', panOn);
      this.els.btnPan.setAttribute('aria-pressed', String(panOn));

      const pixOn = Boolean(state.pixelated);
      this.els.btnPixelated.classList.toggle('active', pixOn);
      this.els.btnPixelated.setAttribute('aria-pressed', String(pixOn));

      this._renderMinimapVisibility();
      this._clampDockPosition();
    }

    destroy() {
      window.removeEventListener('resize', this._onResize);
      if (this.host) {
        this.host.remove();
        this.host = null;
      }
      this.mounted = false;
    }
  }

  ns.ZoomHud = ZoomHud;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZoomHud;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
