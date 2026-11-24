import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createDomEnvironment, MockElement, MockEvent, ROOT, flushTimers } from './helpers/mock-env.mjs';

function loadEngineInDom(domOptions = {}, engineOptions = {}) {
  const dom = createDomEnvironment(domOptions);
  const ctx = vm.createContext({
    ...dom.window,
    console,
  });
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.window = ctx;

  for (const rel of [
    'src/shared/browser-api.js',
    'src/shared/constants.js',
    'src/shared/zoom-math.js',
    'src/content/zoom-engine.js',
    'src/content/hud.js',
  ]) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, ctx, { filename: rel });
  }

  const states = [];
  const engine = new ctx.ArbZoom.ZoomEngine({
    onStateChange: (s, meta) => states.push({ state: s, meta }),
    ...engineOptions,
  });

  return { dom, ctx, engine, states };
}

test('ZoomEngine activates cleanly from a scrolled page with body margin, uses instant scroll, and restores longhand styles on reset', () => {
  const { dom, engine } = loadEngineInDom({
    viewportWidth: 1000,
    viewportHeight: 800,
    docWidth: 1000,
    docHeight: 4000,
    bodyMarginX: 8,
    bodyMarginY: 8,
    initialScrollY: 600,
  });

  // Pre-existing inline longhand styles that must be preserved after reset
  dom.html.style.setProperty('overflow-x', 'hidden', 'important');
  dom.html.style.setProperty('cursor', 'crosshair', 'important');
  dom.body.style.setProperty('transform', 'none');
  dom.body.style.setProperty('overflow-x', 'hidden');

  const state = engine.setZoom(25);
  assert.equal(state.totalScale, 25);
  assert.equal(state.cssScale, 25);
  assert.equal(state.isCssActive, true);
  assert.equal(dom.html.style.getPropertyValue('overflow-x'), 'hidden');
  assert.equal(dom.html.style.getPropertyValue('overflow-y'), 'hidden');
  // Body overflow forced to visible while html{overflow:hidden} so body doesn't become clipped box
  assert.equal(dom.body.style.getPropertyValue('overflow-x'), 'visible');
  assert.equal(dom.window.scrollY, 0);
  // Pre-existing cursor preserved even when zoomed & not panning
  assert.equal(dom.html.style.getPropertyValue('cursor'), 'crosshair');
  assert.equal(dom.body.style.getPropertyValue('transform-origin'), '0 0');
  assert.match(dom.body.style.getPropertyValue('transform'), /scale\(25\)/);

  // Reset to 100% -> restores all original longhand inline styles + priorities and exact scrollY = 600
  const resetState = engine.resetZoom();
  assert.equal(resetState.totalScale, 1);
  assert.equal(resetState.isCssActive, false);
  assert.equal(dom.html.style.getPropertyValue('overflow-x'), 'hidden');
  assert.equal(dom.html.style.getPropertyPriority('overflow-x'), 'important');
  assert.equal(dom.html.style.getPropertyValue('overflow-y'), '');
  assert.equal(dom.html.style.getPropertyValue('cursor'), 'crosshair');
  assert.equal(dom.html.style.getPropertyPriority('cursor'), 'important');
  assert.equal(dom.body.style.getPropertyValue('transform'), 'none');
  assert.equal(dom.body.style.getPropertyValue('overflow-x'), 'hidden');
  assert.equal(dom.window.scrollY, 600);

  // Every scrollTo call must request instant behavior (immune to html { scroll-behavior: smooth })
  assert.ok(dom.window.scrollCalls.length >= 2);
  for (const call of dom.window.scrollCalls) {
    assert.equal(call.behavior, 'instant');
  }

  engine.destroy();
});

test('ZoomEngine wheel zoom zooms around exact cursor point, handles smooth trackpad pinch, macOS Shift+Wheel, and zero-delta ticks', () => {
  const { dom, engine } = loadEngineInDom({
    viewportWidth: 1200,
    viewportHeight: 800,
    docWidth: 2000,
    docHeight: 3000,
  });

  // Smooth fine trackpad pinch (deltaY = -8) must NOT get trapped oscillating at 100%
  for (let i = 0; i < 8; i++) {
    const prev = engine.totalScale;
    dom.window.dispatchEvent(
      new MockEvent('wheel', {
        clientX: 300,
        clientY: 200,
        deltaX: 0,
        deltaY: -8,
        deltaMode: 0,
        ctrlKey: true,
        target: dom.body,
      })
    );
    assert.ok(engine.totalScale > prev, `Pinch frame ${i} trapped: ${prev} -> ${engine.totalScale}`);
  }

  // Zero-delta horizontal tick while holding Ctrl must NOT snap near-100% scale back to 1.0
  engine.setZoom(1.03);
  dom.window.dispatchEvent(
    new MockEvent('wheel', {
      clientX: 300,
      clientY: 200,
      deltaX: 20,
      deltaY: 0,
      deltaMode: 0,
      ctrlKey: true,
      target: dom.body,
    })
  );
  assert.equal(engine.totalScale, 1.03);

  // Focal invariant check on Alt + Line-mode wheel
  engine.setZoom(2);
  const docXBefore = (300 - engine.tx) / engine.cssScale;
  const docYBefore = (200 - engine.ty) / engine.cssScale;
  dom.window.dispatchEvent(
    new MockEvent('wheel', {
      clientX: 300,
      clientY: 200,
      deltaX: 0,
      deltaY: -6,
      deltaMode: 1,
      altKey: true,
      target: dom.body,
    })
  );
  const docXAfter = (300 - engine.tx) / engine.cssScale;
  const docYAfter = (200 - engine.ty) / engine.cssScale;
  assert.ok(Math.abs(docXBefore - docXAfter) < 1e-6);
  assert.ok(Math.abs(docYBefore - docYAfter) < 1e-6);

  // macOS Shift + Wheel sends deltaX with deltaY=0 when wheelTrigger === 'shift'
  engine.updateSettings({ wheelTrigger: 'shift' });
  const beforeShiftZoom = engine.totalScale;
  dom.window.dispatchEvent(
    new MockEvent('wheel', {
      clientX: 300,
      clientY: 200,
      deltaX: -120,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: true,
      target: dom.body,
    })
  );
  assert.ok(engine.totalScale > beforeShiftZoom);

  // wheelTrigger: 'off' ignores wheel zoom
  const scaleBefore = engine.totalScale;
  engine.updateSettings({ wheelTrigger: 'off' });
  dom.window.dispatchEvent(
    new MockEvent('wheel', {
      clientX: 300,
      clientY: 200,
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      altKey: true,
      target: dom.body,
    })
  );
  assert.equal(engine.totalScale, scaleBefore);

  engine.destroy();
});

test('ZoomEngine wheel pans while zoomed, supports Shift horizontal pan, and preserves nested & Shadow DOM scrollable containers', async () => {
  const { dom, engine } = loadEngineInDom({
    viewportWidth: 1000,
    viewportHeight: 800,
    docWidth: 1000,
    docHeight: 2000,
  });

  // Nested vertical scrollable container
  const scrollBox = new MockElement('div', dom.document);
  scrollBox._computedStyle = { overflowY: 'auto', overflowX: 'hidden' };
  scrollBox.scrollHeight = 600;
  scrollBox.clientHeight = 150;
  scrollBox.scrollTop = 20;
  dom.body.appendChild(scrollBox);

  // Nested horizontal scrollable <pre> inside a Shadow DOM component
  const shadowHost = new MockElement('code-viewer', dom.document);
  const shadowRoot = shadowHost.attachShadow();
  const hBox = new MockElement('pre', dom.document);
  hBox._computedStyle = { overflowX: 'auto', overflowY: 'hidden' };
  hBox.scrollWidth = 1000;
  hBox.clientWidth = 200;
  hBox.scrollLeft = 0;
  shadowRoot.appendChild(hBox);
  dom.body.appendChild(shadowHost);

  engine.setZoom(10);
  const startTx = engine.tx;
  const startTy = engine.ty;

  // 1. Inner vertical scroll container with room left -> NOT hijacked
  const innerEv = new MockEvent('wheel', {
    clientX: 500,
    clientY: 400,
    deltaX: 0,
    deltaY: 50,
    deltaMode: 0,
    target: scrollBox,
  });
  dom.window.dispatchEvent(innerEv);
  assert.equal(innerEv.defaultPrevented, false);
  assert.equal(engine.ty, startTy);

  // 2. Shift + vertical wheel over Shadow DOM horizontal scroll box -> remapped BEFORE checking scrollable, NOT hijacked!
  const hInnerEv = new MockEvent('wheel', {
    clientX: 500,
    clientY: 400,
    deltaX: 0,
    deltaY: 50,
    deltaMode: 0,
    shiftKey: true,
    target: shadowHost,
    composedPath: [hBox, shadowRoot, shadowHost, dom.body, dom.html],
  });
  dom.window.dispatchEvent(hInnerEv);
  assert.equal(hInnerEv.defaultPrevented, false);
  assert.equal(engine.tx, startTx);

  // 3. When inner vertical box hits its bottom limit -> pans zoomed page
  scrollBox.scrollTop = 450;
  const atLimitEv = new MockEvent('wheel', {
    clientX: 500,
    clientY: 400,
    deltaX: 0,
    deltaY: 80,
    deltaMode: 0,
    target: scrollBox,
  });
  dom.window.dispatchEvent(atLimitEv);
  assert.equal(atLimitEv.defaultPrevented, true);
  assert.equal(engine.ty, startTy - 80);

  // 4. Shift + vertical wheel on body -> pans horizontally
  const shiftEv = new MockEvent('wheel', {
    clientX: 500,
    clientY: 400,
    deltaX: 0,
    deltaY: 60,
    deltaMode: 0,
    shiftKey: true,
    target: dom.body,
  });
  dom.window.dispatchEvent(shiftEv);
  assert.equal(shiftEv.defaultPrevented, true);
  assert.equal(engine.tx, startTx - 60);

  await flushTimers(10);
  engine.destroy();
});

test('ZoomEngine drag-to-pan handles Pan Mode, Space+Drag, Middle-Mouse auxclick/mousedown, lost button outside window, and reset cleanup', () => {
  const { dom, engine } = loadEngineInDom({
    viewportWidth: 1000,
    viewportHeight: 800,
    docWidth: 1000,
    docHeight: 2000,
  });

  engine.setZoom(10);
  engine.panToNormalized(0.5, 0.5);
  const baseTx = engine.tx;
  const baseTy = engine.ty;

  // 1. Pan Mode drag
  engine.setPanMode(true);
  assert.equal(dom.html.style.getPropertyValue('cursor'), 'grab');

  dom.window.dispatchEvent(
    new MockEvent('pointerdown', { button: 0, pointerId: 1, clientX: 500, clientY: 400, target: dom.body })
  );
  assert.equal(dom.html.style.getPropertyValue('cursor'), 'grabbing');
  dom.window.dispatchEvent(
    new MockEvent('pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 620,
      clientY: 480,
      target: dom.body,
    })
  );
  assert.equal(engine.tx, baseTx + 120);
  assert.equal(engine.ty, baseTy + 80);
  dom.window.dispatchEvent(new MockEvent('pointerup', { pointerId: 1, target: dom.body }));

  // Trailing click suppressed
  const clickEv = new MockEvent('click', { target: dom.body });
  dom.window.dispatchEvent(clickEv);
  assert.equal(clickEv.defaultPrevented, true);

  // Escape turns off Pan Mode
  dom.window.dispatchEvent(new MockEvent('keydown', { key: 'Escape', target: dom.body }));
  assert.equal(engine.panMode, false);

  // 2. Spacebar ignored inside Shadow DOM <input> and on focused <button>
  const shadowHost = new MockElement('my-search', dom.document);
  const shadowInput = new MockElement('input', dom.document);
  const spaceInShadowInput = new MockEvent('keydown', {
    code: 'Space',
    key: ' ',
    target: shadowHost,
    composedPath: [shadowInput, shadowHost, dom.body],
  });
  dom.window.dispatchEvent(spaceInShadowInput);
  assert.equal(spaceInShadowInput.defaultPrevented, false);
  assert.equal(engine.spaceHeld, false);

  const btnEl = new MockElement('button', dom.document);
  const spaceOnBtn = new MockEvent('keydown', { code: 'Space', key: ' ', target: btnEl });
  dom.window.dispatchEvent(spaceOnBtn);
  assert.equal(spaceOnBtn.defaultPrevented, false);
  assert.equal(engine.spaceHeld, false);

  // 3. Middle-mouse mousedown & auxclick suppressed
  const midMouseDown = new MockEvent('mousedown', { button: 1, target: dom.body });
  dom.window.dispatchEvent(midMouseDown);
  assert.equal(midMouseDown.defaultPrevented, true);

  const midAuxClick = new MockEvent('auxclick', { button: 1, target: dom.body });
  dom.window.dispatchEvent(midAuxClick);
  assert.equal(midAuxClick.defaultPrevented, true);

  // 4. Releasing mouse button outside window (buttons === 0 on next move) terminates drag cleanly
  dom.window.dispatchEvent(
    new MockEvent('pointerdown', { button: 1, pointerId: 2, clientX: 400, clientY: 400, target: dom.body })
  );
  assert.equal(engine.isDragging, true);
  dom.window.dispatchEvent(
    new MockEvent('pointermove', {
      pointerId: 2,
      pointerType: 'mouse',
      buttons: 0,
      clientX: 450,
      clientY: 450,
      target: dom.body,
    })
  );
  assert.equal(engine.isDragging, false);

  // 5. Resetting while dragging clears isDragging so subsequent pointermove is ignored
  dom.window.dispatchEvent(
    new MockEvent('pointerdown', { button: 1, pointerId: 3, clientX: 400, clientY: 400, target: dom.body })
  );
  assert.equal(engine.isDragging, true);
  engine.resetZoom();
  assert.equal(engine.isDragging, false);
  dom.window.dispatchEvent(
    new MockEvent('pointermove', { pointerId: 3, clientX: 100, clientY: 100, target: dom.body })
  );
  assert.equal(engine.tx, 0);
  assert.equal(engine.ty, 0);

  engine.destroy();
});

test('ZoomEngine supports macOS Option+=/-/0 e.code keys, editable exclusion, and arrow panning', () => {
  const { dom, engine } = loadEngineInDom({
    viewportWidth: 1000,
    viewportHeight: 800,
    docWidth: 1000,
    docHeight: 2000,
  });

  // macOS Option+= produces key '≠', code 'Equal'
  dom.window.dispatchEvent(
    new MockEvent('keydown', { key: '≠', code: 'Equal', altKey: true, target: dom.body })
  );
  assert.equal(engine.totalScale, 1.25);

  // macOS Option+- produces key '–', code 'Minus'
  dom.window.dispatchEvent(
    new MockEvent('keydown', { key: '–', code: 'Minus', altKey: true, target: dom.body })
  );
  assert.equal(engine.totalScale, 1);

  // Zoom in twice and test arrow panning + macOS Option+0 ('º', code 'Digit0')
  dom.window.dispatchEvent(new MockEvent('keydown', { key: '=', code: 'Equal', altKey: true, target: dom.body }));
  dom.window.dispatchEvent(new MockEvent('keydown', { key: '=', code: 'Equal', altKey: true, target: dom.body }));
  engine.panToNormalized(0.5, 0.5);
  const preY = engine.ty;
  dom.window.dispatchEvent(new MockEvent('keydown', { key: 'ArrowDown', target: dom.body }));
  assert.equal(engine.ty, preY - 90);
  dom.window.dispatchEvent(new MockEvent('keydown', { key: 'ArrowUp', shiftKey: true, target: dom.body }));
  assert.equal(engine.ty, preY - 90 + 260);

  // Editable element ignores Alt+0 reset
  const textarea = new MockElement('textarea', dom.document);
  dom.window.dispatchEvent(new MockEvent('keydown', { key: '0', code: 'Digit0', altKey: true, target: textarea }));
  assert.ok(engine.totalScale > 1);

  // macOS Option+0 resets cleanly
  dom.window.dispatchEvent(new MockEvent('keydown', { key: 'º', code: 'Digit0', altKey: true, target: dom.body }));
  assert.equal(engine.totalScale, 1);

  engine.destroy();
});

test('ZoomEngine Hybrid mode cancels orphaned timers on reset, caches lower cap, preserves focal point, and scopes pixelated CSS', async () => {
  const syncCalls = [];
  const { dom, engine } = loadEngineInDom(
    { viewportWidth: 1000, viewportHeight: 800, docWidth: 1000, docHeight: 2000 },
    {
      settings: { mode: 'hybrid' },
      syncNativeZoom: async (requested) => {
        syncCalls.push(requested);
        return { actualNativeZoom: Math.min(3.0, Math.max(0.5, requested)), ok: true };
      },
    }
  );

  // 1. Regression: debounced setZoom(3) followed by resetZoom() within 90ms must cancel orphaned timer!
  engine.setZoom(3, { immediateNative: false });
  engine.resetZoom();
  await flushTimers(130);
  assert.equal(syncCalls.length, 0, 'Orphaned nativeSyncTimer must not fire after resetZoom');
  assert.equal(engine.totalScale, 1);
  assert.equal(engine.nativeZoom, 1);
  assert.equal(engine.isCssActive, false);

  // 2. Request 15x in hybrid mode -> browser caps at 3.0 -> engine compensates cssScale = 5.0
  engine.setZoom(15, { immediateNative: true });
  await flushTimers(20);
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0], 5);
  assert.equal(engine.nativeZoom, 3);
  assert.equal(engine.cssScale, 5);
  assert.equal(engine.totalScale, 15);

  // 3. Subsequent zoom to 20x uses cached observedMaxNativeZoom=3.0 -> does NOT spam syncNativeZoom!
  engine.setZoom(20, { immediateNative: true });
  await flushTimers(20);
  assert.equal(syncCalls.length, 1, 'Should not re-send syncNativeZoom when cap is already reached');
  assert.ok(Math.abs(engine.nativeZoom * engine.cssScale - 20) < 1e-3);

  // 4. Switch back to optical mode -> resets nativeZoom to 1x ONCE (not twice!) and moves full 20x to cssScale
  engine.updateSettings({ mode: 'optical' });
  await flushTimers(20);
  assert.equal(syncCalls.length, 2);
  assert.equal(syncCalls[1], 1);
  assert.equal(engine.nativeZoom, 1);
  assert.equal(engine.cssScale, 20);

  // 5. Crisp pixels toggle injects crisp-edges THEN pixelated, and removes stylesheet when reset to 100%
  engine.setPixelated(true);
  const styleEl = dom.head.querySelector('#arb-zoom-pixelated-style');
  assert.ok(styleEl);
  assert.ok(
    styleEl.textContent.indexOf('crisp-edges') < styleEl.textContent.indexOf('pixelated'),
    'pixelated must come AFTER crisp-edges so it is not overridden'
  );
  engine.resetZoom();
  assert.equal(
    dom.head.querySelector('#arb-zoom-pixelated-style'),
    null,
    'Pixelated stylesheet must not remain active on unzoomed 100% page'
  );

  engine.destroy();
});

test('ZoomHud stays completely inert when hidden, handles SVG/XML docs gracefully, rejects right-click drags, and clamps on resize', () => {
  // 1. Standalone SVG document: ZoomHud must NOT throw NotSupportedError, and ZoomEngine scales <svg>
  const svgEnv = loadEngineInDom({ svgDocument: true, viewportWidth: 800, viewportHeight: 600 });
  const svgHud = new svgEnv.ctx.ArbZoom.ZoomHud({});
  assert.equal(svgHud.mounted, false);
  svgEnv.engine.setZoom(10);
  assert.equal(svgEnv.engine.totalScale, 10);
  assert.match(svgEnv.dom.html.style.getPropertyValue('transform'), /scale\(10\)/);
  svgHud.destroy();
  svgEnv.engine.destroy();

  // 2. Raw XML document: ZoomEngine safely no-ops without phantom zoom state
  const xmlEnv = loadEngineInDom({ xmlDocument: true });
  const xmlHud = new xmlEnv.ctx.ArbZoom.ZoomHud({});
  assert.equal(xmlHud.mounted, false);
  xmlEnv.engine.setZoom(10);
  assert.equal(xmlEnv.engine.totalScale, 1);
  assert.equal(xmlEnv.engine.isCssActive, false);
  xmlHud.destroy();
  xmlEnv.engine.destroy();

  // 3. Full HTML HUD behavior
  const { dom, ctx, engine } = loadEngineInDom({
    viewportWidth: 1000,
    viewportHeight: 800,
    docWidth: 1200,
    docHeight: 2400,
  });

  const hud = new ctx.ArbZoom.ZoomHud({
    stepZoom: (dir) => engine.stepZoom(dir),
    setZoom: (s) => engine.setZoom(s),
    resetZoom: () => engine.resetZoom(),
    togglePan: () => engine.togglePanMode(),
    togglePixelated: () => engine.setPixelated(!engine.settings.pixelated),
    panToNormalized: (nx, ny) => engine.panToNormalized(nx, ny),
  });
  engine.onStateChange = (state) => hud.update(state);

  assert.equal(hud.host.parentElement, dom.html);
  assert.equal(hud.els.dock.inert, true);
  assert.equal(hud.els.dock.classList.contains('visible'), false);

  // Zoom to 1,250% -> HUD appears, dock.inert becomes false
  engine.setZoom(12.5);
  assert.equal(hud.els.dock.inert, false);
  assert.equal(hud.els.dock.classList.contains('visible'), true);
  assert.equal(hud.els.statusDot.classList.contains('hyper'), true);
  assert.equal(hud.els.input.value, '1,250%');

  // Keyboard events inside HUD input stop propagation (keydown, keyup, keypress)
  for (const type of ['keydown', 'keyup', 'keypress']) {
    const ev = new MockEvent(type, { key: 'k', target: hud.els.input });
    hud.els.input.dispatchEvent(ev);
    assert.equal(ev.propagationStopped, true, `${type} inside HUD input must stopPropagation`);
  }

  // Invalid inline input marks invalid state without changing zoom
  hud.els.input.focus();
  hud.els.input.value = 'not-a-zoom';
  hud.els.input.dispatchEvent(new MockEvent('keydown', { key: 'Enter', target: hud.els.input }));
  assert.equal(hud.els.input.classList.contains('invalid'), true);
  assert.equal(hud.els.input.getAttribute('aria-invalid'), 'true');
  assert.equal(engine.totalScale, 12.5);

  // Valid "50x" input works
  hud.els.input.value = '50x';
  hud.els.input.dispatchEvent(new MockEvent('keydown', { key: 'Enter', target: hud.els.input }));
  assert.equal(engine.totalScale, 50);
  assert.equal(hud.els.input.value, '5,000%');

  // Open minimap -> paints viewport rect & meta immediately
  hud.els.btnMinimap.click();
  assert.equal(hud.els.minimapCard.classList.contains('open'), true);
  assert.match(hud.els.minimapMeta.textContent, /Optical 50×/);

  // Right-click (button: 2) on minimap canvas or drag handle must NOT start dragging
  hud.els.minimapCanvas._rect = { left: 100, top: 200, width: 200, height: 100 };
  hud.els.minimapCanvas.dispatchEvent(
    new MockEvent('pointerdown', { button: 2, clientX: 250, clientY: 280, pointerId: 9, target: hud.els.minimapCanvas })
  );
  assert.equal(hud.isDraggingMinimap, false);

  // Left-click (button: 0) inside minimap canvas at (75%, 80%) pans camera accurately
  hud.els.minimapCanvas.dispatchEvent(
    new MockEvent('pointerdown', { button: 0, clientX: 250, clientY: 280, pointerId: 1, target: hud.els.minimapCanvas })
  );
  hud.els.minimapCanvas.dispatchEvent(new MockEvent('pointerup', { pointerId: 1, target: hud.els.minimapCanvas }));
  const afterMinimap = engine.getState().minimapRect;
  assert.ok(Math.abs(afterMinimap.x + afterMinimap.w / 2 - 0.75) < 0.05);
  assert.ok(Math.abs(afterMinimap.y + afterMinimap.h / 2 - 0.8) < 0.05);

  // Window resize shrinks viewport -> HUD dock clamps back inside viewport
  hud.els.dock._rect = { left: 0, top: 0, width: 360, height: 40 };
  hud.dockRight = 900;
  ctx.innerWidth = 500;
  dom.window.dispatchEvent(new MockEvent('resize'));
  assert.ok(hud.dockRight <= 500 - 360 - 8, `HUD dockRight ${hud.dockRight} not clamped to smaller viewport`);

  // Reset closes minimap and re-inerts dock
  hud.els.pill.querySelector('[data-action="reset"]').click();
  assert.equal(engine.totalScale, 1);
  assert.equal(hud.els.dock.classList.contains('visible'), false);
  assert.equal(hud.els.dock.inert, true);
  assert.equal(hud.els.minimapCard.classList.contains('open'), false);

  hud.destroy();
  engine.destroy();
});

test('ZoomEngine handles zoom-out (<100%) centering, narrow-body clamping, and magnetic snap back to 100%', () => {
  // Narrow centered body (720px wide inside 1440px viewport -> originX = 360)
  const narrow = loadEngineInDom({
    viewportWidth: 1440,
    viewportHeight: 800,
    docWidth: 720,
    docHeight: 1600,
    bodyMarginX: 360,
  });
  narrow.engine.setZoom(0.5);
  // Scaled body width is 360px; centered left edge on screen should be (1440 - 360)/2 = 540 -> tx = 540 - 360 = 180
  assert.equal(narrow.engine.tx, 180);
  narrow.engine.destroy();

  // Magnetic snap back to 100% on wheel zoom out
  const { dom, engine } = loadEngineInDom({
    viewportWidth: 1000,
    viewportHeight: 800,
    docWidth: 1000,
    docHeight: 800,
  });
  engine.setZoom(1.06);
  assert.equal(engine.isCssActive, true);
  dom.window.dispatchEvent(
    new MockEvent('wheel', {
      clientX: 500,
      clientY: 400,
      deltaX: 0,
      deltaY: 40,
      deltaMode: 0,
      ctrlKey: true,
      target: dom.body,
    })
  );
  assert.equal(engine.totalScale, 1);
  assert.equal(engine.isCssActive, false);
  assert.equal(dom.body.style.getPropertyValue('transform'), '');
  engine.destroy();
});
