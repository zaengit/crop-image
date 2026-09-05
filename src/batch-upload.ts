import './enhancement-bridge'
import './store-global-enhance'

const fileInput = document.querySelector<HTMLInputElement>('#file')
const pick = document.querySelector<HTMLButtonElement>('#pick')
const dropzone = document.querySelector<HTMLElement>('#dropzone')
const batch = document.querySelector<HTMLElement>('#image-batch')

if (fileInput) {
  fileInput.multiple = false
  fileInput.removeAttribute('multiple')
}
if (pick) pick.textContent = 'Choose image'
const dropCopy = dropzone?.querySelector<HTMLParagraphElement>('p')
if (dropCopy) dropCopy.textContent = 'or drop an image here'

// The application uses one active master image. Remove the legacy batch UI
// entirely instead of keeping a hidden multi-image surface in the document.
batch?.remove()
