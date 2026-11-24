import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Load constants first so zoom-math picks them up from globalThis.ArbZoom
require('../src/shared/constants.js');
const ZMath = require('../src/shared/zoom-math.js');

test('clampScale allows arbitrary zoom from 1% to 1,000,000%', () => {
  assert.equal(ZMath.clampScale(1), 1);
  assert.equal(ZMath.clampScale(25), 25); // 2,500%
  assert.equal(ZMath.clampScale(500), 500); // 50,000%
  assert.equal(ZMath.clampScale(10000), 10000); // 1,000,000%
  assert.equal(ZMath.clampScale(999999), 10000);
  assert.equal(ZMath.clampScale(0.0001), 0.01);
  assert.equal(ZMath.clampScale(-5), 1);
  assert.equal(ZMath.clampScale(Number.NaN), 1);
});

test('applyMagneticSnap snaps when crossing/approaching 100% without trapping fine zoom away from 100%', () => {
  // Crossing or approaching 1.0 snaps cleanly to 1.0
  assert.equal(ZMath.applyMagneticSnap(0.97, 1.2, true), 1);
  assert.equal(ZMath.applyMagneticSnap(1.03, 0.8, true), 1);
  assert.equal(ZMath.applyMagneticSnap(1.02, 1.2, true), 1);
  assert.equal(ZMath.applyMagneticSnap(0.98, 0.85, true), 1);

  // Fine trackpad pinch moving AWAY from 1.0 must NOT snap back to 1.0
  let s = 1;
  for (let i = 0; i < 6; i++) {
    const next = ZMath.applyMagneticSnap(s * 1.019, s, true);
    assert.ok(next > s, `Expected fine pinch frame ${i} to increase: ${s} -> ${next}`);
    s = next;
  }
  assert.ok(s > 1.1);

  // Fine pinch zooming OUT away from 1.0 must also never oscillate back to 1.0
  let out = 1;
  for (let i = 0; i < 6; i++) {
    const next = ZMath.applyMagneticSnap(out * 0.981, out, true);
    assert.ok(next < out, `Expected fine pinch-out frame ${i} to decrease: ${out} -> ${next}`);
    out = next;
  }
  assert.ok(out < 0.9);

  // Disabled snap preserves exact value
  assert.equal(ZMath.applyMagneticSnap(1.02, 1.2, false), 1.02);
});

test('splitHybridZoom cleanly separates native zoom (up to 500%) and optical zoom past 500%', () => {
  assert.deepEqual(ZMath.splitHybridZoom(25, 'optical'), { nativeZoom: 1, cssScale: 25 });
  assert.deepEqual(ZMath.splitHybridZoom(2.5, 'hybrid'), { nativeZoom: 2.5, cssScale: 1 });
  assert.deepEqual(ZMath.splitHybridZoom(5.0, 'hybrid'), { nativeZoom: 5.0, cssScale: 1 });

  const pastCap = ZMath.splitHybridZoom(20, 'hybrid');
  assert.equal(pastCap.nativeZoom, 5);
  assert.equal(pastCap.cssScale, 4);
  assert.equal(pastCap.nativeZoom * pastCap.cssScale, 20);

  const low = ZMath.splitHybridZoom(0.25, 'hybrid');
  assert.equal(low.nativeZoom, 0.5);
  assert.equal(low.cssScale, 0.5);
});

test('zoomAroundPoint preserves the exact document point under the focal coordinate', () => {
  const originX = 8;
  const originY = 8;
  const cam1 = { cssScale: 2, tx: -120, ty: -340 };
  const focalX = 400;
  const focalY = 250;

  const docXBefore = (focalX - originX - cam1.tx) / cam1.cssScale;
  const docYBefore = (focalY - originY - cam1.ty) / cam1.cssScale;

  const cam2 = ZMath.zoomAroundPoint(cam1, 25, focalX, focalY, originX, originY);

  const docXAfter = (focalX - originX - cam2.tx) / cam2.cssScale;
  const docYAfter = (focalY - originY - cam2.ty) / cam2.cssScale;

  assert.ok(Math.abs(docXBefore - docXAfter) < 1e-9);
  assert.ok(Math.abs(docYBefore - docYAfter) < 1e-9);
});

test('clampPan keeps zoomed document inside reachable bounds and centers zoomed-out document', () => {
  const tooLeft = ZMath.clampPan({ cssScale: 10, tx: 500, ty: 200 }, 1000, 800, 1000, 2000, 0, 0);
  assert.equal(tooLeft.tx, 0);
  assert.equal(tooLeft.ty, 0);

  const tooRight = ZMath.clampPan(
    { cssScale: 10, tx: -50000, ty: -50000 },
    1000,
    800,
    1000,
    2000,
    0,
    0
  );
  assert.equal(tooRight.tx, 1000 - 10000);
  assert.equal(tooRight.ty, 800 - 20000);

  const zoomedOut = ZMath.clampPan({ cssScale: 0.5, tx: -100, ty: -100 }, 1000, 800, 1000, 800, 0, 0);
  assert.equal(zoomedOut.tx, 250);
  assert.equal(zoomedOut.ty, 200);
});

test('minimap rect and panToNormalizedPoint round-trip accurately', () => {
  const vw = 1000;
  const vh = 800;
  const docW = 2000;
  const docH = 4000;
  const cam = ZMath.panToNormalizedPoint({ cssScale: 10, tx: 0, ty: 0 }, 0.5, 0.5, vw, vh, docW, docH, 0, 0);
  const rect = ZMath.computeMinimapRect(cam, vw, vh, docW, docH, 0, 0);

  assert.ok(Math.abs(rect.x + rect.w / 2 - 0.5) < 1e-6);
  assert.ok(Math.abs(rect.y + rect.h / 2 - 0.5) < 1e-6);
});

test('logarithmic slider maps 10%..10,000% monotonically across all 0..1000 steps without keyboard deadlocks', () => {
  assert.equal(ZMath.scaleToSlider(0.1), 0);
  assert.equal(ZMath.scaleToSlider(1), 333);
  assert.equal(ZMath.scaleToSlider(100), 1000);

  assert.equal(ZMath.sliderToScale(0), 0.1);
  assert.equal(ZMath.sliderToScale(333), 1);
  assert.equal(ZMath.sliderToScale(1000), 100);

  // Every adjacent step must round-trip without snapping backward (zero keyboard deadlocks)
  let prevScale = 0;
  for (let v = 0; v <= 1000; v++) {
    const sc = ZMath.sliderToScale(v);
    assert.ok(sc > prevScale, `Slider not strictly increasing at step ${v}: ${prevScale} -> ${sc}`);
    const back = ZMath.scaleToSlider(sc);
    assert.ok(Math.abs(back - v) <= 1, `Slider drift at step ${v}: scale=${sc}, back=${back}`);
    prevScale = sc;
  }
});

test('parseZoomInput supports percentages, commas, multipliers (x/×), leading dots, and rejects malformed strings', () => {
  assert.equal(ZMath.parseZoomInput('100'), 1);
  assert.equal(ZMath.parseZoomInput('2,500%'), 25);
  assert.equal(ZMath.parseZoomInput('50x'), 50);
  assert.equal(ZMath.parseZoomInput('5×'), 5);
  assert.equal(ZMath.parseZoomInput('2.5x'), 2.5);
  assert.equal(ZMath.parseZoomInput('.5x'), 0.5);
  assert.equal(ZMath.parseZoomInput('.5k'), 5);
  assert.equal(ZMath.parseZoomInput('.5%'), 0.01); // clamped to MIN_SCALE 0.01 (1%)
  assert.equal(ZMath.parseZoomInput('10k%'), 100);
  assert.equal(ZMath.parseZoomInput('5k'), 50);
  assert.equal(ZMath.parseZoomInput('12.5%'), 0.125);

  // Invalid / malformed strings must return null
  assert.equal(ZMath.parseZoomInput('0'), null);
  assert.equal(ZMath.parseZoomInput('-50'), null);
  assert.equal(ZMath.parseZoomInput('abc'), null);
  assert.equal(ZMath.parseZoomInput('25abcx'), null);
  assert.equal(ZMath.parseZoomInput('10kx'), null);
  assert.equal(ZMath.parseZoomInput('50%x'), null);
});

test('formatPercent and formatBadge format normal and hyper zoom levels within <=4 chars', () => {
  assert.equal(ZMath.formatPercent(1), '100%');
  assert.equal(ZMath.formatPercent(12.5), '1,250%');
  assert.equal(ZMath.formatPercent(0.125), '12.5%');

  assert.equal(ZMath.formatBadge(1), '');
  assert.equal(ZMath.formatBadge(2.5), '250%');
  assert.equal(ZMath.formatBadge(12.5), '1.3k');
  assert.equal(ZMath.formatBadge(50), '5k');
  assert.equal(ZMath.formatBadge(250), '25k');
  assert.equal(ZMath.formatBadge(9995), '1M');
  assert.equal(ZMath.formatBadge(9999), '1M');
  assert.equal(ZMath.formatBadge(10000), '1M');

  for (const s of [0.01, 0.25, 0.99, 1.05, 5, 9.99, 99.9, 999.9, 9995, 9999, 10000]) {
    const b = ZMath.formatBadge(s);
    assert.ok(b.length <= 4, `Badge "${b}" for scale ${s} exceeds 4 chars`);
  }
});
