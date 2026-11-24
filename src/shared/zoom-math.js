(function initZoomMath(root) {
  'use strict';

  const ns = (root.ArbZoom = root.ArbZoom || {});
  const C = ns.CONSTANTS || {
    MIN_SCALE: 0.01,
    MAX_SCALE: 10000,
    SLIDER_MIN_SCALE: 0.1,
    SLIDER_MAX_SCALE: 100,
    SLIDER_STEPS: 1000,
    NATIVE_MIN_ZOOM: 0.5,
    NATIVE_MAX_ZOOM: 5.0,
    SNAP_EPSILON: 0.045,
  };

  function clamp(val, min, max) {
    if (!Number.isFinite(val)) return min;
    return Math.min(max, Math.max(min, val));
  }

  function clampScale(scale) {
    if (!Number.isFinite(scale) || scale <= 0) return 1;
    const clamped = clamp(scale, C.MIN_SCALE, C.MAX_SCALE);
    // Avoid microscopic floating point drift around 1.0
    if (Math.abs(clamped - 1) < 1e-6) return 1;
    return clamped;
  }

  /**
   * Optionally snaps scale to 1.0 when crossing 1.0 or approaching 1.0 within epsilon.
   * Never snaps back to 1.0 when actively zooming away from 1.0 (e.g. smooth trackpad pinch).
   */
  function applyMagneticSnap(nextScale, prevScale, enabled = true, epsilon = C.SNAP_EPSILON) {
    const s = clampScale(nextScale);
    if (!enabled) return s;

    const crossedOne =
      (prevScale > 1 && s < 1 && Math.abs(s - 1) < 0.25) ||
      (prevScale < 1 && s > 1 && Math.abs(s - 1) < 0.25);

    if (crossedOne) return 1;

    const movingTowardOne = Math.abs(s - 1) < Math.abs(prevScale - 1);
    if (movingTowardOne && Math.abs(prevScale - 1) > 1e-4 && Math.abs(s - 1) <= epsilon) {
      return 1;
    }
    return s;
  }

  /**
   * Splits a total target zoom factor into native browser zoom + CSS optical scale.
   * In 'optical' mode: nativeZoom is always 1, cssScale is targetScale.
   * In 'hybrid' mode: nativeZoom handles [NATIVE_MIN_ZOOM .. maxNative],
   * and cssScale seamlessly handles everything outside that range.
   */
  function splitHybridZoom(targetScale, mode = 'optical', maxNative = C.NATIVE_MAX_ZOOM) {
    const target = clampScale(targetScale);
    if (mode !== 'hybrid') {
      return { nativeZoom: 1, cssScale: target };
    }
    if (Math.abs(target - 1) < 1e-6) {
      return { nativeZoom: 1, cssScale: 1 };
    }
    const nativeZoom = clamp(target, C.NATIVE_MIN_ZOOM, maxNative);
    // Round nativeZoom to 4 decimals for browser API stability
    const cleanNative = Math.round(nativeZoom * 10000) / 10000;
    const cssScale = clampScale(target / cleanNative);
    return {
      nativeZoom: cleanNative,
      cssScale: Math.abs(cssScale - 1) < 1e-4 ? 1 : cssScale,
    };
  }

  /**
   * Computes new (tx, ty) translation so that the document point currently under
   * viewport coordinate (focalX, focalY) remains fixed under (focalX, focalY)
   * when changing CSS scale from prevScale to nextScale.
   *
   * Transform applied to body: translate(tx, ty) scale(scale) with origin (0, 0).
   * If body's unscaled layout offset relative to viewport is (originX, originY):
   *   screenX = originX + tx + localX * scale
   */
  function zoomAroundPoint(camera, nextCssScale, focalX, focalY, originX = 0, originY = 0) {
    const prevScale = camera.cssScale || 1;
    const targetScale = clampScale(nextCssScale);
    const ratio = targetScale / prevScale;

    const fx = focalX - originX;
    const fy = focalY - originY;

    const tx = fx - (fx - camera.tx) * ratio;
    const ty = fy - (fy - camera.ty) * ratio;

    return {
      cssScale: targetScale,
      tx: Number.isFinite(tx) ? tx : 0,
      ty: Number.isFinite(ty) ? ty : 0,
    };
  }

  /**
   * Clamps (tx, ty) so the zoomed document remains reachable and doesn't fly
   * completely off-screen into infinite void.
   */
  function clampPan(camera, viewportW, viewportH, docW, docH, originX = 0, originY = 0) {
    const scale = camera.cssScale || 1;
    const safeVW = Math.max(1, viewportW);
    const safeVH = Math.max(1, viewportH);
    const safeDocW = Math.max(1, docW);
    const safeDocH = Math.max(1, docH);

    const scaledW = safeDocW * scale;
    const scaledH = safeDocH * scale;

    let tx = camera.tx;
    let ty = camera.ty;

    if (scaledW <= safeVW) {
      // Center horizontally when zoomed out smaller than viewport
      tx = (safeVW - scaledW) / 2 - originX;
    } else {
      const maxTx = -originX;
      const minTx = safeVW - originX - scaledW;
      tx = clamp(tx, minTx, maxTx);
    }

    if (scaledH <= safeVH) {
      // Top-align with gentle centering if much smaller than viewport
      ty = Math.max(0, (safeVH - scaledH) / 2) - originY;
    } else {
      const maxTy = -originY;
      const minTy = safeVH - originY - scaledH;
      ty = clamp(ty, minTy, maxTy);
    }

    return { cssScale: scale, tx: tx || 0, ty: ty || 0 };
  }

  /**
   * Computes normalized viewport rectangle inside document space [0..1] for the minimap.
   */
  function computeMinimapRect(camera, viewportW, viewportH, docW, docH, originX = 0, originY = 0) {
    const scale = camera.cssScale || 1;
    const safeDocW = Math.max(1, docW);
    const safeDocH = Math.max(1, docH);

    const viewLeftDoc = (-originX - camera.tx) / scale;
    const viewTopDoc = (-originY - camera.ty) / scale;
    const viewWidthDoc = viewportW / scale;
    const viewHeightDoc = viewportH / scale;

    const x = clamp(viewLeftDoc / safeDocW, 0, 1);
    const y = clamp(viewTopDoc / safeDocH, 0, 1);
    const w = clamp(viewWidthDoc / safeDocW, 0.02, 1);
    const h = clamp(viewHeightDoc / safeDocH, 0.02, 1);

    return {
      x: Math.min(x, 1 - w),
      y: Math.min(y, 1 - h),
      w,
      h,
    };
  }

  /**
   * Converts a normalized minimap point (nx, ny in [0..1]) into camera (tx, ty)
   * centered on that document point.
   */
  function panToNormalizedPoint(
    camera,
    nx,
    ny,
    viewportW,
    viewportH,
    docW,
    docH,
    originX = 0,
    originY = 0
  ) {
    const scale = camera.cssScale || 1;
    const docX = clamp(nx, 0, 1) * docW;
    const docY = clamp(ny, 0, 1) * docH;

    const tx = viewportW / 2 - originX - docX * scale;
    const ty = viewportH / 2 - originY - docY * scale;

    return clampPan({ cssScale: scale, tx, ty }, viewportW, viewportH, docW, docH, originX, originY);
  }

  /**
   * Logarithmic slider conversion: maps [SLIDER_MIN_SCALE .. SLIDER_MAX_SCALE]
   * onto [0 .. SLIDER_STEPS]. Strictly monotonic with fine rounding so keyboard
   * arrow steps on the range input never deadlock or snap backward.
   */
  function scaleToSlider(scale) {
    const clamped = clamp(scale, C.SLIDER_MIN_SCALE, C.SLIDER_MAX_SCALE);
    const minLog = Math.log10(C.SLIDER_MIN_SCALE);
    const maxLog = Math.log10(C.SLIDER_MAX_SCALE);
    const t = (Math.log10(clamped) - minLog) / (maxLog - minLog);
    return Math.round(t * C.SLIDER_STEPS);
  }

  function sliderToScale(sliderValue) {
    const step = Math.round(clamp(sliderValue, 0, C.SLIDER_STEPS));
    // Exact 100% notch at 1/3 along the 3-decade [0.1 .. 100] logarithmic scale
    if (step === Math.round(C.SLIDER_STEPS / 3)) return 1;
    const t = step / C.SLIDER_STEPS;
    const minLog = Math.log10(C.SLIDER_MIN_SCALE);
    const maxLog = Math.log10(C.SLIDER_MAX_SCALE);
    const raw = Math.pow(10, minLog + t * (maxLog - minLog));
    // 4-digit precision preserves strict monotonicity across all 0..1000 steps (zero keyboard deadlocks)
    if (raw < 1) return Math.round(raw * 10000) / 10000;
    if (raw < 10) return Math.round(raw * 1000) / 1000;
    return Math.round(raw * 100) / 100;
  }

  /**
   * Formats a zoom scale factor as human-readable percentage string.
   * Examples: 1 -> "100%", 12.5 -> "1,250%", 0.125 -> "12.5%", 100 -> "10,000%"
   */
  function formatPercent(scale) {
    const pct = clampScale(scale) * 100;
    if (pct >= 1000) {
      return `${Math.round(pct).toLocaleString('en-US')}%`;
    }
    if (Math.abs(pct - Math.round(pct)) < 0.05) {
      return `${Math.round(pct)}%`;
    }
    return `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
  }

  /**
   * Formats a compact <=4 char badge string for the extension toolbar icon.
   * Returns "" when scale is 100%.
   */
  function formatBadge(scale) {
    const s = clampScale(scale);
    if (Math.abs(s - 1) < 0.005) return '';
    const pct = Math.round(s * 100);
    if (pct < 1000) return `${pct}%`;
    if (pct < 10000) {
      const k = Math.round((pct / 1000) * 10) / 10;
      return k >= 10 ? '10k' : `${k}k`;
    }
    if (pct < 1000000) {
      const k = Math.round(pct / 1000);
      return k >= 1000 ? '1M' : `${k}k`;
    }
    return `${Math.round((pct / 1000000) * 10) / 10}M`;
  }

  const STRICT_NUMBER_RE = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

  /**
   * Parses user-entered zoom strings like "2500", "2,500%", "15x", "15×", "2.5k%", ".5x".
   * Returns scale factor (e.g. 25 for "2500%"), or null if invalid.
   */
  function parseZoomInput(raw) {
    if (typeof raw === 'number') {
      return Number.isFinite(raw) && raw > 0 ? clampScale(raw / 100) : null;
    }
    if (typeof raw !== 'string') return null;
    const cleaned = raw.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
    if (!cleaned) return null;

    // Multiplier notation: e.g. "25x", "2.5x", "5×", ".5x"
    if (cleaned.endsWith('x') || cleaned.endsWith('×')) {
      const numStr = cleaned.slice(0, -1);
      if (!STRICT_NUMBER_RE.test(numStr)) return null;
      const num = parseFloat(numStr);
      if (!Number.isFinite(num) || num <= 0) return null;
      return clampScale(num);
    }

    // Compact k notation: e.g. "5k", "5k%", ".5k" -> 5000% = 50x
    if (cleaned.endsWith('k') || cleaned.endsWith('k%')) {
      const numStr = cleaned.endsWith('k%') ? cleaned.slice(0, -2) : cleaned.slice(0, -1);
      if (!STRICT_NUMBER_RE.test(numStr)) return null;
      const pct = parseFloat(numStr) * 1000;
      if (!Number.isFinite(pct) || pct <= 0) return null;
      return clampScale(pct / 100);
    }

    // Standard percentage notation: "2500", "2500%", ".5%"
    const pctStr = cleaned.endsWith('%') ? cleaned.slice(0, -1) : cleaned;
    if (!STRICT_NUMBER_RE.test(pctStr)) return null;
    const pct = parseFloat(pctStr);
    if (!Number.isFinite(pct) || pct <= 0) return null;
    return clampScale(pct / 100);
  }

  const MathAPI = {
    clamp,
    clampScale,
    applyMagneticSnap,
    splitHybridZoom,
    zoomAroundPoint,
    clampPan,
    computeMinimapRect,
    panToNormalizedPoint,
    scaleToSlider,
    sliderToScale,
    formatPercent,
    formatBadge,
    parseZoomInput,
  };

  ns.Math = MathAPI;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MathAPI;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
