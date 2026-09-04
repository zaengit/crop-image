# Crop Image

Upload one image and automatically generate smart-cropped social media formats. Processing is fully client-side.

## Features

- Upload once and generate every configured social-media size automatically.
- ONNX Runtime Web using the **WASM execution provider only**; no WebGPU dependency.
- UltraFace face detection plus Rust saliency fallback.
- Multi-face framing, face padding, and vertical safe areas for Story/Reels/TikTok.
- Manual focal-point override with live regeneration of every preset.
- JPEG, WebP, and PNG output.
- Adjustable JPEG/WebP quality.
- Individual downloads plus one local ZIP containing all generated files and a manifest.
- Large-image protection: the working image is bounded to 12 MP / 4096 px while the original remains available for preview.
- Worker-side request coalescing so rapid focal-point changes do not create a long processing queue.
- No backend and no source image upload.

## Architecture

- **ONNX Runtime Web / WASM**: lightweight face inference in-browser.
- **Rust → WebAssembly**: saliency fallback, focal-region handling, crop calculation, Lanczos resize, and internal PNG encode.
- **Web Worker + OffscreenCanvas**: inference, Rust WASM processing, and optional JPEG/WebP conversion stay off the main UI thread.
- **fflate**: ZIP creation is performed locally in the browser.

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

`npm run model:fetch` downloads UltraFace `version-RFB-320.onnx` into `public/models/`. The model binary is intentionally not committed.

## Production build

```bash
npm run model:fetch
npm run build
```

The static output is written to `dist/` and can be served by any static host. The ONNX model and WASM files must be served from the same deployed app.

## Smart-crop strategy

1. The browser decodes the source image and bounds the working buffer for predictable memory use.
2. UltraFace detects one or more faces using ONNX Runtime Web with `executionProviders: ['wasm']`.
3. Rust combines detected faces into a group focal region with platform-specific padding.
4. If face detection fails or finds no face, Rust computes a contrast/detail saliency focal point.
5. Platform safe areas adjust the focal region for vertical UI-heavy formats.
6. A manual focal point, when supplied, takes priority over the automatic result.
7. Rust crops and resizes to the exact target dimensions.
8. The worker keeps PNG directly or converts it to JPEG/WebP at the selected quality.

## Current presets

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

GitHub Actions installs Node and Rust, downloads the model, runs the Rust unit tests, builds the Rust WASM package, and builds the Vite application on every push and pull request to `main`.
