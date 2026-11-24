(function initZoomEngine(root) {
  'use strict';

  const ns = (root.ArbZoom = root.ArbZoom || {});
  const C = ns.CONSTANTS;
  const ZMath = ns.Math;

  function isEditableElement(el) {
    if (!el) return false;
    const node = el.nodeType === 3 ? el.parentElement : el;
    if (!node || node.nodeType !== 1) return false;
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (node.isContentEditable) return true;
    return false;
  }

  function isEditableFromEvent(e) {
    if (e?.isComposing) return true;
    if (typeof e?.composedPath === 'function') {
      const path = e.composedPath();
      for (const item of path) {
        if (isEditableElement(item)) return true;
      }
      return false;
    }
    return isEditableElement(e?.target);
  }

  function isInteractiveSpaceTarget(e) {
    const check = (item) => {
      if (!item || item.nodeType !== 1) return false;
      const tag = item.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true;
      const role = item.getAttribute?.('role');
      if (role === 'button' || role === 'link' || role === 'checkbox' || role === 'switch' || role === 'tab') {
        return true;
      }
      return false;
    };
    if (typeof e?.composedPath === 'function') {
      return e.composedPath().some(check);
    }
    return check(e?.target);
  }

  function isScrollableOverflow(val) {
    return val === 'auto' || val === 'scroll' || val === 'overlay';
  }

  function canElementScrollX(el, deltaX) {
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 1) return false;
    const style = window.getComputedStyle(el);
    if (!isScrollableOverflow(style.overflowX)) return false;

    const isRtl = style.direction === 'rtl';
    const sl = el.scrollLeft || 0;
    if (isRtl && sl <= 0) {
      // Standard negative RTL scrollLeft: [-(maxScroll) .. 0]
      if (deltaX < 0 && sl > -maxScroll + 1) return true;
      if (deltaX > 0 && sl < -1) return true;
      return false;
    }
    if (deltaX > 0 && sl + el.clientWidth < el.scrollWidth - 1) return true;
    if (deltaX < 0 && sl > 1) return true;
    return false;
  }

  function canElementScrollY(el, deltaY) {
    if (el.scrollHeight - el.clientHeight <= 1) return false;
    const style = window.getComputedStyle(el);
    if (!isScrollableOverflow(style.overflowY)) return false;
    const st = el.scrollTop || 0;
    if (deltaY > 0 && st + el.clientHeight < el.scrollHeight - 1) return true;
    if (deltaY < 0 && st > 1) return true;
    return false;
  }

  function findScrollableAncestor(event, deltaX, deltaY, allowBody = false) {
    const nodes =
      typeof event?.composedPath === 'function'
        ? event.composedPath()
        : (() => {
            const arr = [];
            let cur = event?.target;
            while (cur) {
              arr.push(cur);
              cur = cur.parentElement;
            }
            return arr;
          })();

    for (const el of nodes) {
      if (!el || el.nodeType !== 1) continue;
      if (el === document.documentElement) break;
      if (el === document.body && !allowBody) break;

      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        if (canElementScrollY(el, deltaY)) return el;
      } else {
        if (canElementScrollX(el, deltaX)) return el;
      }
    }
    return null;
  }

  function saveInlineProp(style, prop) {
    return {
      value: style.getPropertyValue(prop),
      priority: style.getPropertyPriority(prop),
    };
  }

  function restoreInlineProp(style, prop, saved) {
    if (saved && saved.value) {
      style.setProperty(prop, saved.value, saved.priority || '');
    } else {
      style.removeProperty(prop);
    }
  }

  class ZoomEngine {
    constructor(options = {}) {
      this.settings = { ...C.DEFAULT_SETTINGS, ...(options.settings || {}) };
      this.onStateChange = options.onStateChange || (() => {});
      this.syncNativeZoom =
        options.syncNativeZoom || (async () => ({ actualNativeZoom: 1, ok: false }));
      this.isHudEvent = options.isHudEvent || (() => false);

      // Core state
      this.totalScale = 1;
      this.nativeZoom = 1;
      this.observedMaxNativeZoom = C.NATIVE_MAX_ZOOM;
      this.cssScale = 1;
      this.tx = 0;
      this.ty = 0;
      this.originX = 0;
      this.originY = 0;
      this.isCssActive = false;
      this.htmlWasOverflowHidden = false;

      // Native sync coordination
      this.nativeSyncSeq = 0;
      this.nativeSyncInFlight = false;
      this.nativeSyncTimer = null;
      this.pendingNativeTarget = null;
      this.activeNativeSyncPromise = Promise.resolve();

      // Interaction state
      this.panMode = false;
      this.spaceHeld = false;
      this.isDragging = false;
      this.dragMoved = false;
      this.activePointerId = null;
      this.dragButton = null;
      this.dragStartX = 0;
      this.dragStartY = 0;
      this.dragStartTx = 0;
      this.dragStartTy = 0;
      this.suppressNextClick = false;
      this.suppressClickTimer = null;

      this.lastPointerX = null;
      this.lastPointerY = null;

      // Saved original inline styles for spotless cleanup on reset
      this.savedStyles = null;
      this.pixelatedStyleEl = null;
      this.rafId = null;
      this.destroyed = false;

      this._bindHandlers();
      this._syncPixelatedStyle();
    }

    _getZoomTarget() {
      if (document.body) return document.body;
      const rootEl = document.documentElement;
      if (rootEl && String(rootEl.tagName || '').toLowerCase() === 'svg') {
        return rootEl;
      }
      return null;
    }

    _instantScrollTo(x, y) {
      try {
        window.scrollTo({ left: x, top: y, behavior: 'instant' });
      } catch (_) {
        window.scrollTo(x, y);
      }
    }

    _bindHandlers() {
      this._onWheel = this._handleWheel.bind(this);
      this._onKeyDown = this._handleKeyDown.bind(this);
      this._onKeyUp = this._handleKeyUp.bind(this);
      this._onPointerDown = this._handlePointerDown.bind(this);
      this._onPointerMove = this._handlePointerMove.bind(this);
      this._onPointerUp = this._handlePointerUp.bind(this);
      this._onLostPointerCapture = this._handlePointerUp.bind(this);
      this._onMouseDown = this._handleMouseDown.bind(this);
      this._onClickCapture = this._handleClickCapture.bind(this);
      this._onAuxClickCapture = this._handleAuxClickCapture.bind(this);
      this._onResize = this._handleResize.bind(this);
      this._onBlur = this._handleBlur.bind(this);

      window.addEventListener('wheel', this._onWheel, { passive: false, capture: true });
      window.addEventListener('keydown', this._onKeyDown, { capture: true });
      window.addEventListener('keyup', this._onKeyUp, { capture: true });
      window.addEventListener('pointerdown', this._onPointerDown, { capture: true });
      window.addEventListener('pointermove', this._onPointerMove, { passive: true, capture: true });
      window.addEventListener('pointerup', this._onPointerUp, { capture: true });
      window.addEventListener('pointercancel', this._onPointerUp, { capture: true });
      window.addEventListener('lostpointercapture', this._onLostPointerCapture, { capture: true });
      window.addEventListener('mousedown', this._onMouseDown, { capture: true });
      window.addEventListener('click', this._onClickCapture, { capture: true });
      window.addEventListener('auxclick', this._onAuxClickCapture, { capture: true });
      window.addEventListener('resize', this._onResize, { passive: true });
      window.addEventListener('blur', this._onBlur);
    }

    destroy() {
      this.destroyed = true;
      window.removeEventListener('wheel', this._onWheel, { capture: true });
      window.removeEventListener('keydown', this._onKeyDown, { capture: true });
      window.removeEventListener('keyup', this._onKeyUp, { capture: true });
      window.removeEventListener('pointerdown', this._onPointerDown, { capture: true });
      window.removeEventListener('pointermove', this._onPointerMove, { capture: true });
      window.removeEventListener('pointerup', this._onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', this._onPointerUp, { capture: true });
      window.removeEventListener('lostpointercapture', this._onLostPointerCapture, { capture: true });
      window.removeEventListener('mousedown', this._onMouseDown, { capture: true });
      window.removeEventListener('click', this._onClickCapture, { capture: true });
      window.removeEventListener('auxclick', this._onAuxClickCapture, { capture: true });
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('blur', this._onBlur);
      if (this.rafId) cancelAnimationFrame(this.rafId);
      if (this.suppressClickTimer) clearTimeout(this.suppressClickTimer);
      this._cancelPendingNativeSync();
      this._deactivateCssTransform(false);
      this._applyPixelatedStyle(false);
    }

    getViewportSize() {
      return {
        vw: window.innerWidth || document.documentElement?.clientWidth || 1,
        vh: window.innerHeight || document.documentElement?.clientHeight || 1,
      };
    }

    getDocumentSize() {
      const { vw, vh } = this.getViewportSize();
      const target = this._getZoomTarget();
      const html = document.documentElement;
      if (!target) return { docW: vw, docH: vh };

      const targetW = Math.max(target.scrollWidth || 0, target.offsetWidth || 0);
      const targetH = Math.max(target.scrollHeight || 0, target.offsetHeight || 0);

      if (!this.isCssActive) {
        return {
          docW: Math.max(1, targetW || vw, html?.scrollWidth || 0),
          docH: Math.max(1, targetH || vh, html?.scrollHeight || 0),
        };
      }

      const rect = target.getBoundingClientRect();
      const scale = this.cssScale || 1;
      const rectW = Number.isFinite(rect.width) ? rect.width / scale : 0;
      const rectH = Number.isFinite(rect.height) ? rect.height / scale : 0;

      // Do not inflate narrow centered <body> up to vw/vh when CSS transform is active
      return {
        docW: Math.max(1, targetW, rectW),
        docH: Math.max(1, targetH, rectH),
      };
    }

    _measureLiveOrigin() {
      const target = this._getZoomTarget();
      if (!target || !this.isCssActive) return;
      const rect = target.getBoundingClientRect();
      if (Number.isFinite(rect.left) && Number.isFinite(rect.top)) {
        this.originX = rect.left - this.tx;
        this.originY = rect.top - this.ty;
      }
    }

    getState() {
      const { vw, vh } = this.getViewportSize();
      const { docW, docH } = this.getDocumentSize();
      const camTx = this.isCssActive ? this.tx : -(window.scrollX || 0);
      const camTy = this.isCssActive ? this.ty : -(window.scrollY || 0);
      const minimapRect = ZMath.computeMinimapRect(
        { cssScale: this.cssScale, tx: camTx, ty: camTy },
        vw,
        vh,
        docW,
        docH,
        this.isCssActive ? this.originX : 0,
        this.isCssActive ? this.originY : 0
      );

      return {
        totalScale: this.totalScale,
        nativeZoom: this.nativeZoom,
        cssScale: this.cssScale,
        tx: this.tx,
        ty: this.ty,
        isCssActive: this.isCssActive,
        panMode: this.panMode,
        pixelated: Boolean(this.settings.pixelated),
        mode: this.settings.mode,
        docW,
        docH,
        vw,
        vh,
        minimapRect,
        settings: { ...this.settings },
      };
    }

    _notify(meta = {}) {
      if (this.destroyed) return this.getState();
      const state = this.getState();
      this.onStateChange(state, meta);
      return state;
    }

    waitForNativeSync() {
      return this.activeNativeSyncPromise;
    }

    /**
     * Synchronizes engine state with an external native zoom factor (e.g. pre-existing
     * browser zoom on page load or native Ctrl+/-/0 via tabs.onZoomChange).
     */
    syncExternalNativeZoom(actualZoom) {
      if (!Number.isFinite(actualZoom) || actualZoom <= 0) return;
      if (Math.abs(actualZoom - this.nativeZoom) < 0.002) return;

      const prevNative = this.nativeZoom || 1;
      const k = actualZoom / prevNative;
      this.nativeZoom = actualZoom;

      if (this.isCssActive) {
        const prevOriginX = this.originX;
        const prevOriginY = this.originY;
        this._measureLiveOrigin();
        this.tx = (this.tx + prevOriginX) / k - this.originX;
        this.ty = (this.ty + prevOriginY) / k - this.originY;
        if (this.lastPointerX !== null) this.lastPointerX /= k;
        if (this.lastPointerY !== null) this.lastPointerY /= k;
        this._applyTransformNow();
      }

      this.totalScale = ZMath.clampScale(this.nativeZoom * this.cssScale);
      this._syncPixelatedStyle();
      this._notify({ userZoomChanged: false });
    }

    updateSettings(partial) {
      if (!partial || typeof partial !== 'object') return;

      const changed = Object.keys(partial).some((k) => this.settings[k] !== partial[k]);
      if (!changed) return;

      const prevMode = this.settings.mode;
      this.settings = { ...this.settings, ...partial };
      this._syncPixelatedStyle();

      if (prevMode !== this.settings.mode) {
        const target = this.totalScale;
        this.setZoom(target, {
          focalX: null,
          focalY: null,
          snap: false,
          immediateNative: true,
          userInitiated: false,
        });
      } else {
        this._notify({ userZoomChanged: false });
      }
    }

    setPanMode(enabled) {
      this.panMode = Boolean(enabled);
      this._updateCursor();
      this._notify({ userZoomChanged: false });
    }

    togglePanMode() {
      this.setPanMode(!this.panMode);
    }

    setPixelated(enabled) {
      this.settings.pixelated = Boolean(enabled);
      this._syncPixelatedStyle();
      this._notify({ userZoomChanged: false });
    }

    _syncPixelatedStyle() {
      // Only degrade image interpolation when zoomed in (> 100%)
      const shouldEnable = Boolean(this.settings.pixelated) && this.totalScale > 1.001;
      this._applyPixelatedStyle(shouldEnable);
    }

    _applyPixelatedStyle(enabled) {
      if (enabled) {
        if (this.pixelatedStyleEl && this.pixelatedStyleEl.isConnected) return;
        const parent = document.head || document.documentElement;
        if (!parent) return;
        const style = document.createElement('style');
        style.id = 'arb-zoom-pixelated-style';
        // crisp-edges first as fallback, pixelated last so modern Chromium & Firefox use nearest-neighbor
        style.textContent =
          'img, canvas, video { image-rendering: crisp-edges !important; image-rendering: pixelated !important; }';
        parent.appendChild(style);
        this.pixelatedStyleEl = style;
      } else if (this.pixelatedStyleEl) {
        this.pixelatedStyleEl.remove();
        this.pixelatedStyleEl = null;
      }
    }

    _activateCssTransform() {
      if (this.isCssActive) return true;
      const target = this._getZoomTarget();
      const html = document.documentElement;
      if (!target || !html) return false;

      const isBody = target === document.body;
      const scrollX = window.scrollX || html.scrollLeft || 0;
      const scrollY = window.scrollY || html.scrollTop || 0;

      const htmlComputed = window.getComputedStyle(html);
      const htmlOverflowVisible =
        (!htmlComputed.overflowX || htmlComputed.overflowX === 'visible') &&
        (!htmlComputed.overflowY || htmlComputed.overflowY === 'visible');
      this.htmlWasOverflowHidden =
        htmlComputed.overflowX === 'hidden' && htmlComputed.overflowY === 'hidden';

      const preRect = target.getBoundingClientRect();
      const preVisualLeft = preRect.left;
      const preVisualTop = preRect.top;

      this.savedStyles = {
        target,
        htmlOverflowX: saveInlineProp(html.style, 'overflow-x'),
        htmlOverflowY: saveInlineProp(html.style, 'overflow-y'),
        htmlOverscrollX: saveInlineProp(html.style, 'overscroll-behavior-x'),
        htmlOverscrollY: saveInlineProp(html.style, 'overscroll-behavior-y'),
        htmlCursor: saveInlineProp(html.style, 'cursor'),
        targetTransform: saveInlineProp(target.style, 'transform'),
        targetOrigin: saveInlineProp(target.style, 'transform-origin'),
        bodyOverflowX: isBody ? saveInlineProp(target.style, 'overflow-x') : null,
        bodyOverflowY: isBody ? saveInlineProp(target.style, 'overflow-y') : null,
      };

      // Prevent setting html{overflow:hidden} from stopping body overflow propagation and clipping tall pages
      if (isBody && htmlOverflowVisible) {
        target.style.setProperty('overflow-x', 'visible', 'important');
        target.style.setProperty('overflow-y', 'visible', 'important');
      }

      if (isBody) {
        html.style.setProperty('overflow-x', 'hidden', 'important');
        html.style.setProperty('overflow-y', 'hidden', 'important');
        html.style.setProperty('overscroll-behavior-x', 'none', 'important');
        html.style.setProperty('overscroll-behavior-y', 'none', 'important');
        this._instantScrollTo(0, 0);
      }

      target.style.setProperty('transform-origin', '0 0', 'important');
      target.style.setProperty('transform', 'none', 'important');

      // Re-measure target layout origin AFTER scrollbar removal & scrollTo(0, 0) for zero drift
      const postRect = target.getBoundingClientRect();
      this.originX = Number.isFinite(postRect.left) ? postRect.left : preVisualLeft + scrollX;
      this.originY = Number.isFinite(postRect.top) ? postRect.top : preVisualTop + scrollY;

      // Keep exact pre-activation visual position on screen (pixel-identical transition!)
      this.tx = preVisualLeft - this.originX;
      this.ty = preVisualTop - this.originY;
      this.cssScale = 1;
      this.isCssActive = true;
      return true;
    }

    _deactivateCssTransform(restoreScroll = true) {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }

      const wasActive = this.isCssActive;
      const html = document.documentElement;
      const target = this.savedStyles?.target || this._getZoomTarget();

      let restoreX = 0;
      let restoreY = 0;
      if (wasActive && restoreScroll && target === document.body) {
        const { vw, vh } = this.getViewportSize();
        const scale = this.cssScale || 1;
        const centerPageX = this.originX + (vw / 2 - this.originX - this.tx) / scale;
        const centerPageY = this.originY + (vh / 2 - this.originY - this.ty) / scale;
        restoreX = Math.max(0, Math.round(centerPageX - vw / 2));
        restoreY = Math.max(0, Math.round(centerPageY - vh / 2));
      }

      if (wasActive && html && target) {
        const s = this.savedStyles;
        if (s) {
          restoreInlineProp(html.style, 'overflow-x', s.htmlOverflowX);
          restoreInlineProp(html.style, 'overflow-y', s.htmlOverflowY);
          restoreInlineProp(html.style, 'overscroll-behavior-x', s.htmlOverscrollX);
          restoreInlineProp(html.style, 'overscroll-behavior-y', s.htmlOverscrollY);
          restoreInlineProp(html.style, 'cursor', s.htmlCursor);
          restoreInlineProp(target.style, 'transform', s.targetTransform);
          restoreInlineProp(target.style, 'transform-origin', s.targetOrigin);
          if (s.bodyOverflowX !== null) {
            restoreInlineProp(target.style, 'overflow-x', s.bodyOverflowX);
            restoreInlineProp(target.style, 'overflow-y', s.bodyOverflowY);
          }
        } else {
          html.style.removeProperty('overflow-x');
          html.style.removeProperty('overflow-y');
          html.style.removeProperty('overscroll-behavior-x');
          html.style.removeProperty('overscroll-behavior-y');
          html.style.removeProperty('cursor');
          target.style.removeProperty('transform');
          target.style.removeProperty('transform-origin');
        }
      }

      this.savedStyles = null;
      this.isCssActive = false;
      this.htmlWasOverflowHidden = false;
      this.tx = 0;
      this.ty = 0;
      this.cssScale = 1;
      this.originX = 0;
      this.originY = 0;
      this.panMode = false;
      this.isDragging = false;
      this.dragMoved = false;
      this.spaceHeld = false;
      this.activePointerId = null;
      this.dragButton = null;

      if (wasActive && restoreScroll && target === document.body) {
        this._instantScrollTo(restoreX, restoreY);
      }
    }

    _applyTransformNow() {
      if (!this.isCssActive) return;
      const target = this.savedStyles?.target || this._getZoomTarget();
      if (!target) return;
      // 2D translate + scale without permanent will-change lets Blink/Gecko re-rasterize crisply
      const tx = Math.round(this.tx * 100) / 100;
      const ty = Math.round(this.ty * 100) / 100;
      target.style.setProperty('transform', `translate(${tx}px, ${ty}px) scale(${this.cssScale})`, 'important');
    }

    _scheduleRender() {
      if (this.rafId) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this._applyTransformNow();
        this._notify({ userZoomChanged: false });
      });
    }

    _cancelPendingNativeSync() {
      this.nativeSyncSeq += 1;
      this.pendingNativeTarget = null;
      if (this.nativeSyncTimer) {
        clearTimeout(this.nativeSyncTimer);
        this.nativeSyncTimer = null;
      }
    }

    _scheduleNativeSync(targetNativeZoom, immediate = false) {
      this._cancelPendingNativeSync();
      const seq = this.nativeSyncSeq;
      this.pendingNativeTarget = targetNativeZoom;

      const execute = async () => {
        this.nativeSyncTimer = null;
        if (this.destroyed || seq !== this.nativeSyncSeq) return;

        const requested = this.pendingNativeTarget;
        if (requested == null) return;
        this.pendingNativeTarget = null;

        const prevNative = this.nativeZoom || 1;
        const prevOriginX = this.originX;
        const prevOriginY = this.originY;
        this.nativeSyncInFlight = true;

        let res = null;
        try {
          res = await this.syncNativeZoom(requested);
        } finally {
          if (seq === this.nativeSyncSeq) {
            this.nativeSyncInFlight = false;
          }
        }

        if (this.destroyed || seq !== this.nativeSyncSeq) return;

        if (res && res.ok && Number.isFinite(res.actualNativeZoom) && res.actualNativeZoom > 0) {
          const actual = res.actualNativeZoom;
          // Cache lower browser zoom cap (e.g. Firefox 3.0x) so we don't spam syncNativeZoom
          if (requested > actual + 0.01) {
            this.observedMaxNativeZoom = actual;
          } else if (actual > this.observedMaxNativeZoom) {
            this.observedMaxNativeZoom = actual;
          }

          this.nativeZoom = actual;
          const k = actual / prevNative;

          // Rescale existing (tx, ty) from old CSS pixel space into the new native-zoom CSS space
          if (this.isCssActive && Math.abs(k - 1) > 1e-4) {
            this._measureLiveOrigin();
            this.tx = (this.tx + prevOriginX) / k - this.originX;
            this.ty = (this.ty + prevOriginY) / k - this.originY;
            this.cssScale = ZMath.clampScale(this.cssScale / k);
            if (this.lastPointerX !== null) this.lastPointerX /= k;
            if (this.lastPointerY !== null) this.lastPointerY /= k;
          }

          const desiredCss = ZMath.clampScale(this.totalScale / this.nativeZoom);
          const cleanCss = Math.abs(desiredCss - 1) < 0.002 ? 1 : desiredCss;
          const { vw, vh } = this.getViewportSize();
          this._applyCssScale(cleanCss, vw / 2, vh / 2);
          this._syncPixelatedStyle();
          this._notify({ userZoomChanged: false });
        }
      };

      if (immediate) {
        this.activeNativeSyncPromise = execute();
      } else {
        this.activeNativeSyncPromise = new Promise((resolve) => {
          this.nativeSyncTimer = setTimeout(() => {
            execute().finally(resolve);
          }, 90);
        });
      }
      return this.activeNativeSyncPromise;
    }

    _applyCssScale(nextCssScale, focalX, focalY) {
      const cleanCss = Math.abs(nextCssScale - 1) < 0.001 ? 1 : ZMath.clampScale(nextCssScale);

      if (cleanCss === 1) {
        this._deactivateCssTransform(true);
        return true;
      }

      if (!this.isCssActive) {
        if (!this._activateCssTransform()) return false;
      }

      const { vw, vh } = this.getViewportSize();
      const fx = typeof focalX === 'number' ? focalX : vw / 2;
      const fy = typeof focalY === 'number' ? focalY : vh / 2;

      const zoomed = ZMath.zoomAroundPoint(
        { cssScale: this.cssScale, tx: this.tx, ty: this.ty },
        cleanCss,
        fx,
        fy,
        this.originX,
        this.originY
      );

      const { docW, docH } = this.getDocumentSize();
      const clamped = ZMath.clampPan(zoomed, vw, vh, docW, docH, this.originX, this.originY);

      this.cssScale = clamped.cssScale;
      this.tx = clamped.tx;
      this.ty = clamped.ty;
      this._applyTransformNow();
      this._updateCursor();
      return true;
    }

    setZoom(targetScale, options = {}) {
      if (!this._getZoomTarget()) {
        return this.getState();
      }

      const prevTotal = this.totalScale;
      const useSnap = options.snap !== undefined ? options.snap : false;
      const nextTotal = ZMath.applyMagneticSnap(
        targetScale,
        prevTotal,
        useSnap && this.settings.magneticSnap
      );

      this.totalScale = nextTotal;

      const { vw, vh } = this.getViewportSize();
      const focalX =
        typeof options.focalX === 'number'
          ? options.focalX
          : options.usePointer && this.lastPointerX !== null
            ? this.lastPointerX
            : vw / 2;
      const focalY =
        typeof options.focalY === 'number'
          ? options.focalY
          : options.usePointer && this.lastPointerY !== null
            ? this.lastPointerY
            : vh / 2;

      if (this.settings.mode === 'hybrid') {
        const split = ZMath.splitHybridZoom(nextTotal, 'hybrid', this.observedMaxNativeZoom);
        const immediateCss = ZMath.clampScale(nextTotal / (this.nativeZoom || 1));
        this._applyCssScale(immediateCss, focalX, focalY);

        if (Math.abs(split.nativeZoom - this.nativeZoom) > 0.002 || this.nativeSyncInFlight) {
          this._scheduleNativeSync(split.nativeZoom, Boolean(options.immediateNative));
        } else {
          // Cancel any stale debounced timer targeting a different native zoom
          this._cancelPendingNativeSync();
        }
      } else {
        // Pure optical mode
        if (Math.abs(this.nativeZoom - 1) > 0.002 || this.nativeSyncInFlight) {
          // Keep visual zoom coherent until syncNativeZoom(1) finishes
          const immediateCss = ZMath.clampScale(nextTotal / (this.nativeZoom || 1));
          this._applyCssScale(immediateCss, focalX, focalY);
          this._scheduleNativeSync(1, true);
        } else {
          this._cancelPendingNativeSync();
          this._applyCssScale(nextTotal, focalX, focalY);
        }
      }

      this._syncPixelatedStyle();
      const userZoomChanged =
        options.userInitiated !== false && Math.abs(this.totalScale - prevTotal) > 1e-6;
      return this._notify({ userZoomChanged });
    }

    stepZoom(direction, options = {}) {
      const factor = this.settings.stepFactor || 1.25;
      const next = direction > 0 ? this.totalScale * factor : this.totalScale / factor;
      return this.setZoom(next, {
        snap: true,
        usePointer: options.usePointer ?? false,
        focalX: options.focalX,
        focalY: options.focalY,
        immediateNative: true,
        userInitiated: options.userInitiated ?? true,
      });
    }

    resetZoom(options = {}) {
      const prevTotal = this.totalScale;
      this.panMode = false;
      this.totalScale = 1;

      if (Math.abs(this.nativeZoom - 1) > 0.002 || this.nativeSyncInFlight) {
        this._deactivateCssTransform(true);
        this._scheduleNativeSync(1, true);
      } else {
        this._cancelPendingNativeSync();
        this._deactivateCssTransform(true);
      }

      this._syncPixelatedStyle();
      const userZoomChanged = options.userInitiated !== false && Math.abs(prevTotal - 1) > 1e-6;
      return this._notify({ userZoomChanged });
    }

    panBy(deltaX, deltaY) {
      if (!this.isCssActive) return;
      const { vw, vh } = this.getViewportSize();
      const { docW, docH } = this.getDocumentSize();
      const clamped = ZMath.clampPan(
        { cssScale: this.cssScale, tx: this.tx + deltaX, ty: this.ty + deltaY },
        vw,
        vh,
        docW,
        docH,
        this.originX,
        this.originY
      );
      this.tx = clamped.tx;
      this.ty = clamped.ty;
      this._scheduleRender();
    }

    panToNormalized(nx, ny) {
      if (!this.isCssActive) return;
      const { vw, vh } = this.getViewportSize();
      const { docW, docH } = this.getDocumentSize();
      const next = ZMath.panToNormalizedPoint(
        { cssScale: this.cssScale, tx: this.tx, ty: this.ty },
        nx,
        ny,
        vw,
        vh,
        docW,
        docH,
        this.originX,
        this.originY
      );
      this.tx = next.tx;
      this.ty = next.ty;
      this._applyTransformNow();
      this._notify({ userZoomChanged: false });
    }

    centerView() {
      if (!this.isCssActive) return;
      this.panToNormalized(0.5, 0.5);
    }

    _matchesWheelTrigger(e) {
      const trigger = this.settings.wheelTrigger;
      if (trigger === 'off') return false;
      if (trigger === 'both') return e.ctrlKey || e.altKey;
      if (trigger === 'alt') return e.altKey;
      if (trigger === 'ctrl') return e.ctrlKey;
      if (trigger === 'shift') return e.shiftKey;
      return false;
    }

    _normalizeWheelDelta(e) {
      let dx = e.deltaX || 0;
      let dy = e.deltaY || 0;
      if (e.deltaMode === 1) {
        dx *= 32;
        dy *= 32;
      } else if (e.deltaMode === 2) {
        dx *= window.innerWidth || 1000;
        dy *= window.innerHeight || 800;
      }
      return { dx, dy };
    }

    _handleWheel(e) {
      if (this.isHudEvent(e)) return;

      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      const { dx, dy } = this._normalizeWheelDelta(e);

      if (this._matchesWheelTrigger(e)) {
        e.preventDefault();
        e.stopPropagation();

        // On macOS / Shift-horizontal drivers, Shift + vertical wheel populates deltaX with deltaY=0
        let zoomDelta = dy;
        if (e.shiftKey && Math.abs(dy) < 0.01 && Math.abs(dx) > 0) {
          zoomDelta = dx;
        }
        if (Math.abs(zoomDelta) < 0.01) return;

        const clampedDelta = ZMath.clamp(zoomDelta, -220, 220);
        const sensitivity = this.settings.wheelSensitivity || 1.0;
        const factor = Math.exp(-clampedDelta * 0.0024 * sensitivity);
        const nextTotal = this.totalScale * factor;

        this.setZoom(nextTotal, {
          focalX: e.clientX,
          focalY: e.clientY,
          snap: true,
          userInitiated: true,
        });
        return;
      }

      if (this.isCssActive) {
        // Remap Shift + vertical wheel to horizontal BEFORE checking nested scrollable containers
        const effDx = e.shiftKey && Math.abs(dx) < 0.5 && Math.abs(dy) > 0 ? dy : dx;
        const effDy = e.shiftKey && Math.abs(dx) < 0.5 && Math.abs(dy) > 0 ? 0 : dy;

        const scrollable = findScrollableAncestor(e, effDx, effDy, this.htmlWasOverflowHidden);
        if (scrollable) return;

        e.preventDefault();
        this.panBy(-effDx, -effDy);
      }
    }

    _handleKeyDown(e) {
      if (this.isHudEvent(e)) return;
      const editable = isEditableFromEvent(e);

      // Spacebar temporary pan mode while zoomed (skip inputs & focused interactive buttons/links)
      if (
        e.code === 'Space' &&
        !editable &&
        !isInteractiveSpaceTarget(e) &&
        this.isCssActive &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        if (!this.spaceHeld) {
          this.spaceHeld = true;
          this._updateCursor();
        }
        return;
      }

      if (e.key === 'Escape' && this.panMode) {
        this.setPanMode(false);
        return;
      }

      if (editable) return;

      // In-page shortcuts: Alt+=/-/0 (using e.code too so macOS Option+=/−/0 works!)
      const altOnly = e.altKey && !e.ctrlKey && !e.metaKey;
      const ctrlOrMeta = (e.ctrlKey || e.metaKey) && !e.altKey;
      const allowKey =
        (this.settings.keyboardShortcuts && altOnly) ||
        (this.settings.overrideCtrlKeys && ctrlOrMeta);

      if (allowKey) {
        if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') {
          e.preventDefault();
          e.stopPropagation();
          this.stepZoom(1, { usePointer: true });
          return;
        }
        if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
          e.preventDefault();
          e.stopPropagation();
          this.stepZoom(-1, { usePointer: true });
          return;
        }
        if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
          e.preventDefault();
          e.stopPropagation();
          this.resetZoom();
          return;
        }
      }

      // Arrow-key panning when CSS zoom is active
      if (this.isCssActive && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const step = e.shiftKey ? 260 : 90;
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.panBy(0, step);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.panBy(0, -step);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.panBy(step, 0);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.panBy(-step, 0);
        }
      }
    }

    _handleKeyUp(e) {
      if (e.code === 'Space' && this.spaceHeld) {
        this.spaceHeld = false;
        this._updateCursor();
      }
    }

    _canDragPan(e) {
      if (!this.isCssActive) return false;
      if (e.button === 1) return true; // Middle mouse button always pans while zoomed
      if (e.button === 0 && (this.panMode || this.spaceHeld)) return true;
      return false;
    }

    _handleMouseDown(e) {
      if (this.isHudEvent(e)) return;
      // Suppress native middle-click autoscroll and text selection when dragging to pan
      if (this._canDragPan(e)) {
        e.preventDefault();
      }
    }

    _handlePointerDown(e) {
      if (this.isHudEvent(e)) return;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      if (!this._canDragPan(e)) return;
      if (this.isDragging) return;

      e.preventDefault();
      e.stopPropagation();
      this.isDragging = true;
      this.dragMoved = false;
      this.activePointerId = e.pointerId ?? null;
      this.dragButton = e.button;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragStartTx = this.tx;
      this.dragStartTy = this.ty;

      if (e.pointerId != null) {
        try {
          document.documentElement?.setPointerCapture?.(e.pointerId);
        } catch (_) {
          // Ignore environments without root pointer capture
        }
      }
      this._updateCursor();
    }

    _endDrag(pointerId) {
      if (!this.isDragging) return;
      this.isDragging = false;
      if (pointerId != null) {
        try {
          if (document.documentElement?.hasPointerCapture?.(pointerId)) {
            document.documentElement.releasePointerCapture(pointerId);
          }
        } catch (_) {
          // Ignore
        }
      }
      this.activePointerId = null;
      this.dragButton = null;

      if (this.dragMoved) {
        this.suppressNextClick = true;
        if (this.suppressClickTimer) clearTimeout(this.suppressClickTimer);
        this.suppressClickTimer = setTimeout(() => {
          this.suppressClickTimer = null;
          this.suppressNextClick = false;
        }, 0);
      }
      this._updateCursor();
    }

    _handlePointerMove(e) {
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      if (!this.isDragging) return;
      if (this.activePointerId !== null && e.pointerId != null && e.pointerId !== this.activePointerId) {
        return;
      }

      // Guard against mouse button released outside window or over cross-origin iframe
      if (e.pointerType === 'mouse' && typeof e.buttons === 'number') {
        const expectedMask = this.dragButton === 1 ? 4 : 1;
        if ((e.buttons & expectedMask) === 0) {
          this._endDrag(e.pointerId);
          return;
        }
      }

      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      if (Math.hypot(dx, dy) > 3) {
        this.dragMoved = true;
      }

      const { vw, vh } = this.getViewportSize();
      const { docW, docH } = this.getDocumentSize();
      const clamped = ZMath.clampPan(
        { cssScale: this.cssScale, tx: this.dragStartTx + dx, ty: this.dragStartTy + dy },
        vw,
        vh,
        docW,
        docH,
        this.originX,
        this.originY
      );
      this.tx = clamped.tx;
      this.ty = clamped.ty;
      this._applyTransformNow();
      this._scheduleRender();
    }

    _handlePointerUp(e) {
      if (!this.isDragging) return;
      if (this.activePointerId !== null && e?.pointerId != null && e.pointerId !== this.activePointerId) {
        return;
      }
      this._endDrag(e?.pointerId ?? this.activePointerId);
    }

    _handleClickCapture(e) {
      if (this.isHudEvent(e)) return;
      if (this.suppressNextClick || (this.isCssActive && (this.panMode || this.spaceHeld))) {
        e.preventDefault();
        e.stopPropagation();
        this.suppressNextClick = false;
        if (this.suppressClickTimer) {
          clearTimeout(this.suppressClickTimer);
          this.suppressClickTimer = null;
        }
      }
    }

    _handleAuxClickCapture(e) {
      if (this.isHudEvent(e)) return;
      if (e.button === 1 && (this.isCssActive || this.suppressNextClick)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    _handleResize() {
      if (!this.isCssActive) return;
      this._measureLiveOrigin();
      const { vw, vh } = this.getViewportSize();
      const { docW, docH } = this.getDocumentSize();
      const clamped = ZMath.clampPan(
        { cssScale: this.cssScale, tx: this.tx, ty: this.ty },
        vw,
        vh,
        docW,
        docH,
        this.originX,
        this.originY
      );
      this.tx = clamped.tx;
      this.ty = clamped.ty;
      this._applyTransformNow();
      this._notify({ userZoomChanged: false });
    }

    _handleBlur() {
      this.spaceHeld = false;
      this._endDrag(this.activePointerId);
      this._updateCursor();
    }

    _updateCursor() {
      const html = document.documentElement;
      if (!html) return;
      if (!this.isCssActive) {
        restoreInlineProp(html.style, 'cursor', this.savedStyles?.htmlCursor);
        return;
      }
      if (this.isDragging) {
        html.style.setProperty('cursor', 'grabbing', 'important');
      } else if (this.panMode || this.spaceHeld) {
        html.style.setProperty('cursor', 'grab', 'important');
      } else {
        restoreInlineProp(html.style, 'cursor', this.savedStyles?.htmlCursor);
      }
    }
  }

  ns.ZoomEngine = ZoomEngine;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZoomEngine;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
