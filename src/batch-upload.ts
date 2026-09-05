import './batch-upload.css'
import './enhancement-bridge'
import './store-global-enhance'

const fileInput = document.querySelector<HTMLInputElement>('#file')
const pick = document.querySelector<HTMLButtonElement>('#pick')
const dropzone = document.querySelector<HTMLElement>('#dropzone')
const batch = document.querySelector<HTMLElement>('#image-batch')

if (fileInput) fileInput.multiple = false
if (pick) pick.textContent = 'Choose image'
const dropCopy = dropzone?.querySelector<HTMLParagraphElement>('p')
if (dropCopy) dropCopy.textContent = 'or drop an image here'

// Global Enhance is a single-master-image workflow. App Store assets keep
// their own multi-file inputs inside the Store section.
if (batch) batch.hidden = true
