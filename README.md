# Crop Image

Upload one main image, optionally enhance it, then manually generate smart-cropped outputs. Processing stays client-side in the browser. App Store screenshot assets keep a separate multi-image workflow.

## Main workflow

1. Upload one image.
2. Optionally adjust Global Enhance.
3. Adjust or reset the focal point if needed.
4. Choose Social media, Passport photo, or Custom.
5. Click the relevant Generate button.
6. Download individual files or the local ZIP.

Changing enhancement, focus, output format/quality, or passport background updates working state only. Existing crops are not regenerated until Generate is clicked again. In-flight work is revisioned so stale enhancement or crop results cannot overwrite newer state.

## Features

- Single active master image for Social media, Passport photo, and Custom output.
- Optional Global Enhance before crop generation.
- App Store screenshots support up to 10 source screenshots with reorder controls.
- App Store source images are decoded with browser fallback and bounded to a memory-safe working resolution.
- Main Global Enhance does not modify separately uploaded App Store screenshots or icons.
- ONNX Runtime Web using the **WASM execution provider only**; no WebGPU dependency.
- UltraFace face detection plus Rust saliency fallback.
- Multi-face crop containment: when geometry permits, all detected faces plus padding are kept inside the crop.
- Manual focal-point override without automatic crop regeneration.
- JPEG, WebP, and PNG output.
- Adjustable JPEG/WebP quality.
- Passport background replacement with original or solid-color backgrounds.
- Individual downloads plus incremental local ZIP export.
- Large-image protection: the main and App Store working images are bounded to 12 MP / 4096 px.
- Optional local AI restoration, face enhancement, and 2× super resolution for the main image.
- MediaPipe runtime files and AI model binaries are served with the app; source images are never uploaded.
- No backend.

## Architecture

- **ONNX Runtime Web / WASM**: face inference and Real-ESRGAN inference in-browser.
- **Rust → WebAssembly**: saliency fallback, multi-face crop containment, focal-region handling, crop calculation, Lanczos resize, and internal PNG encode.
- **Web Worker + OffscreenCanvas**: main crop inference, enhancement, Rust WASM processing, and JPEG/WebP conversion run off the main UI thread.
- **MediaPipe ImageSegmenter**: local person segmentation for passport background replacement. Its WASM runtime is copied from the pinned npm package into the deployed static assets.
- **fflate**: ZIP creation is performed incrementally in the browser to avoid retaining duplicate raw buffers for large batches.
- **Explicit crop-worker channel**: enhancement UI connects only to the active crop worker; global Worker prototype interception is not used.
- **Revision-based concurrency**: upload, enhancement, background composition, and crop generation use latest-wins semantics so stale work is discarded.

## Setup

Requirements: Node.js 20+, Rust, and `wasm-pack`.

```bash
npm ci
npm run model:fetch
npm run wasm:build
npm run dev
```

Or:

```bash
npm ci
npm run setup
npm run dev
```

`npm run model:fetch` downloads and SHA-256 verifies the required local AI model files in `public/models/`. Model binaries are intentionally not committed. `npm run dev` and `npm run build:web` copy the pinned MediaPipe WASM runtime from `node_modules` into `public/mediapipe-wasm` before serving/building.

## Production build

```bash
npm ci
npm run model:fetch
npm run build
```

The static output is written to `dist/` and can be served by any static host. Model, MediaPipe runtime, and Rust WASM files must be served with the deployed app.

## Smart-crop strategy

1. The browser decodes the main source image and bounds the working buffer for predictable memory use.
2. UltraFace detects one or more faces using ONNX Runtime Web with the WASM execution provider.
3. Rust builds a padded group bounds for detected faces and attempts to keep that group inside the target crop.
4. If the complete face group cannot geometrically fit, the crop falls back to the best bounded group focus.
5. If face detection fails or finds no face, Rust computes a contrast/detail saliency focal point.
6. Platform safe areas adjust vertical focus for UI-heavy formats.
7. A manual focal point, when supplied, takes priority over automatic face/saliency focus.
8. Nothing is cropped until the user clicks Generate.
9. Rust crops and resizes to the exact target dimensions.
10. The worker keeps PNG directly or converts it to JPEG/WebP at the selected quality.

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

## Reproducible builds

JavaScript and Rust dependency lockfiles are committed. CI and Pages use `npm ci`; Rust tests run with `--locked`. Direct dependency versions are pinned in `package.json`.

## CI and deployment

Pull requests run:

- dependency installation from lockfiles
- AI model download + SHA-256 verification
- Rust tests
- Rust WASM build
- TypeScript checks
- Vite production build
- a Chromium production smoke test that uploads an image, verifies focus changes do not generate outputs, and verifies explicit Generate produces a crop

GitHub Pages deployment is triggered only after the `CI` workflow completes successfully on `main`, preventing a runtime-failing build from being deployed automatically.
