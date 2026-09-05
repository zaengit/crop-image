import { DEFAULT_ENHANCEMENT, type EnhancementSettings } from './enhance'

let currentSettings: EnhancementSettings = { ...DEFAULT_ENHANCEMENT }
const listeners = new Set<(settings: EnhancementSettings) => void>()

function clone(settings: EnhancementSettings): EnhancementSettings {
  return { ...settings }
}

function readControls(): EnhancementSettings | undefined {
  const root = document.querySelector('#enhance-global')
  if (!root) return undefined
  const next: EnhancementSettings = { ...DEFAULT_ENHANCEMENT }
  root.querySelectorAll<HTMLInputElement>('[data-enhance-range]').forEach((input) => {
    const key = input.dataset.enhanceRange as keyof EnhancementSettings
    ;(next as unknown as Record<string, number>)[key] = Number(input.value)
  })
  root.querySelectorAll<HTMLButtonElement>('[data-enhance-toggle]').forEach((button) => {
    const key = button.dataset.enhanceToggle as keyof EnhancementSettings
    ;(next as unknown as Record<string, boolean>)[key] = button.getAttribute('aria-pressed') === 'true'
  })
  return next
}

function syncFromControls() {
  const next = readControls()
  if (next) setEnhancementSettings(next)
}

export function getEnhancementSettings() {
  return clone(currentSettings)
}

export function setEnhancementSettings(settings: EnhancementSettings) {
  currentSettings = clone(settings)
  for (const listener of listeners) listener(clone(currentSettings))
}

export function onEnhancementSettings(listener: (settings: EnhancementSettings) => void) {
  listeners.add(listener)
  listener(clone(currentSettings))
  return () => listeners.delete(listener)
}

document.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.matches('[data-enhance-range]')) syncFromControls()
})

document.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('[data-enhance-toggle], #enhance-auto, #enhance-reset')) {
    queueMicrotask(syncFromControls)
  }
})

const observer = new MutationObserver((records) => {
  if (records.some((record) => record.type === 'attributes' && record.attributeName === 'aria-pressed')) {
    syncFromControls()
  }
})
observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] })

queueMicrotask(syncFromControls)
