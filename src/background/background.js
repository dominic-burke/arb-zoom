/* global importScripts */
(function initBackground(root) {
  'use strict';

  // Chrome MV3 service worker loads shared scripts via importScripts.
  // Firefox MV3 loads them sequentially via manifest background.scripts.
  if (typeof importScripts === 'function' && (!root.ArbZoom || !root.ArbZoom.Math)) {
    importScripts(
      '../shared/browser-api.js',
      '../shared/constants.js',
      '../shared/zoom-math.js'
    );
  }

  const { API, CONSTANTS, Math: ZMath } = root.ArbZoom;
  const { MSG, STORAGE_KEYS, DEFAULT_SETTINGS } = CONSTANTS;

  // Per-tab serialization queues & sequence counters
  const badgeSeqByTab = new Map();
  const zoomQueueByTab = new Map();
  const internalZoomTabs = new Set();
  let siteZoomQueue = Promise.resolve();

  async function ensureDefaults() {
    try {
      const stored = await API.storage.get(STORAGE_KEYS.SETTINGS);
      const current = stored?.[STORAGE_KEYS.SETTINGS];
      if (!current || typeof current !== 'object') {
        await API.storage.set({ [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS } });
        return;
      }
      const missingKey = Object.keys(DEFAULT_SETTINGS).some((k) => !(k in current));
      if (missingKey) {
        const merged = { ...DEFAULT_SETTINGS, ...current };
        await API.storage.set({ [STORAGE_KEYS.SETTINGS]: merged });
      }
    } catch (_) {
      // Ignore storage init errors in restricted contexts
    }
  }

  async function updateBadgeForTab(tabId, totalScale) {
    if (typeof tabId !== 'number') return;
    const seq = (badgeSeqByTab.get(tabId) || 0) + 1;
    badgeSeqByTab.set(tabId, seq);

    const text = ZMath.formatBadge(totalScale);
    try {
      await API.action.setBadgeText({ tabId, text });
      if (badgeSeqByTab.get(tabId) !== seq) return;
      if (text) {
        // Vivid violet when past the 500% browser cap, sky-blue otherwise
        const bgColor = totalScale > 5.001 ? '#7c3aed' : '#0284c7';
        await API.action.setBadgeBackgroundColor({ tabId, color: bgColor });
        if (badgeSeqByTab.get(tabId) !== seq) return;
        await API.action.setBadgeTextColor({ tabId, color: '#ffffff' });
      }
    } catch (_) {
      // Tab may have been closed
    }
  }

  async function getNativeZoomForTab(tabId) {
    if (typeof tabId !== 'number') return { actualNativeZoom: 1, ok: false };
    try {
      const actual = await API.tabs.getZoom(tabId);
      return { actualNativeZoom: Number.isFinite(actual) && actual > 0 ? actual : 1, ok: true };
    } catch (err) {
      return { actualNativeZoom: 1, ok: false, error: err?.message || String(err) };
    }
  }

  function syncNativeZoomForTab(tabId, requestedNativeZoom) {
    if (typeof tabId !== 'number') {
      return Promise.resolve({ actualNativeZoom: 1, ok: false });
    }

    const prev = zoomQueueByTab.get(tabId) || Promise.resolve();
    const task = prev
      .catch(() => {})
      .then(async () => {
        const target = ZMath.clamp(
          requestedNativeZoom,
          CONSTANTS.NATIVE_MIN_ZOOM,
          CONSTANTS.NATIVE_MAX_ZOOM
        );

        internalZoomTabs.add(tabId);
        try {
          // Keep Hybrid native zoom isolated to this tab instead of leaking across same-origin tabs
          if (Math.abs(target - 1) > 0.002) {
            await API.tabs.setZoomSettings(tabId, { scope: 'per-tab' }).catch(() => {});
          }

          const current = await API.tabs.getZoom(tabId);
          if (Math.abs(current - target) > 0.002) {
            try {
              await API.tabs.setZoom(tabId, target);
            } catch (setErr) {
              // Some browsers (e.g. Firefox with zoom.maxPercent=300) reject out-of-range zoomFactor
              // instead of clamping. Step down cleanly when requesting above 3.0x.
              if (target > 3.0) {
                await API.tabs.setZoom(tabId, 3.0);
              } else {
                throw setErr;
              }
            }
          }

          const actual = await API.tabs.getZoom(tabId);
          return {
            actualNativeZoom: Number.isFinite(actual) && actual > 0 ? actual : 1,
            ok: true,
          };
        } catch (err) {
          // Read back real zoom if possible rather than misreporting 1.0
          let fallbackActual = 1;
          try {
            const read = await API.tabs.getZoom(tabId);
            if (Number.isFinite(read) && read > 0) fallbackActual = read;
          } catch (_) {
            // Ignore
          }
          return {
            actualNativeZoom: fallbackActual,
            ok: false,
            error: err?.message || String(err),
          };
        } finally {
          internalZoomTabs.delete(tabId);
        }
      });

    zoomQueueByTab.set(tabId, task);
    return task;
  }

  function saveSiteZoomSerialized(originKey, totalScale) {
    if (!originKey || typeof originKey !== 'string') {
      return Promise.resolve({ ok: false });
    }
    siteZoomQueue = siteZoomQueue
      .catch(() => {})
      .then(async () => {
        const stored = await API.storage.get(STORAGE_KEYS.SITE_ZOOMS);
        const map = { ...(stored?.[STORAGE_KEYS.SITE_ZOOMS] || {}) };
        if (Math.abs(totalScale - 1) < 0.002) {
          if (!(originKey in map)) return { ok: true };
          delete map[originKey];
        } else {
          const rounded = Math.round(totalScale * 10000) / 10000;
          if (map[originKey] === rounded) return { ok: true };
          map[originKey] = rounded;
        }
        await API.storage.set({ [STORAGE_KEYS.SITE_ZOOMS]: map });
        return { ok: true };
      });
    return siteZoomQueue;
  }

  if (API.runtime.onInstalled) {
    API.runtime.onInstalled.addListener(() => ensureDefaults());
  }

  if (API.tabs.onRemoved) {
    API.tabs.onRemoved.addListener((tabId) => {
      badgeSeqByTab.delete(tabId);
      zoomQueueByTab.delete(tabId);
      internalZoomTabs.delete(tabId);
    });
  }

  if (API.tabs.onZoomChange) {
    API.tabs.onZoomChange.addListener((zoomChangeInfo) => {
      const tabId = zoomChangeInfo?.tabId;
      const newZoomFactor = zoomChangeInfo?.newZoomFactor;
      if (typeof tabId !== 'number' || !Number.isFinite(newZoomFactor)) return;
      if (internalZoomTabs.has(tabId)) return;

      API.tabs
        .sendMessage(tabId, {
          type: MSG.NATIVE_ZOOM_CHANGED,
          nativeZoom: newZoomFactor,
        })
        .catch(() => {
          // Restricted tab with no content script: keep toolbar badge synced to native zoom
          updateBadgeForTab(tabId, newZoomFactor);
        });
    });
  }

  if (API.runtime.onMessage) {
    API.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message.type !== 'string') return undefined;

      const tabId = typeof message.tabId === 'number' ? message.tabId : sender?.tab?.id;

      if (message.type === MSG.UPDATE_BADGE) {
        updateBadgeForTab(tabId, message.totalScale ?? 1)
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }));
        return true;
      }

      if (message.type === MSG.GET_NATIVE_ZOOM) {
        getNativeZoomForTab(tabId)
          .then((result) => sendResponse(result))
          .catch(() => sendResponse({ actualNativeZoom: 1, ok: false }));
        return true;
      }

      if (message.type === MSG.SYNC_NATIVE_ZOOM) {
        syncNativeZoomForTab(tabId, message.nativeZoom ?? 1)
          .then((result) => sendResponse(result))
          .catch(() => sendResponse({ actualNativeZoom: 1, ok: false }));
        return true;
      }

      if (message.type === MSG.SAVE_SITE_ZOOM) {
        saveSiteZoomSerialized(message.originKey, message.totalScale ?? 1)
          .then((result) => sendResponse(result))
          .catch(() => sendResponse({ ok: false }));
        return true;
      }

      return undefined;
    });
  }

  if (API.commands && API.commands.onCommand) {
    API.commands.onCommand.addListener(async (command) => {
      try {
        const tabs = await API.tabs.query({ active: true, currentWindow: true });
        const tab = tabs?.[0];
        if (!tab || typeof tab.id !== 'number') return;

        let msg = null;
        if (command === 'zoom-in') {
          msg = { type: MSG.STEP_ZOOM, direction: 1 };
        } else if (command === 'zoom-out') {
          msg = { type: MSG.STEP_ZOOM, direction: -1 };
        } else if (command === 'zoom-reset') {
          msg = { type: MSG.RESET_ZOOM };
        } else if (command === 'toggle-pan') {
          msg = { type: MSG.TOGGLE_PAN_MODE };
        }

        if (!msg) return;

        try {
          await API.tabs.sendMessage(tab.id, msg);
        } catch (_) {
          // Content script unavailable (e.g., restricted browser page).
          // Fall back to native browser zoom using user's stepFactor.
          if (command === 'zoom-reset') {
            await syncNativeZoomForTab(tab.id, 1);
            const actual = await API.tabs.getZoom(tab.id).catch(() => 1);
            await updateBadgeForTab(tab.id, actual);
          } else if (command === 'zoom-in' || command === 'zoom-out') {
            const stored = await API.storage.get(STORAGE_KEYS.SETTINGS).catch(() => ({}));
            const stepFactor = stored?.[STORAGE_KEYS.SETTINGS]?.stepFactor || DEFAULT_SETTINGS.stepFactor;
            const cur = await API.tabs.getZoom(tab.id);
            const target = ZMath.clamp(
              command === 'zoom-in' ? cur * stepFactor : cur / stepFactor,
              CONSTANTS.NATIVE_MIN_ZOOM,
              CONSTANTS.NATIVE_MAX_ZOOM
            );
            const res = await syncNativeZoomForTab(tab.id, target);
            await updateBadgeForTab(tab.id, res.actualNativeZoom);
          }
        }
      } catch (_) {
        // Ignore command dispatch errors on non-zoomable tabs
      }
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
