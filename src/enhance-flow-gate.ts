const fileInput = document.querySelector<HTMLInputElement>('#file')
const dropzone = document.querySelector<HTMLElement>('#dropzone')
const enhanceRoot = document.querySelector<HTMLElement>('#enhance-global')
const enhanceStatus = document.querySelector<HTMLElement>('#enhance-status')
const generateSocial = document.querySelector<HTMLButtonElement>('#generate-social')
const generatePassport = document.querySelector<HTMLButtonElement>('#generate-passport')
const customSubmit = document.querySelector<HTMLButtonElement>('#custom-form button[type="submit"]')

const cropActions = [generateSocial, generatePassport, customSubmit].filter(
  (button): button is HTMLButtonElement => Boolean(button),
)

let enhancementRequested = false
let hasImage = false
let masterReady = false

function setCropEnabled(enabled: boolean) {
  masterReady = enabled
  for (const button of cropActions) {
    button.disabled = !enabled
    button.setAttribute('aria-disabled', String(!enabled))
    button.title = enabled ? '' : 'Enhance the image first'
  }
}

function beginNewMaster() {
  hasImage = true
  enhancementRequested = false
  setCropEnabled(false)
  if (enhanceStatus) enhanceStatus.textContent = 'Enhance this image first. Crop generation unlocks when enhancement is complete.'
}

function markEnhancementRequested() {
  if (!hasImage) return
  enhancementRequested = true
  setCropEnabled(false)
}

function isEnhancementSuccess(text: string) {
  const value = text.toLowerCase()
  if (value.includes('error') || value.includes('unavailable')) return false
  return value.includes('enhancement updated')
    || value.includes('auto enhance applied')
    || value.includes('applied to all generated sizes')
    || value.includes('active —')
}

fileInput?.addEventListener('change', () => {
  if (fileInput.files?.[0]) beginNewMaster()
}, { capture: true })

dropzone?.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0]
  if (file?.type.startsWith('image/')) beginNewMaster()
}, { capture: true })

enhanceRoot?.addEventListener('input', (event) => {
  if ((event.target as HTMLElement).matches('[data-enhance-range]')) markEnhancementRequested()
}, { capture: true })

enhanceRoot?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  if (target.closest('#enhance-auto, #enhance-reset, [data-enhance-toggle]')) markEnhancementRequested()
}, { capture: true })

if (enhanceStatus) {
  const observer = new MutationObserver(() => {
    const text = enhanceStatus.textContent ?? ''
    if (!hasImage) return
    if (!enhancementRequested) {
      if (text === 'Enhancement updated.') {
        enhanceStatus.textContent = 'Enhance this image first. Crop generation unlocks when enhancement is complete.'
      }
      return
    }
    if (!masterReady && isEnhancementSuccess(text)) setCropEnabled(true)
  })
  observer.observe(enhanceStatus, { childList: true, subtree: true, characterData: true })
}

setCropEnabled(false)
