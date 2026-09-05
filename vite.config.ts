import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/crop-image/' : '/',
  plugins: [tailwindcss()],
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
}))
