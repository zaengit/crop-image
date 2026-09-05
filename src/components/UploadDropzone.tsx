import { useRef, type ChangeEvent, type DragEvent } from 'react'

type UploadDropzoneProps = {
  busy: boolean
  status: string
  onFile: (file: File | undefined) => void
}

export function UploadDropzone({ busy, status, onFile }: UploadDropzoneProps) {
  const fileRef = useRef<HTMLInputElement>(null)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    onFile(file)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    onFile(event.dataTransfer.files?.[0])
  }

  return (
    <section
      className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center transition hover:border-cyan-500/60"
      id="dropzone"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <input ref={fileRef} id="file" type="file" accept="image/*" hidden onChange={handleChange} />
      <button
        id="pick"
        className="rounded-xl bg-cyan-600 px-5 py-2.5 font-semibold text-white shadow-lg shadow-cyan-100 disabled:opacity-50"
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        Choose image
      </button>
      <p className="mt-3 text-sm text-slate-500">or drop an image here</p>
      <small id="status" aria-live="polite" className="mt-3 block text-sm text-slate-600">{status}</small>
    </section>
  )
}
