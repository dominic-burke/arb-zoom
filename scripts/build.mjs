#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const COPY_DIRS = ['shared', 'background', 'content', 'popup', 'icons'];
const ICON_SIZES = [16, 32, 48, 128];
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      out[k] &&
      typeof out[k] === 'object' &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORED_NAMES.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function ensureIcons() {
  const missing = ICON_SIZES.some((size) => !fs.existsSync(path.join(SRC, 'icons', `icon-${size}.png`)));
  if (missing) {
    execFileSync(process.execPath, [path.join(__dirname, 'generate-icons.mjs')], {
      stdio: 'inherit',
    });
  }
}

function buildTarget(browserName, manifestOverrideFile) {
  const outDir = path.join(DIST, browserName);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const dir of COPY_DIRS) {
    copyDir(path.join(SRC, dir), path.join(outDir, dir));
  }

  const baseManifest = readJson(path.join(SRC, 'manifest.base.json'));
  const overrideManifest = readJson(path.join(SRC, manifestOverrideFile));
  const merged = deepMerge(baseManifest, overrideManifest);

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(merged, null, 2) + '\n');
  console.log(`Built dist/${browserName}/`);
  return outDir;
}

function packageArchive(sourceDir, archiveName) {
  const outPath = path.join(DIST, archiveName);
  fs.rmSync(outPath, { force: true });
  try {
    execFileSync('zip', ['-rq', outPath, '.'], { cwd: sourceDir });
    console.log(`Packaged dist/${archiveName}`);
  } catch (err) {
    if (process.env.ARB_ZOOM_SKIP_ZIP === '1') {
      console.warn(`Skipping archive ${archiveName}: ${err.message}`);
      return;
    }
    throw new Error(`Failed to package ${archiveName}: ${err.message}`);
  }
}

ensureIcons();
const chromeDir = buildTarget('chrome', 'manifest.chrome.json');
const firefoxDir = buildTarget('firefox', 'manifest.firefox.json');

packageArchive(chromeDir, 'arb-zoom-chrome.zip');
packageArchive(firefoxDir, 'arb-zoom-firefox.xpi');
