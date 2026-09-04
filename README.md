# Crop Image

Upload one image and automatically generate smart-cropped social media formats. Processing is fully client-side.

## Architecture

- **ONNX Runtime Web (WASM execution provider only)**: UltraFace face detection in-browser.
- **Rust → WebAssembly**: focal-point fallback, crop calculation, Lanczos resize, PNG encode.
- **Web Worker**: inference and image generation stay off the main UI thread.
- **No backend / no image upload**: source pixels stay on the user's device.

## Setup

Requirements: Node.js 20+, Rust, `wasm-pack`.

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

`npm run model:fetch` downloads the lightweight UltraFace `version-RFB-320.onnx` model into `public/models/`. The model is intentionally not committed as a binary.

## Smart-crop strategy

1. UltraFace detects one or more faces using ONNX Runtime Web with `executionProviders: ['wasm']`.
2. Detected faces are converted into normalized focus regions.
3. Rust combines the important regions into a focal point and calculates a safe crop for every target aspect ratio.
4. If face inference fails or there is no face, Rust computes a contrast/detail saliency focal point and falls back gracefully.
5. The crop is resized to the exact social-media output dimensions and encoded as PNG.

## Current presets

Instagram square / portrait / story, TikTok video, YouTube thumbnail, X landscape, Facebook landscape, and LinkedIn landscape / square.

## Notes

The social networks can change recommended dimensions over time. Presets live in `src/presets.ts`, so they can be updated without changing the Rust crop engine.
