import { DEFAULT_ENHANCEMENT, type EnhancementSettings } from './enhance'

let currentSettings: EnhancementSettings = { ...DEFAULT_ENHANCEMENT }
const listeners = new Set<(settings: EnhancementSettings) => void>()

function clone(settings: EnhancementSettings): EnhancementSettings {
  return { ...settings }
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
