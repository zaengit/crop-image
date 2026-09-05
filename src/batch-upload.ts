import './batch-upload.css'
import './enhancement-bridge'
import './enhance-flow-gate'
import './store-global-enhance'

const fileInput = document.querySelector<HTMLInputElement>('#file')
const pick = document.querySelector<HTMLButtonElement>('#pick')
const batch = document.querySelector<HTMLElement>('#image-batch')

if (fileInput) fileInput.multiple = false
if (pick) pick.textContent = 'Choose image'

// Global Enhance is a single-master-image workflow. App Store assets keep
// their own multi-file inputs inside the Store section.
if (batch) batch.hidden = true
