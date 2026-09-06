import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

function useOnnxBackgroundSegmenter(): Plugin {
  return {
    name: 'use-onnx-background-segmenter',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/worker.ts') && !id.endsWith('\\src\\worker.ts')) return null
      let next = code
      next = next.replace('models/selfie_segmenter.tflite', 'models/modnet_photographic_portrait_matting.onnx')
      next = next.replace('const result = segmenter.segment(canvas)', 'const result = await segmenter.segment(canvas)')
      return next === code ? null : next
    },
  }
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/crop-image/' : '/',
  resolve: {
    alias: {
      '@mediapipe/tasks-vision': fileURLToPath(new URL('./src/onnx-image-segmenter.ts', import.meta.url)),
    },
  },
  plugins: [tailwindcss(), useOnnxBackgroundSegmenter()],
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
    plugins: () => [useOnnxBackgroundSegmenter()],
  },
}))
