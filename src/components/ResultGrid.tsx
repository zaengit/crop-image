import { downloadBlob, humanBytes, type Generated } from '../use-crop-engine'

type ResultCardProps = {
  item: Generated
  onDelete: (id: string) => void
}

function ResultCard({ item, onDelete }: ResultCardProps) {
  return (
    <article className="card overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-neutral-200/70">
      <div className="flex items-center justify-center bg-neutral-100 p-3">
        <img
          src={item.url}
          alt={`${item.preset.platform} ${item.preset.label}`}
          width={item.preset.width}
          height={item.preset.height}
          loading="lazy"
          className="max-h-80 w-full object-contain"
          style={{ aspectRatio: `${item.preset.width} / ${item.preset.height}` }}
        />
      </div>
      <div className="space-y-3 p-4">
        <div>
          <strong className="block text-sm text-slate-950">{item.preset.platform}</strong>
          <span className="text-sm text-slate-600">{item.preset.label}</span>
        </div>
        <small className="block text-slate-500">
          {item.preset.width} × {item.preset.height} · {item.extension.toUpperCase()} · {humanBytes(item.blob.size)}
        </small>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-9 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-950 hover:text-neutral-950"
            onClick={() => downloadBlob(item.blob, `${item.preset.id}.${item.extension}`)}
          >
            Download
          </button>
          {item.preset.group === 'custom' ? (
            <button
              type="button"
              className="min-h-9 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 transition hover:border-neutral-950 hover:text-neutral-950"
              onClick={() => onDelete(item.preset.id)}
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

type ResultGridProps = {
  items: Generated[]
  showEmptyState: boolean
  onDelete: (id: string) => void
}

export function ResultGrid({ items, showEmptyState, onDelete }: ResultGridProps) {
  return (
    <>
      <div id="grid" className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => <ResultCard key={item.preset.id} item={item} onDelete={onDelete} />)}
      </div>
      {!items.length && showEmptyState ? (
        <p id="empty-state" className="mt-5 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
          No sizes generated in this category yet.
        </p>
      ) : null}
    </>
  )
}
