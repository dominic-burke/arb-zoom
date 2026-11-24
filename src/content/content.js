(function initContentScript(root) {
  'use strict';

  const ns = root.ArbZoom;
  if (!ns || !ns.ZoomEngine || !ns.ZoomHud) return;

  // Guard against double initialization across both JS world and DOM (e.g. demo.html + extension)
  if (root.__ARB_ZOOM_INITIALIZED__) return;
  if (document.documentElement?.getAttribute?.('data-arb-zoom-mounted') === 'true') return;
  root.__ARB_ZOOM_INITIALIZED__ = true;
  document.documentElement?.setAttribute?.('data-arb-zoom-mounted', 'true');

  const { API, CONSTANTS, Math: ZMath, ZoomEngine, ZoomHud } = ns;
  const { MSG, STORAGE_KEYS, DEFAULT_SETTINGS } = CONSTANTS;

  const originKey = (() => {
    try {
      const { origin, protocol, pathname, hostname } = window.location;
      if (origin && origin !== 'null') return origin;
      if (protocol === 'file:' && pathname) return `file://${pathname}`;
      return hostname || 'local';
    } catch (_) {
      return 'local';
    }
  })();

  let siteSaveTimer = null;
  let pendingSiteScale = null;
  let badgeTimer = null;
  let lastPushedBadgeText = '';
  let userMutatedZoom = false;
  let settingsWriteQueue = Promise.resolve();

  async function sendRuntimeMessageWithRetry(message) {
    if (!API.isExtensionContext) return null;
    try {
      return await API.runtime.sendMessage(message);
    } catch (err) {
      const msg = String(err?.message || err || '');
      const transient =
        msg.includes('Could not establish connection') ||
        msg.includes('message port closed') ||
        msg.includes('Receiving end does not exist');
      if (!transient || !API.isExtensionContext) return null;
      await new Promise((r) => setTimeout(r, 60));
      if (!API.isExtensionContext) return null;
      try {
        return await API.runtime.sendMessage(message);
      } catch (_) {
        return null;
      }
    }
  }

  function flushPendingSiteZoom() {
    if (pendingSiteScale === null || !API.isExtensionContext) return;
    if (siteSaveTimer) {
      clearTimeout(siteSaveTimer);
      siteSaveTimer = null;
    }
    const scaleToSave = pendingSiteScale;
    pendingSiteScale = null;
    sendRuntimeMessageWithRetry({
      type: MSG.SAVE_SITE_ZOOM,
      originKey,
      totalScale: scaleToSave,
    }).catch(() => {});
  }

  function scheduleSiteZoomSave(totalScale, settings) {
    if (!API.isExtensionContext || !settings.rememberPerSite) return;
    pendingSiteScale = totalScale;
    if (siteSaveTimer) clearTimeout(siteSaveTimer);
    siteSaveTimer = setTimeout(() => {
      flushPendingSiteZoom();
    }, 220);
  }

  function pushBadgeUpdate(totalScale, { force = false } = {}) {
    if (!API.isExtensionContext) return;
    const nextText = ZMath.formatBadge(totalScale);
    if (!force && nextText === lastPushedBadgeText) return;

    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
      badgeTimer = null;
      const currentText = ZMath.formatBadge(totalScale);
      if (!force && currentText === lastPushedBadgeText) return;
      lastPushedBadgeText = currentText;
      sendRuntimeMessageWithRetry({ type: MSG.UPDATE_BADGE, totalScale }).catch(() => {});
    }, force ? 0 : 60);
  }

  function persistSettingPatch(patch) {
    if (!API.isExtensionContext) return Promise.resolve();
    settingsWriteQueue = settingsWriteQueue
      .catch(() => {})
      .then(async () => {
        const stored = await API.storage.get(STORAGE_KEYS.SETTINGS);
        const merged = {
          ...DEFAULT_SETTINGS,
          ...(stored?.[STORAGE_KEYS.SETTINGS] || {}),
          ...patch,
        };
        await API.storage.set({ [STORAGE_KEYS.SETTINGS]: merged });
      })
      .catch(() => {});
    return settingsWriteQueue;
  }

  let engine = null;
  const hud = new ZoomHud({
    stepZoom: (dir) => {
      userMutatedZoom = true;
      engine?.stepZoom(dir, { usePointer: false });
    },
    setZoom: (scale) => {
      userMutatedZoom = true;
      engine?.setZoom(scale, { snap: false, immediateNative: true });
    },
    resetZoom: () => {
      userMutatedZoom = true;
      engine?.resetZoom();
    },
    togglePan: () => engine?.togglePanMode(),
    togglePixelated: () => {
      if (!engine) return;
      const next = !engine.settings.pixelated;
      engine.setPixelated(next);
      persistSettingPatch({ pixelated: next });
    },
    panToNormalized: (nx, ny) => engine?.panToNormalized(nx, ny),
    onMinimapToggle: (open) => {
      persistSettingPatch({ showMinimap: open });
    },
  });

  engine = new ZoomEngine({
    settings: { ...DEFAULT_SETTINGS },
    isHudEvent: (e) => hud.isEventInside(e),
    syncNativeZoom: async (nativeZoom) => {
      if (!API.isExtensionContext) return { actualNativeZoom: 1, ok: false };
      const res = await sendRuntimeMessageWithRetry({
        type: MSG.SYNC_NATIVE_ZOOM,
        nativeZoom,
      });
      return res && typeof res === 'object' ? res : { actualNativeZoom: 1, ok: false };
    },
    onStateChange: (state, meta = {}) => {
      hud.update(state);
      pushBadgeUpdate(state.totalScale);
      if (meta.userZoomChanged) {
        userMutatedZoom = true;
        scheduleSiteZoomSave(state.totalScale, state.settings);
      }
    },
  });

  // Expose for demo/debugging inspection
  ns.instance = { engine, hud };

  // Flush pending per-site zoom save before tab closes/navigates
  window.addEventListener('pagehide', () => flushPendingSiteZoom());
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPendingSiteZoom();
    });
  }

  // Re-sync toolbar badge after bfcache restore (browsers clear tab badge on nav)
  window.addEventListener('pageshow', (e) => {
    if (e?.persisted && engine && Math.abs(engine.totalScale - 1) > 0.002) {
      pushBadgeUpdate(engine.totalScale, { force: true });
    }
  });

  let nativeZoomChecked = false;

  async function ensureNativeZoomSynced() {
    if (nativeZoomChecked || !API.isExtensionContext) return;
    nativeZoomChecked = true;
    const nativeRes = await sendRuntimeMessageWithRetry({ type: MSG.GET_NATIVE_ZOOM });
    if (
      nativeRes?.ok &&
      Number.isFinite(nativeRes.actualNativeZoom) &&
      Math.abs(nativeRes.actualNativeZoom - 1) > 0.002
    ) {
      engine.syncExternalNativeZoom(nativeRes.actualNativeZoom);
    }
  }

  async function hydrateFromStorage() {
    if (!API.isExtensionContext) return;
    try {
      const stored = await API.storage.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.SITE_ZOOMS]);
      const settings = { ...DEFAULT_SETTINGS, ...(stored?.[STORAGE_KEYS.SETTINGS] || {}) };
      engine.updateSettings(settings);
      hud.setMinimapPreference(Boolean(settings.showMinimap));

      const siteMap = stored?.[STORAGE_KEYS.SITE_ZOOMS] || {};
      const savedScale = settings.rememberPerSite ? siteMap[originKey] : null;
      const hasSavedZoom =
        typeof savedScale === 'number' &&
        Number.isFinite(savedScale) &&
        Math.abs(savedScale - 1) > 0.002;

      // Avoid waking up the MV3 service worker on normal 100% Optical page loads;
      // only query pre-existing browser native zoom when Hybrid mode or saved zoom is active.
      if (settings.mode === 'hybrid' || hasSavedZoom) {
        await ensureNativeZoomSynced();
      }

      if (!userMutatedZoom && hasSavedZoom) {
        engine.setZoom(savedScale, {
          snap: false,
          immediateNative: true,
          userInitiated: false,
        });
      }
    } catch (_) {
      // Ignore hydration errors
    }
  }

  const hydrationPromise = hydrateFromStorage();

  // React to settings changed from popup or another tab
  if (API.storage.onChanged) {
    API.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[STORAGE_KEYS.SETTINGS]?.newValue) {
        const nextSettings = { ...DEFAULT_SETTINGS, ...changes[STORAGE_KEYS.SETTINGS].newValue };
        engine.updateSettings(nextSettings);
        hud.setMinimapPreference(Boolean(nextSettings.showMinimap));
      }
    });
  }

  // Handle commands from Popup and Background script
  if (API.runtime.onMessage) {
    API.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== 'string') return undefined;

      switch (message.type) {
        case MSG.GET_STATE:
          hydrationPromise
            .then(() => ensureNativeZoomSynced())
            .then(() => sendResponse({ ok: true, state: engine.getState(), origin: originKey }))
            .catch(() => sendResponse({ ok: true, state: engine.getState(), origin: originKey }));
          return true;

        case MSG.SET_ZOOM: {
          userMutatedZoom = true;
          const immediateNative = Boolean(message.immediateNative ?? true);
          engine.setZoom(message.scale, {
            snap: Boolean(message.snap),
            immediateNative,
            userInitiated: true,
          });
          if (immediateNative && engine.settings.mode === 'hybrid') {
            engine
              .waitForNativeSync()
              .then(() => sendResponse({ ok: true, state: engine.getState() }))
              .catch(() => sendResponse({ ok: true, state: engine.getState() }));
            return true;
          }
          sendResponse({ ok: true, state: engine.getState() });
          return false;
        }

        case MSG.STEP_ZOOM: {
          userMutatedZoom = true;
          engine.stepZoom(message.direction || 1, { usePointer: false, userInitiated: true });
          if (engine.settings.mode === 'hybrid') {
            engine
              .waitForNativeSync()
              .then(() => sendResponse({ ok: true, state: engine.getState() }))
              .catch(() => sendResponse({ ok: true, state: engine.getState() }));
            return true;
          }
          sendResponse({ ok: true, state: engine.getState() });
          return false;
        }

        case MSG.RESET_ZOOM:
          userMutatedZoom = true;
          engine.resetZoom({ userInitiated: true });
          if (engine.nativeSyncInFlight) {
            engine
              .waitForNativeSync()
              .then(() => sendResponse({ ok: true, state: engine.getState() }))
              .catch(() => sendResponse({ ok: true, state: engine.getState() }));
            return true;
          }
          sendResponse({ ok: true, state: engine.getState() });
          return false;

        case MSG.SET_PAN_MODE:
          engine.setPanMode(Boolean(message.enabled));
          sendResponse({ ok: true, state: engine.getState() });
          return false;

        case MSG.TOGGLE_PAN_MODE:
          engine.togglePanMode();
          sendResponse({ ok: true, state: engine.getState() });
          return false;

        case MSG.SET_PIXELATED:
          engine.setPixelated(Boolean(message.enabled));
          sendResponse({ ok: true, state: engine.getState() });
          return false;

        case MSG.CENTER_VIEW:
          engine.centerView();
          sendResponse({ ok: true, state: engine.getState() });
          return false;

        case MSG.NATIVE_ZOOM_CHANGED:
          engine.syncExternalNativeZoom(message.nativeZoom);
          sendResponse({ ok: true, state: engine.getState() });
          return false;

        case MSG.UPDATE_SETTINGS:
          engine.updateSettings(message.settings || {});
          if (typeof message.settings?.showMinimap === 'boolean') {
            hud.setMinimapPreference(message.settings.showMinimap);
          }
          if (engine.nativeSyncInFlight) {
            engine
              .waitForNativeSync()
              .then(() => sendResponse({ ok: true, state: engine.getState() }))
              .catch(() => sendResponse({ ok: true, state: engine.getState() }));
            return true;
          }
          sendResponse({ ok: true, state: engine.getState() });
          return false;

        default:
          return undefined;
      }
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
