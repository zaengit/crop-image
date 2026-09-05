import type { ChangeEvent, FormEvent } from 'react'
import type { useCropEngine } from '../use-crop-engine'

type CropEngine = ReturnType<typeof useCropEngine>

type OutputSettingsProps = {
  engine: CropEngine
}

export function OutputSettings({ engine }: OutputSettingsProps) {
  const handleFormat = (event: ChangeEvent<HTMLSelectElement>) => {
    engine.setFormat(event.currentTarget.value as 'png' | 'jpeg' | 'webp')
  }

  const handleQuality = (event: FormEvent<HTMLInputElement>) => {
    engine.setQuality(Number(event.currentTarget.value))
  }

  return (
    <div className="flex flex-wrap items-end gap-2" aria-label="Output settings">
      <label className="grid min-w-28 gap-1 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
        <span>Format</span>
        <select id="format" value={engine.format} onChange={handleFormat} className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 transition focus:border-neutral-950">
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
          <option value="png">PNG</option>
        </select>
      </label>
      {engine.format !== 'png' ? (
        <label id="quality-wrap" className="grid min-w-44 gap-1 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          <span>Quality <strong id="quality-value" className="text-neutral-950">{engine.quality}</strong></span>
          <input
            id="quality"
            type="range"
            min="60"
            max="100"
            value={engine.quality}
            step="1"
            className="accent-neutral-950"
            onInput={handleQuality}
            onChange={engine.commitQuality}
          />
        </label>
      ) : null}
      <button
        id="download-all"
        className="secondary-button min-h-11 rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition hover:border-neutral-950 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        disabled={!engine.generated.length || engine.busy}
        onClick={() => void engine.downloadZip()}
      >
        Download ZIP
      </button>
    </div>
  )
}
