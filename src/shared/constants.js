(function initConstants(root) {
  'use strict';

  const ns = (root.ArbZoom = root.ArbZoom || {});

  const CONSTANTS = {
    // 1% to 1,000,000% — effectively uncapped arbitrary zoom
    MIN_SCALE: 0.01,
    MAX_SCALE: 10000,

    // Logarithmic slider range: 10% (0.1x) to 10,000% (100x)
    SLIDER_MIN_SCALE: 0.1,
    SLIDER_MAX_SCALE: 100,
    SLIDER_STEPS: 1000,

    // Native browser zoom limits (used in Hybrid mode; actual cap is read back dynamically)
    NATIVE_MIN_ZOOM: 0.5,
    NATIVE_MAX_ZOOM: 5.0,

    // Magnetic snap band around 100% (snaps cleanly to 1.0x when moving toward 100%)
    SNAP_EPSILON: 0.045,

    PRESETS: [0.5, 1, 2.5, 5, 10, 25, 50, 100],

    DEFAULT_SETTINGS: {
      mode: 'optical', // 'optical' | 'hybrid'
      wheelTrigger: 'both', // 'both' (Ctrl/Pinch + Alt) | 'alt' | 'ctrl' | 'shift' | 'off'
      keyboardShortcuts: true, // Alt+=, Alt+-, Alt+0 in-page shortcuts
      overrideCtrlKeys: false, // Optionally intercept Ctrl+=/- /0 in-page
      stepFactor: 1.25, // Multiplicative step per button click / keypress
      wheelSensitivity: 1.0, // Multiplier for scroll-wheel zoom speed
      showHud: true, // Floating Shadow DOM HUD pill when zoomed != 100%
      showMinimap: false, // Start minimap expanded or collapsed
      pixelated: false, // Crisp pixel-art / image-rendering: pixelated toggle
      rememberPerSite: true, // Persist per-origin zoom levels
      magneticSnap: true, // Snap cleanly to 100% when crossing or approaching it
    },

    STORAGE_KEYS: {
      SETTINGS: 'arbZoomSettings',
      SITE_ZOOMS: 'arbZoomSiteZooms',
    },

    MSG: {
      GET_STATE: 'ARB_ZOOM_GET_STATE',
      SET_ZOOM: 'ARB_ZOOM_SET_ZOOM',
      STEP_ZOOM: 'ARB_ZOOM_STEP_ZOOM',
      RESET_ZOOM: 'ARB_ZOOM_RESET_ZOOM',
      SET_PAN_MODE: 'ARB_ZOOM_SET_PAN_MODE',
      TOGGLE_PAN_MODE: 'ARB_ZOOM_TOGGLE_PAN_MODE',
      SET_PIXELATED: 'ARB_ZOOM_SET_PIXELATED',
      UPDATE_SETTINGS: 'ARB_ZOOM_UPDATE_SETTINGS',
      CENTER_VIEW: 'ARB_ZOOM_CENTER_VIEW',
      NATIVE_ZOOM_CHANGED: 'ARB_ZOOM_NATIVE_ZOOM_CHANGED',
      // Content -> Background
      GET_NATIVE_ZOOM: 'ARB_ZOOM_GET_NATIVE_ZOOM',
      SYNC_NATIVE_ZOOM: 'ARB_ZOOM_SYNC_NATIVE_ZOOM',
      UPDATE_BADGE: 'ARB_ZOOM_UPDATE_BADGE',
      SAVE_SITE_ZOOM: 'ARB_ZOOM_SAVE_SITE_ZOOM',
    },
  };

  ns.CONSTANTS = CONSTANTS;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONSTANTS;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
