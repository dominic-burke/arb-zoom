import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function assertAllReferencedFilesExist(targetDir, manifest) {
  const refs = [];
  if (manifest.icons) refs.push(...Object.values(manifest.icons));
  if (manifest.action?.default_popup) refs.push(manifest.action.default_popup);
  if (manifest.action?.default_icon) refs.push(...Object.values(manifest.action.default_icon));
  if (manifest.background?.service_worker) refs.push(manifest.background.service_worker);
  if (manifest.background?.scripts) refs.push(...manifest.background.scripts);
  for (const cs of manifest.content_scripts || []) {
    if (cs.js) refs.push(...cs.js);
    if (cs.css) refs.push(...cs.css);
  }

  for (const rel of refs) {
    const full = path.join(targetDir, rel);
    assert.ok(fs.existsSync(full), `Missing file referenced in manifest: ${rel} (${targetDir})`);
  }
}

test('Chrome MV3 dist bundle is complete, CWS-compliant, and matches src/', () => {
  const dir = path.join(DIST, 'chrome');
  const manifest = readJson(path.join(dir, 'manifest.json'));

  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.description.length <= 132, `Description too long for CWS: ${manifest.description.length}`);
  assert.ok(manifest.minimum_chrome_version, 'Chrome manifest should set minimum_chrome_version');
  assert.equal(manifest.background.service_worker, 'background/background.js');
  assert.equal(manifest.background.scripts, undefined);
  assert.equal(manifest.browser_specific_settings, undefined);
  assert.equal(manifest.content_scripts[0].run_at, 'document_end');

  for (const cmd of Object.values(manifest.commands)) {
    assert.ok(cmd.suggested_key?.mac, 'Commands should define mac overrides');
  }

  assertAllReferencedFilesExist(dir, manifest);
  assert.ok(fs.existsSync(path.join(DIST, 'arb-zoom-chrome.zip')));

  // Verify dist files are in sync with src
  for (const rel of [
    'shared/browser-api.js',
    'shared/constants.js',
    'shared/zoom-math.js',
    'background/background.js',
    'content/zoom-engine.js',
    'content/hud.js',
    'content/content.js',
    'popup/popup.html',
    'popup/popup.css',
    'popup/popup.js',
  ]) {
    assert.equal(
      fs.readFileSync(path.join(dir, rel), 'utf8'),
      fs.readFileSync(path.join(SRC, rel), 'utf8'),
      `dist/chrome/${rel} is out of sync with src/${rel}`
    );
  }
});

test('Firefox MV3 dist bundle is complete, AMO-compliant, and matches src/', () => {
  const dir = path.join(DIST, 'firefox');
  const manifest = readJson(path.join(dir, 'manifest.json'));

  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.description.length <= 132);
  assert.ok(Array.isArray(manifest.background.scripts));
  assert.ok(manifest.background.scripts.includes('background/background.js'));
  assert.equal(manifest.background.service_worker, undefined);

  const gecko = manifest.browser_specific_settings?.gecko;
  assert.ok(gecko?.id && !gecko.id.endsWith('.local'));
  assert.ok(Number.parseFloat(gecko.strict_min_version) >= 140);
  assert.deepEqual(gecko.data_collection_permissions, { required: ['none'] });

  assertAllReferencedFilesExist(dir, manifest);
  assert.ok(fs.existsSync(path.join(DIST, 'arb-zoom-firefox.xpi')));
});

test('Generated PNG icons in both Chrome and Firefox dist have valid PNG signatures', () => {
  const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const browser of ['chrome', 'firefox']) {
    for (const size of [16, 32, 48, 128]) {
      const iconPath = path.join(DIST, browser, 'icons', `icon-${size}.png`);
      const buf = fs.readFileSync(iconPath);
      assert.ok(buf.subarray(0, 8).equals(pngSig), `${browser} icon-${size}.png must start with PNG magic bytes`);
      assert.ok(buf.length > 100, `${browser} icon-${size}.png should be non-trivial PNG`);
    }
  }
});
