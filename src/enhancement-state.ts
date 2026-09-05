import { DEFAULT_ENHANCEMENT, type EnhancementSettings } from './enhance'

let current: EnhancementSettings = { ...DEFAULT_ENHANCEMENT }
const listeners = new Set<(settings: EnhancementSettings) => void>()

export function getGlobalEnhancement() {
  return { ...current }
}

export function setGlobalEnhancement(settings: EnhancementSettings) {
  current = { ...DEFAULT_ENHANCEMENT, ...settings }
  for (const listener of listeners) listener(getGlobalEnhancement())
}

export function subscribeGlobalEnhancement(listener: (settings: EnhancementSettings) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
