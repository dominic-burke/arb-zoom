(function initBrowserApi(root) {
  'use strict';

  const ns = (root.ArbZoom = root.ArbZoom || {});

  const rawApi =
    typeof globalThis.browser !== 'undefined' && globalThis.browser?.runtime
      ? globalThis.browser
      : typeof globalThis.chrome !== 'undefined' && globalThis.chrome?.runtime
        ? globalThis.chrome
        : null;

  const isFirefox = (() => {
    if (typeof globalThis.browser === 'undefined' || !globalThis.browser?.runtime) return false;
    if (typeof globalThis.browser.runtime.getBrowserInfo === 'function') return true;
    try {
      const url = globalThis.browser.runtime.getURL?.('');
      return typeof url === 'string' && url.startsWith('moz-extension://');
    } catch (_) {
      return false;
    }
  })();

  // Invoke each WebExtension API strictly ONCE (never double-call to sniff Promises).
  // Both Firefox MV3 (browser.*) and Chrome 102+ MV3 (chrome.*) natively return Promises
  // for all APIs wrapped here.
  function callApi(obj, method, ...args) {
    if (!obj || typeof obj[method] !== 'function') {
      return Promise.reject(new Error(`Extension API method unavailable: ${method}`));
    }
    try {
      return Promise.resolve(obj[method](...args));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  const api = {
    raw: rawApi,
    isFirefox,
    get isExtensionContext() {
      try {
        return Boolean(rawApi && rawApi.runtime && rawApi.runtime.id);
      } catch (_) {
        return false;
      }
    },

    storage: {
      get(keys) {
        if (!rawApi?.storage?.local) return Promise.resolve({});
        return callApi(rawApi.storage.local, 'get', keys);
      },
      set(items) {
        if (!rawApi?.storage?.local) return Promise.resolve();
        return callApi(rawApi.storage.local, 'set', items);
      },
      remove(keys) {
        if (!rawApi?.storage?.local) return Promise.resolve();
        return callApi(rawApi.storage.local, 'remove', keys);
      },
      onChanged: rawApi?.storage?.onChanged || null,
    },

    tabs: {
      query(queryInfo) {
        return callApi(rawApi?.tabs, 'query', queryInfo);
      },
      sendMessage(tabId, message) {
        return callApi(rawApi?.tabs, 'sendMessage', tabId, message);
      },
      getZoom(tabId) {
        return callApi(rawApi?.tabs, 'getZoom', tabId);
      },
      setZoom(tabId, zoomFactor) {
        return callApi(rawApi?.tabs, 'setZoom', tabId, zoomFactor);
      },
      setZoomSettings(tabId, settings) {
        if (!rawApi?.tabs || typeof rawApi.tabs.setZoomSettings !== 'function') {
          return Promise.resolve();
        }
        return callApi(rawApi.tabs, 'setZoomSettings', tabId, settings);
      },
      onZoomChange: rawApi?.tabs?.onZoomChange || null,
      onRemoved: rawApi?.tabs?.onRemoved || null,
      onUpdated: rawApi?.tabs?.onUpdated || null,
    },

    runtime: {
      sendMessage(message) {
        return callApi(rawApi?.runtime, 'sendMessage', message);
      },
      onMessage: rawApi?.runtime?.onMessage || null,
      onInstalled: rawApi?.runtime?.onInstalled || null,
    },

    action: {
      setBadgeText(details) {
        const target = rawApi?.action || rawApi?.browserAction;
        if (!target) return Promise.resolve();
        return callApi(target, 'setBadgeText', details);
      },
      setBadgeBackgroundColor(details) {
        const target = rawApi?.action || rawApi?.browserAction;
        if (!target) return Promise.resolve();
        return callApi(target, 'setBadgeBackgroundColor', details);
      },
      setBadgeTextColor(details) {
        const target = rawApi?.action || rawApi?.browserAction;
        if (!target || typeof target.setBadgeTextColor !== 'function') {
          return Promise.resolve();
        }
        return callApi(target, 'setBadgeTextColor', details);
      },
    },

    commands: rawApi?.commands || null,
  };

  ns.API = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
