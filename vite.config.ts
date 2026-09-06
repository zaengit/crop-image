import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

function fixMediaPipeWorkerModuleLoader(): Plugin {
  return {
    name: 'fix-mediapipe-worker-module-loader',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/worker.ts') && !id.endsWith('\\src\\worker.ts')) return null
      if (!code.includes('resolveVision(wasmPath, true)')) return null
      return code.replace('resolveVision(wasmPath, true)', 'resolveVision(wasmPath)')
    },
  }
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/crop-image/' : '/',
  plugins: [tailwindcss(), fixMediaPipeWorkerModuleLoader()],
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
    plugins: () => [fixMediaPipeWorkerModuleLoader()],
  },
}))
