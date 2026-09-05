# Crop Image

Upload one main image, optionally enhance it, then manually generate smart-cropped outputs. Processing stays client-side in the browser. App Store screenshot assets keep a separate multi-image workflow.

## Main workflow

1. Upload one image.
2. Optionally adjust Global Enhance.
3. Adjust or reset the focal point if needed.
4. Choose Social media, Passport photo, or Custom.
5. Click the relevant Generate button.
6. Download individual files or the local ZIP.

Changing enhancement, focus, output format/quality, or passport background updates the working state only. Existing crops are not regenerated until Generate is clicked again.

## Features

- Single active master image for Social media, Passport photo, and Custom output.
- Optional Global Enhance before crop generation.
- App Store screenshots support up to 10 source screenshots with reorder controls.
- ONNX Runtime Web using the **WASM execution provider only**; no WebGPU dependency.
- UltraFace face detection plus Rust saliency fallback.
- Multi-face framing, face padding, and vertical safe areas for Story/Reels/TikTok.
- Manual focal-point override without automatic crop regeneration.
- JPEG, WebP, and PNG output.
- Adjustable JPEG/WebP quality.
- Passport background replacement with original or solid-color backgrounds.
- Individual downloads plus local ZIP export.
- Large-image protection: the main working image is bounded to 12 MP / 4096 px.
- Optional local AI restoration, face enhancement, and 2× super resolution.
- No backend and no source image upload.

## Architecture

- **ONNX Runtime Web / WASM**: face inference and Real-ESRGAN inference in-browser.
- **Rust → WebAssembly**: saliency fallback, focal-region handling, crop calculation, Lanczos resize, and internal PNG encode.
- **Web Worker + OffscreenCanvas**: main crop inference, enhancement, Rust WASM processing, and JPEG/WebP conversion run off the main UI thread.
- **MediaPipe ImageSegmenter**: local person segmentation for passport background replacement.
- **fflate**: ZIP creation is performed locally in the browser.
- **Explicit crop-worker channel**: enhancement UI connects only to the active crop worker; global Worker prototype interception is not used.

## Setup

Requirements: Node.js 20+, Rust, and `wasm-pack`.

```bash
npm install
npm run model:fetch
npm run wasm:build
npm run dev
```

Or:

```bash
npm install
npm run setup
npm run dev
```

`npm run model:fetch` downloads and SHA-256 verifies the required local AI model files in `public/models/`. Model binaries are intentionally not committed.

## Production build

```bash
npm run model:fetch
npm run build
```

The static output is written to `dist/` and can be served by any static host. The model and WASM files must be served with the deployed app.

## Smart-crop strategy

1. The browser decodes the main source image and bounds the working buffer for predictable memory use.
2. UltraFace detects one or more faces using ONNX Runtime Web with the WASM execution provider.
3. Rust combines detected faces into a group focal region with platform-specific padding.
4. If face detection fails or finds no face, Rust computes a contrast/detail saliency focal point.
5. Platform safe areas adjust the focal region for vertical UI-heavy formats.
6. A manual focal point, when supplied, takes priority over the automatic result.
7. Nothing is cropped until the user clicks Generate.
8. Rust crops and resizes to the exact target dimensions.
9. The worker keeps PNG directly or converts it to JPEG/WebP at the selected quality.

## Current social presets

- Instagram Square Post — 1080×1080
- Instagram Portrait Post — 1080×1350
- Instagram Story / Reel — 1080×1920
- TikTok Video — 1080×1920
- YouTube Thumbnail — 1280×720
- X Landscape Post — 1600×900
- Facebook Landscape Post — 1200×630
- LinkedIn Landscape Post — 1200×627
- LinkedIn Square Post — 1200×1200

Presets live in `src/presets.ts`, so dimensions and safe-area metadata can be updated without changing the core crop engine.

## CI

GitHub Actions installs Node and Rust, downloads and verifies AI models, runs Rust tests, builds the Rust WASM package, runs TypeScript checks, and builds the Vite application on every push and pull request to `main`.
