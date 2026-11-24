# ArbZoom — Arbitrary Webpage Zoom (Chrome & Firefox)

Break past the ~500% browser zoom ceiling. **ArbZoom** is a cross-browser Manifest V3 extension for **Google Chrome** (and Chromium browsers) and **Mozilla Firefox** that lets you zoom any webpage arbitrarily — from **1% up to 1,000,000%** — with smooth cursor-centered zooming, drag-to-pan, an unscaled Shadow DOM HUD, and a live interactive viewport minimap.

## Features

- **Uncapped Arbitrary Zoom (1% – 1,000,000%)**: Type any percentage or multiplier (`2500`, `2500%`, `50x`, `10k`) directly into the popup or on-page HUD, or scrub the logarithmic slider (`10%` – `10,000%`).
- **Two Zoom Mechanisms**:
  - **Optical Mode (Default)**: Applies a viewport-space 2D CSS camera transform (`translate + scale`) on `<body>` with `transform-origin: 0 0`. Preserves desktop layouts (never breaks into mobile view), stays crisp on text & SVGs, works even on `overflow: hidden` web apps, and folds existing scroll offsets seamlessly with zero jump.
  - **Hybrid Mode**: Uses native browser zoom (`tabs.setZoom`) up to the browser's cap (500%) for responsive text reflow, then seamlessly stacks optical CSS zoom on top for everything beyond 500% (automatically reading back the actual browser zoom so total magnification is always exact).
- **Cursor-Centered Wheel & Trackpad Pinch Zoom**: Hold `Ctrl` (or pinch on trackpad) or `Alt` + Scroll Wheel to zoom straight into the pixel under your cursor.
- **Effortless Panning at High Zoom**:
  - Wheel / two-finger trackpad scroll pans smoothly (while respecting nested scrollable containers!).
  - Hold `Space + Drag`, `Middle-Click + Drag`, or toggle **Pan Mode (Hand Tool)** to grab and pan like a canvas.
  - Arrow keys (`Shift + Arrow` for fast pan) also pan while zoomed.
- **Unscaled Floating HUD & Interactive Minimap**:
  - Mounted in a Shadow DOM sibling of `<body>`, so the HUD stays 100% crisp and unscaled even at 10,000% zoom, and automatically hides at 100%.
  - Expand the **Navigator Minimap** to see your exact viewport box inside the page and click/drag to teleport anywhere instantaneously.
- **Crisp Pixels Mode**: Toggle `image-rendering: pixelated` for inspecting individual pixels in images, screenshots, and canvases.
- **Per-Site Memory & Live Toolbar Badge**: Optionally remembers zoom levels per origin and shows a color-coded badge on the toolbar icon (sky blue up to 500%, vivid violet past 500%).

## Build

Requires Node.js 18+ (zero external npm dependencies):

```bash
npm run build
npm test
```

This generates:
- `dist/chrome/` — unpacked Chrome MV3 extension (`dist/arb-zoom-chrome.zip`)
- `dist/firefox/` — unpacked Firefox MV3 extension (`dist/arb-zoom-firefox.xpi`)

## Installation

### Google Chrome / Edge / Brave / Chromium
1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select `dist/chrome`.

### Mozilla Firefox
1. Run `npm run build`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select `dist/firefox/manifest.json`.
   *(For persistent installation in Firefox Developer Edition / Nightly, you can pack or sign `dist/arb-zoom-firefox.xpi`.)*

## Default Controls & Shortcuts

| Action | Shortcut |
| --- | --- |
| Cursor-centered zoom | `Ctrl + Scroll` / Trackpad Pinch / `Alt + Scroll` |
| Zoom in / out (in-page) | `Alt + =` / `Alt + -` |
| Reset to 100% | `Alt + 0` |
| Global extension shortcuts | `Alt+Shift+Up`, `Alt+Shift+Down`, `Alt+Shift+0`, `Alt+Shift+H` |
| Drag to pan | `Space + Drag`, `Middle-Click + Drag`, or toggle Hand tool |
| Pan with keyboard | Arrow keys (`Shift + Arrow` for larger jumps) |

## Interactive Local Test Bench

Open `test/demo.html` in any browser to test micro-typography (down to `0.35px`), vector SVG bullseye targets, pixel-art inspection, nested scroll containers, and the Shadow DOM HUD + minimap directly.
