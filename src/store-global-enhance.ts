import { aiEnhanceFaces } from './ai-face-enhance'
import { aiRestoreImage } from './ai-restore'
import { aiUpscale2x } from './ai-upscale'
import { detectFaces } from './ai'
import { DEFAULT_ENHANCEMENT, enhanceRgba, type EnhancementSettings } from './enhance'

const NativeCreateImageBitmap = window.createImageBitmap.bind(window)
const storeFiles = new WeakSet<File>()
const callCounts = new WeakMap<File, number>()
const enhancedBlobs = new WeakMap<File, { key: string; blob: Promise<Blob> }>()

function isStoreInput(target: EventTarget | null) {
  return target instanceof HTMLInputElement && (target.id === 'store-screenshot-input' || target.id === 'store-icon-input')
}

document.addEventListener('change', (event) => {
  if (!isStoreInput(event.target)) return
  const input = event.target as HTMLInputElement
  for (const file of input.files ?? []) storeFiles.add(file)
}, true)

document.addEventListener('drop', (event) => {
  const target = event.target instanceof Element ? event.target.closest('#store-screenshot-drop, #store-icon-drop') : null
  if (!target) return
  for (const file of event.dataTransfer?.files ?? []) {
    if (file.type.startsWith('image/')) storeFiles.add(file)
  }
}, true)

function settingsFromUi(): EnhancementSettings {
  const settings: EnhancementSettings = { ...DEFAULT_ENHANCEMENT }
  const root = document.querySelector('#enhance-global')
  if (!root) return settings

  root.querySelectorAll<HTMLInputElement>('[data-enhance-range]').forEach((input) => {
    const key = input.dataset.enhanceRange as keyof EnhancementSettings
    ;(settings as unknown as Record<string, number>)[key] = Number(input.value)
  })
  root.querySelectorAll<HTMLButtonElement>('[data-enhance-toggle]').forEach((button) => {
    const key = button.dataset.enhanceToggle as keyof EnhancementSettings
    ;(settings as unknown as Record<string, boolean>)[key] = button.getAttribute('aria-pressed') === 'true'
  })
  return settings
}

function settingsKey(settings: EnhancementSettings) {
  return JSON.stringify(settings)
}

function hasEnhancement(settings: EnhancementSettings) {
  return settings.brightness !== 0 || settings.contrast !== 0 || settings.highlights !== 0 || settings.shadows !== 0 ||
    settings.saturation !== 0 || settings.temperature !== 0 || settings.sharpness !== 0 || settings.denoise !== 0 ||
    settings.lowLight || settings.faceEnhance || settings.deblur || settings.restorePhoto || settings.upscale2x
}

async function rgbaFromBitmap(bitmap: ImageBitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Unable to create Store enhancement canvas')
  ctx.drawImage(bitmap, 0, 0)
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
}

async function blobFromRgba(rgba: Uint8ClampedArray, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Unable to create Store output canvas')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

async function enhanceStoreFile(file: File, settings: EnhancementSettings) {
  if (!hasEnhancement(settings)) return file

  const bitmap = await NativeCreateImageBitmap(file)
  try {
    let width = bitmap.width
    let height = bitmap.height
    const source = await rgbaFromBitmap(bitmap)
    let faces = [] as Awaited<ReturnType<typeof detectFaces>>
    if (settings.faceEnhance) {
      try { faces = await detectFaces(source, width, height) }
      catch (error) { console.warn('Store face detection unavailable.', error) }
    }

    const useAiRestore = settings.denoise >= 20 || settings.deblur || settings.restorePhoto
    const localSettings = useAiRestore ? { ...settings, denoise: 0, deblur: false } : settings
    let rgba = enhanceRgba(source, width, height, localSettings, faces)

    if (useAiRestore) {
      try {
        const strength = Math.min(0.9, 0.42 + Math.min(0.25, settings.denoise / 250) + (settings.deblur ? 0.14 : 0) + (settings.restorePhoto ? 0.08 : 0))
        rgba = (await aiRestoreImage(rgba, width, height, strength)).rgba
      } catch (error) {
        console.warn('Store AI restoration unavailable; using local fallback.', error)
        rgba = enhanceRgba(source, width, height, settings, faces)
      }
    }

    if (settings.faceEnhance && faces.length) {
      try { rgba = (await aiEnhanceFaces(rgba, width, height, faces)).rgba }
      catch (error) { console.warn('Store AI face enhancement unavailable; using local fallback.', error) }
    }

    if (settings.upscale2x && width * height <= 6_000_000 && Math.max(width, height) <= 4096) {
      try {
        const upscaled = await aiUpscale2x(rgba, width, height)
        rgba = upscaled.rgba
        width = upscaled.width
        height = upscaled.height
      } catch (error) {
        console.warn('Store AI upscale unavailable; keeping enhanced native resolution.', error)
      }
    }

    return await blobFromRgba(rgba, width, height)
  } finally {
    bitmap.close()
  }
}

window.createImageBitmap = (async (source: ImageBitmapSource, ...options: unknown[]) => {
  if (!(source instanceof File) || !storeFiles.has(source)) {
    return NativeCreateImageBitmap(source, ...(options as []))
  }

  const count = (callCounts.get(source) ?? 0) + 1
  callCounts.set(source, count)
  // The Store module's first decode only reads source dimensions. Enhance from the
  // second decode onward, when the bitmap is actually used to generate outputs.
  if (count === 1) return NativeCreateImageBitmap(source, ...(options as []))

  const settings = settingsFromUi()
  const key = settingsKey(settings)
  let cached = enhancedBlobs.get(source)
  if (!cached || cached.key !== key) {
    cached = { key, blob: enhanceStoreFile(source, settings) }
    enhancedBlobs.set(source, cached)
  }
  return NativeCreateImageBitmap(await cached.blob)
}) as typeof window.createImageBitmap
