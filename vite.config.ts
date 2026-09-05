import { defineConfig } from 'vite'

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/crop-image/' : '/',
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
}))
