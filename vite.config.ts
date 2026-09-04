import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/crop-image/' : '/',
  build: {
    target: 'es2022',
  },
}))
