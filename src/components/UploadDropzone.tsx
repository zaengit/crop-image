import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'

type UploadDropzoneProps = {
  busy: boolean
  status: string
  onFile: (file: File | undefined) => void
}

export function UploadDropzone({ busy, status, onFile }: UploadDropzoneProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    onFile(file)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragActive(false)
    onFile(event.dataTransfer.files?.[0])
  }

  return (
    <section
      className={`upload-dropzone group rounded-[28px] border border-dashed p-6 text-center transition sm:p-8 ${dragActive ? 'border-neutral-950 bg-neutral-100' : 'border-neutral-300 bg-white hover:border-neutral-950'}`}
      id="dropzone"
      aria-labelledby="upload-title"
      onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { event.preventDefault(); setDragActive(false) }}
      onDrop={handleDrop}
    >
      <input ref={fileRef} id="file" type="file" accept="image/*" hidden onChange={handleChange} />
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-950 text-white shadow-lg shadow-neutral-300 transition group-hover:-translate-y-0.5" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" strokeLinecap="round" />
        </svg>
      </div>
      <p id="upload-title" className="mt-5 text-lg font-semibold tracking-tight text-neutral-950">Drop an image to get started</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-neutral-600">Your image stays on this device. We’ll use it to create every crop in one pass.</p>
      <button
        id="pick"
        className="primary-button mt-5 min-h-11 rounded-xl bg-neutral-950 px-5 py-2.5 font-semibold text-white shadow-lg shadow-neutral-200 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        Choose image
      </button>
      <p className="mt-4 text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">PNG · JPG · WebP</p>
      <small id="status" aria-live="polite" className="mx-auto mt-4 block max-w-xl text-sm text-neutral-600">{status}</small>
    </section>
  )
}
