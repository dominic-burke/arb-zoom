import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');

/**
 * Lightweight, standards-faithful DOM mock tailored for testing ZoomEngine,
 * ZoomHud (Shadow DOM), ContentScript, and Popup in Node without external deps.
 */
class MockClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  _syncFromAttr(str) {
    this.set = new Set(String(str || '').trim().split(/\s+/).filter(Boolean));
  }
  add(...names) {
    names.forEach((n) => n && this.set.add(n));
  }
  remove(...names) {
    names.forEach((n) => this.set.delete(n));
  }
  toggle(name, force) {
    if (force === undefined) {
      if (this.set.has(name)) {
        this.set.delete(name);
        return false;
      }
      this.set.add(name);
      return true;
    }
    if (force) {
      this.set.add(name);
      return true;
    }
    this.set.delete(name);
    return false;
  }
  contains(name) {
    return this.set.has(name);
  }
  toString() {
    return Array.from(this.set).join(' ');
  }
}

class MockStyle {
  constructor() {
    this._props = new Map();
    this._priorities = new Map();
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) {
          const val = target[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        }
        if (typeof prop === 'string') {
          const kebab = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
          return target._props.get(kebab) || '';
        }
        return undefined;
      },
      set(target, prop, value) {
        if (prop in target) {
          target[prop] = value;
          return true;
        }
        if (typeof prop === 'string') {
          const kebab = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
          if (value === '' || value == null) {
            target._props.delete(kebab);
            target._priorities.delete(kebab);
          } else {
            target._props.set(kebab, String(value));
            target._priorities.set(kebab, '');
          }
          return true;
        }
        return false;
      },
    });
  }
  setProperty(name, value, priority = '') {
    if (value === '' || value == null) {
      this._props.delete(name);
      this._priorities.delete(name);
      return;
    }
    this._props.set(name, String(value));
    this._priorities.set(name, priority || '');
  }
  getPropertyValue(name) {
    return this._props.get(name) || '';
  }
  getPropertyPriority(name) {
    return this._priorities.get(name) || '';
  }
  removeProperty(name) {
    const prev = this._props.get(name) || '';
    this._props.delete(name);
    this._priorities.delete(name);
    return prev;
  }
}

class MockEventTarget {
  constructor() {
    this._listeners = new Map();
  }
  addEventListener(type, fn, opts) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    const once = typeof opts === 'object' ? Boolean(opts?.once) : false;
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ fn, capture, once });
  }
  removeEventListener(type, fn, opts) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    const list = this._listeners.get(type);
    if (!list) return;
    const idx = list.findIndex((item) => item.fn === fn && item.capture === capture);
    if (idx !== -1) list.splice(idx, 1);
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    const list = [...(this._listeners.get(event.type) || [])];
    for (const item of list) {
      if (item.once) {
        this.removeEventListener(event.type, item.fn, item.capture);
      }
      item.fn.call(this, event);
    }
    return !event.defaultPrevented;
  }
}

export class MockEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.target = init.target || null;
    const { composedPath: cp, ...rest } = init;
    this._composedPath = Array.isArray(cp) ? cp : null;
    Object.assign(this, rest);
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this.propagationStopped = true;
  }
  composedPath() {
    if (this._composedPath) return this._composedPath;
    const path = [];
    let cur = this.target;
    while (cur) {
      path.push(cur);
      cur = cur.parentElement || cur.host || null;
    }
    return path;
  }
}

export class MockElement extends MockEventTarget {
  constructor(tagName, ownerDocument = null) {
    super();
    this.nodeType = 1;
    this.tagName = String(tagName || 'DIV').toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = new MockStyle();
    this.classList = new MockClassList(this);
    this.shadowRoot = null;
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.inert = false;
    this.isContentEditable = false;
    this.id = '';
    this.scrollWidth = 0;
    this.scrollHeight = 0;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this._computedStyle = {};
    this._rect = { left: 0, top: 0, width: 100, height: 100 };
    this._innerHTML = '';
    this._capturedPointers = new Set();
  }

  get isConnected() {
    let cur = this;
    while (cur) {
      if (this.ownerDocument && cur === this.ownerDocument.documentElement) return true;
      cur = cur.parentElement || cur.host || null;
    }
    return false;
  }

  get className() {
    return this.classList.toString();
  }
  set className(val) {
    this.classList._syncFromAttr(val);
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(html) {
    this._innerHTML = String(html || '');
    this.children = [];
    parseSimpleHtmlInto(this._innerHTML, this, this.ownerDocument);
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentElement) {
      const idx = child.parentElement.children.indexOf(child);
      if (idx !== -1) child.parentElement.children.splice(idx, 1);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx !== -1) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    const str = String(value);
    this.attributes.set(name, str);
    if (name === 'id') this.id = str;
    if (name === 'class') this.className = str;
    if (name === 'value') this.value = str;
    if (name === 'hidden') this.hidden = true;
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = str;
    }
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'hidden') this.hidden = false;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  attachShadow() {
    if (this.ownerDocument?._nonHtml) {
      throw new Error('NotSupportedError: Failed to execute attachShadow on non-HTML document');
    }
    const sr = new MockElement('#shadow-root', this.ownerDocument);
    sr.host = this;
    this.shadowRoot = sr;
    return sr;
  }

  getBoundingClientRect() {
    return { ...this._rect };
  }

  select() {}
  focus() {
    this.dispatchEvent(new MockEvent('focus', { target: this }));
  }
  blur() {
    this.dispatchEvent(new MockEvent('blur', { target: this }));
  }
  setPointerCapture(id) {
    this._capturedPointers.add(id);
  }
  hasPointerCapture(id) {
    return this._capturedPointers.has(id);
  }
  releasePointerCapture(id) {
    if (!this._capturedPointers.has(id)) {
      throw new Error('NotFoundError: No active pointer with the given id is found.');
    }
    this._capturedPointers.delete(id);
  }

  matches(selector) {
    return matchesSimpleSelector(this, selector);
  }

  closest(selector) {
    let cur = this;
    while (cur && cur.nodeType === 1) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matchesSimpleSelector(child, selector)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }

  click() {
    if (this.disabled) return;
    let cur = this;
    const ev = new MockEvent('click', { target: this });
    while (cur) {
      cur.dispatchEvent(ev);
      if (ev.propagationStopped) break;
      cur = cur.parentElement;
    }
  }
}

function matchesSimpleSelector(el, selector) {
  if (!el || el.nodeType !== 1 || !selector) return false;
  // Support comma-separated selector lists (e.g. "button, input")
  if (selector.includes(',')) {
    return selector.split(',').some((part) => matchesSimpleSelector(el, part));
  }
  const s = selector.trim();
  const parts = s.match(/([#.][a-zA-Z0-9_-]+|\[[^\]]+\]|[a-zA-Z0-9_-]+)/g);
  if (!parts) return false;
  for (const p of parts) {
    if (p.startsWith('#')) {
      if (el.id !== p.slice(1)) return false;
    } else if (p.startsWith('.')) {
      if (!el.classList.contains(p.slice(1))) return false;
    } else if (p.startsWith('[')) {
      const m = p.match(/^\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]*)["']?)?\]$/);
      if (!m) return false;
      const [, attr, expected] = m;
      if (!el.attributes.has(attr)) return false;
      if (expected !== undefined && el.attributes.get(attr) !== expected) return false;
    } else {
      if (el.tagName !== p.toUpperCase()) return false;
    }
  }
  return true;
}

const VOID_TAGS = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'circle', 'rect', 'polyline', 'path']);

function parseSimpleHtmlInto(html, rootEl, doc) {
  const stack = [rootEl];
  const tokenRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
  let match;
  while ((match = tokenRe.exec(html)) !== null) {
    const [, closing, tag, attrStr, selfClosing] = match;
    const lowerTag = tag.toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tagName === tag.toUpperCase()) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const el = new MockElement(tag, doc);
    const attrRe = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let am;
    while ((am = attrRe.exec(attrStr)) !== null) {
      const [, name, v1, v2, v3] = am;
      el.setAttribute(name, v1 ?? v2 ?? v3 ?? '');
    }

    stack[stack.length - 1].appendChild(el);
    if (!selfClosing && !VOID_TAGS.has(lowerTag)) {
      stack.push(el);
    }
  }
}

export function createDomEnvironment(options = {}) {
  const vw = options.viewportWidth ?? 1200;
  const vh = options.viewportHeight ?? 800;
  const docW = options.docWidth ?? 1200;
  const docH = options.docHeight ?? 3000;
  const bodyMarginX = options.bodyMarginX ?? 0;
  const bodyMarginY = options.bodyMarginY ?? 0;
  const svgDocument = Boolean(options.svgDocument);
  const xmlDocument = Boolean(options.xmlDocument);

  let scrollX = options.initialScrollX ?? 0;
  let scrollY = options.initialScrollY ?? 0;
  const scrollCalls = [];

  const docTarget = new MockEventTarget();
  const document = {
    _nonHtml: svgDocument || xmlDocument,
    visibilityState: 'visible',
    documentElement: null,
    head: null,
    body: null,
    addEventListener: docTarget.addEventListener.bind(docTarget),
    removeEventListener: docTarget.removeEventListener.bind(docTarget),
    dispatchEvent: docTarget.dispatchEvent.bind(docTarget),
    createElement(tag) {
      return new MockElement(tag, document);
    },
    getElementById(id) {
      return document.documentElement.querySelector(`#${id}`);
    },
    querySelector(sel) {
      return document.documentElement.querySelector(sel);
    },
    querySelectorAll(sel) {
      return document.documentElement.querySelectorAll(sel);
    },
  };

  let html;
  let head = null;
  let body = null;

  if (svgDocument || xmlDocument) {
    html = new MockElement(svgDocument ? 'svg' : 'root', document);
    html.clientWidth = vw;
    html.clientHeight = vh;
    html.scrollWidth = docW;
    html.scrollHeight = docH;
    html.getBoundingClientRect = () => {
      const t = html.style.getPropertyValue('transform') || '';
      const mScale = t.match(/scale\(([^)]+)\)/);
      const mTrans = t.match(/translate\(([^p]+)px,\s*([^p]+)px\)/);
      const scale = mScale ? parseFloat(mScale[1]) : 1;
      const tx = mTrans ? parseFloat(mTrans[1]) : 0;
      const ty = mTrans ? parseFloat(mTrans[2]) : 0;
      return { left: tx, top: ty, width: docW * scale, height: docH * scale };
    };
  } else {
    html = new MockElement('html', document);
    head = new MockElement('head', document);
    body = new MockElement('body', document);
    html.appendChild(head);
    html.appendChild(body);

    html.clientWidth = vw;
    html.clientHeight = vh;
    html.scrollWidth = docW;
    html.scrollHeight = docH;

    body.scrollWidth = docW;
    body.scrollHeight = docH;
    body.offsetWidth = docW;
    body.offsetHeight = docH;
    body.getBoundingClientRect = () => {
      const t = body.style.getPropertyValue('transform') || '';
      const mScale = t.match(/scale\(([^)]+)\)/);
      const mTrans = t.match(/translate\(([^p]+)px,\s*([^p]+)px\)/);
      const scale = mScale ? parseFloat(mScale[1]) : 1;
      const tx = mTrans ? parseFloat(mTrans[1]) : 0;
      const ty = mTrans ? parseFloat(mTrans[2]) : 0;
      return {
        left: bodyMarginX - scrollX + tx,
        top: bodyMarginY - scrollY + ty,
        width: docW * scale,
        height: docH * scale,
      };
    };
  }

  document.documentElement = html;
  document.head = head;
  document.body = body;

  const winTarget = new MockEventTarget();
  const windowObj = {
    document,
    location: new URL(options.url || 'https://example.com/article'),
    innerWidth: vw,
    innerHeight: vh,
    get scrollX() {
      return scrollX;
    },
    get scrollY() {
      return scrollY;
    },
    scrollTo(xOrOpts, yArg) {
      let reqX = 0;
      let reqY = 0;
      let behavior = 'auto';
      if (typeof xOrOpts === 'object' && xOrOpts !== null) {
        reqX = xOrOpts.left ?? 0;
        reqY = xOrOpts.top ?? 0;
        behavior = xOrOpts.behavior ?? 'auto';
      } else {
        reqX = xOrOpts ?? 0;
        reqY = yArg ?? 0;
      }
      const maxScrollX = Math.max(0, docW - windowObj.innerWidth);
      const maxScrollY = Math.max(0, docH - windowObj.innerHeight);
      scrollX = Math.min(maxScrollX, Math.max(0, reqX));
      scrollY = Math.min(maxScrollY, Math.max(0, reqY));
      scrollCalls.push({ requestedX: reqX, requestedY: reqY, behavior, scrollX, scrollY });
    },
    getComputedStyle(el) {
      return el?._computedStyle || {};
    },
    addEventListener: winTarget.addEventListener.bind(winTarget),
    removeEventListener: winTarget.removeEventListener.bind(winTarget),
    dispatchEvent: winTarget.dispatchEvent.bind(winTarget),
    requestAnimationFrame(cb) {
      return setTimeout(() => cb(Date.now()), 0);
    },
    cancelAnimationFrame(id) {
      clearTimeout(id);
    },
    setTimeout,
    clearTimeout,
    URL,
    scrollCalls,
  };

  return { window: windowObj, document, html, body, head };
}

/**
 * Creates a full in-memory Chrome or Firefox WebExtension runtime connecting
 * Background, Content Script(s), and Popup with realistic storage, tabs,
 * badges, commands, zoom scopes, and native zoom caps.
 */
export function createExtensionNetwork(options = {}) {
  const browserType = options.browserType || 'chrome'; // 'chrome' | 'firefox'
  const nativeZoomCap = options.nativeZoomCap ?? 5.0;
  const nativeZoomFloor = options.nativeZoomFloor ?? 0.3;
  const rejectOutOfRangeZoom = Boolean(options.rejectOutOfRangeZoom);

  const storageData = { ...(options.initialStorage || {}) };
  const storageChangeListeners = [];
  const installedListeners = [];
  const commandListeners = [];
  const zoomChangeListeners = [];
  const tabRemovedListeners = [];
  const bgMessageListeners = [];
  const runtimeMessagesLog = [];

  const tabs = new Map();
  let nextTabId = 1;

  function addTab({
    url = 'https://example.com/page',
    active = true,
    restricted = false,
    initialNativeZoom = 1,
  } = {}) {
    if (active) {
      for (const t of tabs.values()) t.active = false;
    }
    const tab = {
      id: nextTabId++,
      url,
      active,
      restricted,
      nativeZoom: initialNativeZoom,
      zoomScope: 'per-origin',
      badge: { text: '', bgColor: '', textColor: '' },
      contentMessageListeners: [],
    };
    tabs.set(tab.id, tab);
    return tab;
  }

  function makeStorageApi() {
    return {
      local: {
        get(keys) {
          const result = {};
          if (keys == null) {
            Object.assign(result, structuredClone(storageData));
          } else if (typeof keys === 'string') {
            if (keys in storageData) result[keys] = structuredClone(storageData[keys]);
          } else if (Array.isArray(keys)) {
            for (const k of keys) {
              if (k in storageData) result[k] = structuredClone(storageData[k]);
            }
          }
          return Promise.resolve(result);
        },
        set(items) {
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            const oldValue = k in storageData ? structuredClone(storageData[k]) : undefined;
            const newValue = structuredClone(v);
            storageData[k] = newValue;
            changes[k] = { oldValue, newValue };
          }
          // Deliver storage.onChanged asynchronously on microtask (matches real browsers)
          Promise.resolve().then(() => {
            for (const fn of storageChangeListeners) {
              fn(changes, 'local');
            }
          });
          return Promise.resolve();
        },
        remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete storageData[k];
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener(fn) {
          storageChangeListeners.push(fn);
        },
      },
    };
  }

  function dispatchMessage(listeners, message, sender) {
    return new Promise((resolve) => {
      let responded = false;
      const sendResponse = (val) => {
        if (!responded) {
          responded = true;
          resolve(val);
        }
      };
      let asyncExpected = false;
      for (const fn of listeners) {
        const ret = fn(message, sender, sendResponse);
        if (ret === true) asyncExpected = true;
      }
      if (!asyncExpected && !responded) {
        resolve(undefined);
      }
    });
  }

  function makeRawApi({ role, tab = null }) {
    const apiObj = {
      storage: makeStorageApi(),
      runtime: {
        id: 'arb-zoom-test-extension-id',
        lastError: null,
        getURL(p = '') {
          const scheme = browserType === 'firefox' ? 'moz-extension' : 'chrome-extension';
          return `${scheme}://arb-zoom-test/${p}`;
        },
        sendMessage(message) {
          runtimeMessagesLog.push({ role, tabId: tab?.id ?? null, message });
          const sender = tab ? { tab: { id: tab.id, url: tab.url } } : {};
          return dispatchMessage(bgMessageListeners, message, sender);
        },
        onMessage: {
          addListener(fn) {
            if (role === 'background') bgMessageListeners.push(fn);
            else if (role === 'content' && tab) tab.contentMessageListeners.push(fn);
          },
        },
        onInstalled: {
          addListener(fn) {
            installedListeners.push(fn);
          },
        },
      },
      tabs: {
        query(info) {
          let list = Array.from(tabs.values());
          if (info?.active) list = list.filter((t) => t.active);
          return Promise.resolve(list.map((t) => ({ id: t.id, url: t.url, active: t.active })));
        },
        sendMessage(tabId, message) {
          const target = tabs.get(tabId);
          if (!target || target.restricted || target.contentMessageListeners.length === 0) {
            return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
          }
          return dispatchMessage(target.contentMessageListeners, message, {});
        },
        getZoom(tabId) {
          const target = tabs.get(tabId);
          if (!target) return Promise.reject(new Error('Tab not found'));
          return Promise.resolve(target.nativeZoom);
        },
        setZoomSettings(tabId, settings) {
          const target = tabs.get(tabId);
          if (!target) return Promise.reject(new Error('Tab not found'));
          if (settings?.scope) target.zoomScope = settings.scope;
          return Promise.resolve();
        },
        setZoom(tabId, factor) {
          const target = tabs.get(tabId);
          if (!target) return Promise.reject(new Error('Tab not found'));
          if (rejectOutOfRangeZoom && (factor > nativeZoomCap || factor < nativeZoomFloor)) {
            return Promise.reject(
              new Error(`Zoom value ${factor} is out of range [${nativeZoomFloor}, ${nativeZoomCap}]`)
            );
          }
          const oldZoom = target.nativeZoom;
          const clamped = Math.min(nativeZoomCap, Math.max(nativeZoomFloor, factor));
          target.nativeZoom = clamped;
          if (Math.abs(oldZoom - clamped) > 1e-4) {
            for (const fn of zoomChangeListeners) {
              fn({ tabId, oldZoomFactor: oldZoom, newZoomFactor: clamped });
            }
          }
          return Promise.resolve();
        },
        onZoomChange: {
          addListener(fn) {
            zoomChangeListeners.push(fn);
          },
        },
        onRemoved: {
          addListener(fn) {
            tabRemovedListeners.push(fn);
          },
        },
      },
      action: {
        setBadgeText({ tabId, text }) {
          const target = tabs.get(tabId);
          if (target) target.badge.text = text;
          return Promise.resolve();
        },
        setBadgeBackgroundColor({ tabId, color }) {
          const target = tabs.get(tabId);
          if (target) target.badge.bgColor = color;
          return Promise.resolve();
        },
        setBadgeTextColor({ tabId, color }) {
          const target = tabs.get(tabId);
          if (target) target.badge.textColor = color;
          return Promise.resolve();
        },
      },
      commands: {
        onCommand: {
          addListener(fn) {
            commandListeners.push(fn);
          },
        },
      },
    };

    if (browserType === 'firefox') {
      // Match real Firefox: getBrowserInfo exists in background/popup, NOT in content scripts
      if (role !== 'content') {
        apiObj.runtime.getBrowserInfo = () => Promise.resolve({ name: 'Firefox', version: '140.0' });
      }
      return { browser: apiObj };
    }
    return { chrome: apiObj };
  }

  function runScriptsInContext(ctx, relativePaths) {
    const context = vm.createContext(ctx);
    ctx.globalThis = context;
    ctx.self = context;
    if (ctx.document) ctx.window = context;

    for (const rel of relativePaths) {
      const fullPath = path.join(ROOT, rel);
      const code = fs.readFileSync(fullPath, 'utf8');
      vm.runInContext(code, context, { filename: rel });
    }
    return context;
  }

  function bootBackground() {
    const distDir = browserType === 'firefox' ? 'dist/firefox' : 'dist/chrome';
    const rawGlobals = makeRawApi({ role: 'background' });

    const ctx = {
      console,
      setTimeout,
      clearTimeout,
      URL,
      ...rawGlobals,
    };

    if (browserType === 'chrome') {
      ctx.importScripts = (...scripts) => {
        for (const s of scripts) {
          const resolved = path.resolve(ROOT, distDir, 'background', s);
          const code = fs.readFileSync(resolved, 'utf8');
          vm.runInContext(code, ctx.globalThis, { filename: resolved });
        }
      };
      return runScriptsInContext(ctx, [`${distDir}/background/background.js`]);
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, distDir, 'manifest.json'), 'utf8'));
    const scripts = manifest.background.scripts.map((s) => `${distDir}/${s}`);
    return runScriptsInContext(ctx, scripts);
  }

  function bootContent(tab, domOptions = {}) {
    const distDir = browserType === 'firefox' ? 'dist/firefox' : 'dist/chrome';
    const dom = createDomEnvironment({ url: tab.url, ...domOptions });
    const rawGlobals = makeRawApi({ role: 'content', tab });

    const ctx = {
      ...dom.window,
      console,
      ...rawGlobals,
    };

    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, distDir, 'manifest.json'), 'utf8'));
    const scripts = manifest.content_scripts[0].js.map((s) => `${distDir}/${s}`);
    const context = runScriptsInContext(ctx, scripts);
    return { context, dom };
  }

  function bootPopup() {
    const distDir = browserType === 'firefox' ? 'dist/firefox' : 'dist/chrome';
    const dom = createDomEnvironment({ url: 'extension://popup/popup.html' });
    const htmlSource = fs.readFileSync(path.join(ROOT, distDir, 'popup/popup.html'), 'utf8');
    const bodyMatch = htmlSource.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    dom.body.innerHTML = bodyMatch ? bodyMatch[1] : '';

    const rawGlobals = makeRawApi({ role: 'popup' });
    const ctx = {
      ...dom.window,
      console,
      ...rawGlobals,
    };

    const context = runScriptsInContext(ctx, [
      `${distDir}/shared/browser-api.js`,
      `${distDir}/shared/constants.js`,
      `${distDir}/shared/zoom-math.js`,
      `${distDir}/popup/popup.js`,
    ]);
    return { context, dom };
  }

  async function triggerInstalled() {
    for (const fn of installedListeners) {
      await fn({ reason: 'install' });
    }
    await flushTimers(10);
  }

  async function triggerCommand(command) {
    for (const fn of commandListeners) {
      await fn(command);
    }
  }

  function triggerExternalNativeZoom(tabId, newZoomFactor) {
    const target = tabs.get(tabId);
    if (!target) return;
    const oldZoomFactor = target.nativeZoom;
    target.nativeZoom = newZoomFactor;
    for (const fn of zoomChangeListeners) {
      fn({ tabId, oldZoomFactor, newZoomFactor });
    }
  }

  return {
    browserType,
    storageData,
    runtimeMessagesLog,
    tabs,
    addTab,
    bootBackground,
    bootContent,
    bootPopup,
    triggerInstalled,
    triggerCommand,
    triggerExternalNativeZoom,
  };
}

export function flushTimers(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
