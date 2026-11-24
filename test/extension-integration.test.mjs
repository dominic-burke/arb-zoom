import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionNetwork, MockEvent, flushTimers } from './helpers/mock-env.mjs';

for (const browserType of ['chrome', 'firefox']) {
  test(`[${browserType}] end-to-end Popup <-> Content <-> Background <-> Badge round-trip & zero SW wakeups on normal 100% load`, async () => {
    const net = createExtensionNetwork({ browserType });
    net.bootBackground();
    await net.triggerInstalled();

    assert.equal(net.storageData.arbZoomSettings.mode, 'optical');
    assert.equal(net.storageData.arbZoomSettings.rememberPerSite, true);

    const tab = net.addTab({ url: 'https://docs.example.org/guide', active: true });
    const content = net.bootContent(tab);
    await flushTimers(100);

    // Content script accurately detects Firefox even without runtime.getBrowserInfo
    assert.equal(content.context.ArbZoom.API.isFirefox, browserType === 'firefox');

    // Normal unzoomed 100% page load in Optical mode sends ZERO messages to the background SW!
    assert.equal(net.runtimeMessagesLog.length, 0);

    const popup = net.bootPopup();
    await flushTimers(30);

    assert.equal(popup.dom.document.getElementById('siteHost').textContent, 'docs.example.org');
    assert.equal(popup.dom.document.getElementById('zoomInput').value, '100%');
    assert.equal(popup.dom.document.getElementById('restrictedBanner').hidden, true);
    assert.equal(popup.dom.document.getElementById('hyperBadge').hidden, true);

    // Click 2,500% preset chip in popup
    const chip2500 = popup.dom.document.querySelector('[data-scale="25"]');
    chip2500.click();
    await flushTimers(90);

    assert.equal(content.context.ArbZoom.instance.engine.totalScale, 25);
    assert.match(content.dom.body.style.getPropertyValue('transform'), /scale\(25\)/);
    assert.equal(content.context.ArbZoom.instance.hud.els.input.value, '2,500%');
    assert.equal(popup.dom.document.getElementById('zoomInput').value, '2,500%');
    assert.equal(popup.dom.document.getElementById('hyperBadge').hidden, false);
    assert.equal(tab.badge.text, '2.5k');
    assert.equal(tab.badge.bgColor, '#7c3aed');

    // Escape in popup zoom input prevents closing popup; invalid text marks aria-invalid
    const input = popup.dom.document.getElementById('zoomInput');
    input.focus();
    input.value = 'bad-input';
    input.dispatchEvent(new MockEvent('keydown', { key: 'Enter', target: input }));
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    const escEv = new MockEvent('keydown', { key: 'Escape', target: input });
    input.dispatchEvent(escEv);
    assert.equal(escEv.defaultPrevented, true);

    // Type arbitrary 50,000% ("500x") into popup input and press Enter
    input.focus();
    input.value = '500x';
    input.dispatchEvent(new MockEvent('keydown', { key: 'Enter', target: input }));
    await flushTimers(90);

    assert.equal(content.context.ArbZoom.instance.engine.totalScale, 500);
    assert.equal(popup.dom.document.getElementById('zoomInput').value, '50,000%');
    assert.equal(tab.badge.text, '50k');

    // Toggle Pan Mode from popup -> reflected on content engine
    popup.dom.document.getElementById('togglePan').click();
    await flushTimers(20);
    assert.equal(content.context.ArbZoom.instance.engine.panMode, true);
    assert.equal(popup.dom.document.getElementById('togglePan').classList.contains('active'), true);

    // bfcache pageshow re-pushes toolbar badge if cleared on navigation
    tab.badge.text = '';
    content.dom.window.dispatchEvent(new MockEvent('pageshow', { persisted: true }));
    await flushTimers(30);
    assert.equal(tab.badge.text, '50k');

    // Click Reset in popup -> restores 100%, clears transform & toolbar badge
    popup.dom.document.getElementById('btnReset').click();
    await flushTimers(90);
    assert.equal(content.context.ArbZoom.instance.engine.totalScale, 1);
    assert.equal(content.dom.body.style.getPropertyValue('transform'), '');
    assert.equal(popup.dom.document.getElementById('hyperBadge').hidden, true);
    assert.equal(tab.badge.text, '');
  });

  test(`[${browserType}] Hybrid mode sets per-tab scope, handles range-rejecting caps, updates popup breakdown live, and syncs external tabs.onZoomChange`, async () => {
    // Firefox simulated with rejectOutOfRangeZoom: true and cap 3.0 (matching real zoom.maxPercent=300!)
    const cap = browserType === 'firefox' ? 3.0 : 5.0;
    const net = createExtensionNetwork({
      browserType,
      nativeZoomCap: cap,
      rejectOutOfRangeZoom: browserType === 'firefox',
    });
    net.bootBackground();
    await net.triggerInstalled();

    const tab = net.addTab({ url: 'https://news.example.com/story', active: true });
    const content = net.bootContent(tab);
    await flushTimers(20);

    const popup = net.bootPopup();
    await flushTimers(20);

    // Switch to Hybrid mode in popup
    popup.dom.document.getElementById('modeHybrid').click();
    await flushTimers(40);
    assert.equal(net.storageData.arbZoomSettings.mode, 'hybrid');

    // Set 1,500% (15x) via popup input -> awaits native sync -> popup breakdown is immediately accurate!
    const input = popup.dom.document.getElementById('zoomInput');
    input.focus();
    input.value = '1500%';
    input.dispatchEvent(new MockEvent('keydown', { key: 'Enter', target: input }));
    await flushTimers(140);

    const engine = content.context.ArbZoom.instance.engine;
    assert.equal(tab.zoomScope, 'per-tab');
    assert.equal(tab.nativeZoom, cap);
    assert.equal(engine.nativeZoom, cap);
    assert.ok(Math.abs(engine.cssScale - 15 / cap) < 1e-3);
    assert.equal(
      popup.dom.document.getElementById('zoomBreakdown').textContent,
      `Hybrid: Native ${cap.toFixed(2)}× · Optical ${(15 / cap).toFixed(2)}×`
    );
    assert.equal(tab.badge.text, '1.5k');
    assert.equal(tab.badge.bgColor, '#7c3aed');

    // External native zoom change (e.g. user pressed native Ctrl+0) syncs engine via tabs.onZoomChange
    net.triggerExternalNativeZoom(tab.id, 1);
    await flushTimers(40);
    assert.equal(engine.nativeZoom, 1);

    // Resetting in Hybrid mode resets native zoom and CSS cleanly
    popup.dom.document.getElementById('btnReset').click();
    await flushTimers(140);
    assert.equal(tab.nativeZoom, 1);
    assert.equal(engine.totalScale, 1);
    assert.equal(engine.cssScale, 1);
    assert.equal(tab.badge.text, '');
  });

  test(`[${browserType}] per-site zoom memory persists across reloads, flushes on pagehide, isolates file:// URLs, and survives settings toggles on unzoomed tabs`, async () => {
    const net = createExtensionNetwork({ browserType });
    net.bootBackground();
    await net.triggerInstalled();

    // Open two tabs on the same origin: Tab A zoomed, Tab B unzoomed
    const tabA = net.addTab({ url: 'https://maps.example.io/a', active: true });
    const contentA = net.bootContent(tabA);
    const tabB = net.addTab({ url: 'https://maps.example.io/b', active: false });
    net.bootContent(tabB);
    await flushTimers(20);

    // Zoom Tab A to 12x and immediately trigger pagehide (must flush before 220ms debounce!)
    contentA.context.ArbZoom.instance.engine.setZoom(12);
    contentA.dom.window.dispatchEvent(new MockEvent('pagehide'));
    await flushTimers(30);
    assert.equal(net.storageData.arbZoomSiteZooms['https://maps.example.io'], 12);

    // Regression: toggling a setting in popup while Tab B is at 100% must NOT delete Tab A's saved zoom!
    const popup = net.bootPopup();
    await flushTimers(20);
    popup.dom.document.getElementById('toggleHud').click();
    await flushTimers(280);
    assert.equal(net.storageData.arbZoomSiteZooms['https://maps.example.io'], 12);

    // Reload on same origin hydrates 12x automatically
    const tabReload = net.addTab({ url: 'https://maps.example.io/c', active: true });
    const contentReload = net.bootContent(tabReload);
    await flushTimers(50);
    assert.equal(contentReload.context.ArbZoom.instance.engine.totalScale, 12);

    // Local file:// URLs get distinct per-file keys (not collapsed into "null")
    const fileTab1 = net.addTab({ url: 'file:///tmp/doc-one.html', active: true });
    const fileContent1 = net.bootContent(fileTab1);
    await flushTimers(20);
    fileContent1.context.ArbZoom.instance.engine.setZoom(4);
    fileContent1.dom.window.dispatchEvent(new MockEvent('pagehide'));
    await flushTimers(30);
    assert.equal(net.storageData.arbZoomSiteZooms['file:///tmp/doc-one.html'], 4);
    assert.equal(net.storageData.arbZoomSiteZooms['null'], undefined);

    const fileTab2 = net.addTab({ url: 'file:///tmp/doc-two.html', active: true });
    const fileContent2 = net.bootContent(fileTab2);
    await flushTimers(40);
    assert.equal(fileContent2.context.ArbZoom.instance.engine.totalScale, 1);

    // Reset clears the saved origin entry
    contentReload.context.ArbZoom.instance.engine.resetZoom();
    contentReload.dom.window.dispatchEvent(new MockEvent('pagehide'));
    await flushTimers(30);
    assert.equal(net.storageData.arbZoomSiteZooms['https://maps.example.io'], undefined);
  });

  test(`[${browserType}] global keyboard commands control content script and fall back with user stepFactor on restricted pages`, async () => {
    const net = createExtensionNetwork({
      browserType,
      initialStorage: {
        arbZoomSettings: { stepFactor: 1.5 },
      },
    });
    net.bootBackground();
    await net.triggerInstalled();

    const normalTab = net.addTab({ url: 'https://wiki.example.org/entry', active: true });
    const content = net.bootContent(normalTab);
    await flushTimers(20);

    await net.triggerCommand('zoom-in');
    assert.equal(content.context.ArbZoom.instance.engine.totalScale, 1.5);

    await net.triggerCommand('toggle-pan');
    assert.equal(content.context.ArbZoom.instance.engine.panMode, true);

    await net.triggerCommand('zoom-reset');
    assert.equal(content.context.ArbZoom.instance.engine.totalScale, 1);

    // Restricted browser page uses user's 1.5 stepFactor in fallback
    const restrictedUrl = browserType === 'firefox' ? 'about:debugging' : 'chrome://extensions';
    const restrictedTab = net.addTab({ url: restrictedUrl, active: true, restricted: true });

    await net.triggerCommand('zoom-in');
    assert.equal(restrictedTab.nativeZoom, 1.5);
    assert.equal(restrictedTab.badge.text, '150%');
    assert.equal(restrictedTab.badge.bgColor, '#0284c7');

    await net.triggerCommand('zoom-reset');
    assert.equal(restrictedTab.nativeZoom, 1);
    assert.equal(restrictedTab.badge.text, '');

    // Opening popup on restricted tab marks controls inert & disabled, yet still updates mode breakdown & settings
    const popup = net.bootPopup();
    await flushTimers(20);
    assert.equal(popup.dom.document.getElementById('restrictedBanner').hidden, false);
    assert.equal(popup.dom.document.getElementById('zoomControls').inert, true);
    assert.equal(popup.dom.document.getElementById('btnZoomIn').disabled, true);
    assert.equal(popup.dom.document.getElementById('btnReset').disabled, true);

    popup.dom.document.getElementById('modeHybrid').click();
    await flushTimers(20);
    assert.equal(net.storageData.arbZoomSettings.mode, 'hybrid');
    assert.match(popup.dom.document.getElementById('zoomBreakdown').textContent, /^Hybrid:/);
  });

  test(`[${browserType}] settings updates sync live across open tabs and open popups via storage.onChanged`, async () => {
    const net = createExtensionNetwork({ browserType });
    net.bootBackground();
    await net.triggerInstalled();

    const tabA = net.addTab({ url: 'https://site-a.test', active: false });
    const contentA = net.bootContent(tabA);
    const tabB = net.addTab({ url: 'https://site-b.test', active: true });
    const contentB = net.bootContent(tabB);
    await flushTimers(20);

    // Zoom both tabs so pixelated stylesheet & HUD are observable
    contentA.context.ArbZoom.instance.engine.setZoom(4);
    contentB.context.ArbZoom.instance.engine.setZoom(4);
    assert.equal(contentA.context.ArbZoom.instance.hud.els.dock.classList.contains('visible'), true);

    const popup = net.bootPopup();
    await flushTimers(20);
    popup.dom.document.getElementById('toggleHud').click();
    popup.dom.document.getElementById('togglePixelated').click();
    await flushTimers(40);

    assert.equal(contentA.context.ArbZoom.instance.hud.els.dock.classList.contains('visible'), false);
    assert.equal(contentA.context.ArbZoom.instance.engine.settings.pixelated, true);
    assert.ok(contentA.dom.head.querySelector('#arb-zoom-pixelated-style'));
    assert.equal(contentB.context.ArbZoom.instance.engine.settings.pixelated, true);
    assert.ok(contentB.dom.head.querySelector('#arb-zoom-pixelated-style'));
  });

  test(`[${browserType}] popup slider, step multiplier, zoom-out badge, and upgrade defaults preservation`, async () => {
    const net = createExtensionNetwork({
      browserType,
      initialStorage: {
        arbZoomSettings: { mode: 'optical', showHud: false },
        arbZoomSiteZooms: { 'https://ignored.test': 8 },
      },
    });
    net.bootBackground();
    await net.triggerInstalled();

    assert.equal(net.storageData.arbZoomSettings.showHud, false);
    assert.equal(net.storageData.arbZoomSettings.stepFactor, 1.25);

    const tab = net.addTab({ url: 'https://ignored.test/home', active: true });
    const content = net.bootContent(tab);
    await flushTimers(30);
    assert.equal(content.context.ArbZoom.instance.engine.totalScale, 8);

    const popup = net.bootPopup();
    await flushTimers(20);

    popup.dom.document.getElementById('toggleRemember').click();
    await flushTimers(30);
    assert.equal(net.storageData.arbZoomSettings.rememberPerSite, false);

    const tabReloaded = net.addTab({ url: 'https://ignored.test/home', active: true });
    const contentReloaded = net.bootContent(tabReloaded);
    await flushTimers(30);
    assert.equal(contentReloaded.context.ArbZoom.instance.engine.totalScale, 1);

    const popup2 = net.bootPopup();
    await flushTimers(20);
    const slider = popup2.dom.document.getElementById('zoomSlider');
    slider.value = '1000';
    slider.dispatchEvent(new MockEvent('input', { target: slider }));
    await flushTimers(90);
    assert.equal(contentReloaded.context.ArbZoom.instance.engine.totalScale, 100);
    assert.equal(tabReloaded.badge.text, '10k');
    assert.equal(tabReloaded.badge.bgColor, '#7c3aed');

    const stepSelect = popup2.dom.document.getElementById('selectStepFactor');
    stepSelect.value = '2';
    stepSelect.dispatchEvent(new MockEvent('change', { target: stepSelect }));
    await flushTimers(30);

    popup2.dom.document.getElementById('btnZoomIn').click();
    await flushTimers(90);
    assert.equal(contentReloaded.context.ArbZoom.instance.engine.totalScale, 200);
    assert.equal(tabReloaded.badge.text, '20k');

    // Out-of-range slider indicator active at 20,000%; clicking thumb without moving does not drop zoom
    assert.equal(slider.classList.contains('out-of-range'), true);
    slider.dispatchEvent(new MockEvent('change', { target: slider }));
    await flushTimers(30);
    assert.equal(contentReloaded.context.ArbZoom.instance.engine.totalScale, 200);

    // Zoom out below 100% (50%) -> sky-blue badge "#0284c7"
    popup2.dom.document.querySelector('[data-scale="0.5"]').click();
    await flushTimers(90);
    assert.equal(contentReloaded.context.ArbZoom.instance.engine.totalScale, 0.5);
    assert.equal(tabReloaded.badge.text, '50%');
    assert.equal(tabReloaded.badge.bgColor, '#0284c7');
  });
}
