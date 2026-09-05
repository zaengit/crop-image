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
    <div className="flex flex-wrap items-end gap-3" aria-label="Output settings">
      <label className="grid gap-1 text-xs text-slate-600">
        <span>Format</span>
        <select id="format" value={engine.format} onChange={handleFormat} className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900">
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
          <option value="png">PNG</option>
        </select>
      </label>
      {engine.format !== 'png' ? (
        <label id="quality-wrap" className="grid min-w-44 gap-1 text-xs text-slate-600">
          <span>Quality <strong id="quality-value" className="text-slate-800">{engine.quality}</strong></span>
          <input
            id="quality"
            type="range"
            min="60"
            max="100"
            value={engine.quality}
            step="1"
            className="accent-cyan-400"
            onInput={handleQuality}
            onChange={engine.commitQuality}
          />
        </label>
      ) : null}
      <button
        id="download-all"
        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 disabled:opacity-40"
        type="button"
        disabled={!engine.generated.length || engine.busy}
        onClick={() => void engine.downloadZip()}
      >
        Download ZIP
      </button>
    </div>
  )
}
