import { useCropEngine, downloadBlob, humanBytes, type Generated } from './use-crop-engine'
import type { PresetGroup } from './presets'
import { EnhancementPanel, enhancementPreviewFilter } from './EnhancementPanel'
import { StoreAssetsPanel } from './StoreAssetsPanel'

function ResultCard({ item, onDelete }: { item: Generated; onDelete: (id: string) => void }) {
  return (
    <article className="card overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/80">
      <div className="thumb flex items-center justify-center bg-slate-50 p-3">
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
      <div className="card-body space-y-3 p-4">
        <div className="card-meta"><strong className="block text-sm text-white">{item.preset.platform}</strong><span className="text-sm text-slate-600">{item.preset.label}</span></div>
        <small className="block text-slate-500">{item.preset.width} × {item.preset.height} · {item.extension.toUpperCase()} · {humanBytes(item.blob.size)}</small>
        <div className="card-actions flex flex-wrap gap-2">
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:border-cyan-500" onClick={() => downloadBlob(item.blob, `${item.preset.id}.${item.extension}`)}>Download</button>
          {item.preset.group === 'custom' ? <button type="button" className="remove-button rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-700" onClick={() => onDelete(item.preset.id)}>Delete</button> : null}
        </div>
      </div>
    </article>
  )
}

function OutputSettings({ engine }: { engine: any }) {
  return (
    <div className="output-controls flex flex-wrap items-end gap-3" aria-label="Output settings">
      <label className="grid gap-1 text-xs text-slate-600"><span>Format</span><select id="format" value={engine.format} onChange={(event: any) => engine.setFormat(event.currentTarget.value)} className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900"><option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="png">PNG</option></select></label>
      {engine.format !== 'png' ? <label id="quality-wrap" className="grid min-w-44 gap-1 text-xs text-slate-600"><span>Quality <strong id="quality-value" className="text-slate-800">{engine.quality}</strong></span><input id="quality" type="range" min="60" max="100" value={engine.quality} step="1" className="accent-cyan-400" onInput={(event: any) => engine.setQuality(Number(event.currentTarget.value))} onChange={engine.commitQuality} /></label> : null}
      <button id="download-all" className="secondary rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-40" type="button" disabled={!engine.generated.length || engine.busy} onClick={() => void engine.downloadZip()}>Download ZIP</button>
    </div>
  )
}

export function App() {
  const engine = useCropEngine()
  const [menu, setMenu] = React.useState<PresetGroup>('social')
  const [draggingFocus, setDraggingFocus] = React.useState(false)
  const [comparing, setComparing] = React.useState(false)
  const [customWidth, setCustomWidth] = React.useState(1080)
  const [customHeight, setCustomHeight] = React.useState(1080)
  const [lockRatio, setLockRatio] = React.useState(false)
  const [lockedRatio, setLockedRatio] = React.useState(1)
  const [customError, setCustomError] = React.useState('')
  const fileRef = React.useRef<any>(null)
  const stageRef = React.useRef<any>(null)
  const imageRef = React.useRef<any>(null)

  React.useEffect(() => {
    document.documentElement.dataset.appReady = 'true'
    return () => { delete document.documentElement.dataset.appReady }
  }, [])

  const visibleResults = engine.generated.filter((item: Generated) => item.preset.group === menu)

  const processFile = (file: File | undefined) => {
    if (!file) return
    setMenu('social')
    setCustomError('')
    void engine.processFile(file)
  }

  const renderedImageBox = () => {
    const stage = stageRef.current as HTMLElement | null
    const image = imageRef.current as HTMLImageElement | null
    const stageWidth = stage?.clientWidth ?? 0
    const stageHeight = stage?.clientHeight ?? 0
    if (!image?.naturalWidth || !image.naturalHeight || !stageWidth || !stageHeight) return { left: 0, top: 0, width: stageWidth, height: stageHeight }
    const imageRatio = image.naturalWidth / image.naturalHeight
    const stageRatio = stageWidth / stageHeight
    if (imageRatio > stageRatio) {
      const height = stageWidth / imageRatio
      return { left: 0, top: (stageHeight - height) / 2, width: stageWidth, height }
    }
    const width = stageHeight * imageRatio
    return { left: (stageWidth - width) / 2, top: 0, width, height: stageHeight }
  }

  const focusFromPointer = (event: any) => {
    const stage = stageRef.current as HTMLElement | null
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const box = renderedImageBox()
    engine.updateFocus(
      (event.clientX - rect.left - box.left) / Math.max(1, box.width),
      (event.clientY - rect.top - box.top) / Math.max(1, box.height),
    )
  }

  const focusBox = renderedImageBox()
  const targetStyle = engine.hasImage ? {
    left: `${focusBox.left + engine.focus.x * focusBox.width}px`,
    top: `${focusBox.top + engine.focus.y * focusBox.height}px`,
  } : undefined

  const setRatio = (ratio: number) => {
    setLockedRatio(ratio)
    setLockRatio(true)
    setCustomHeight(Math.max(64, Math.min(8192, Math.round(customWidth / ratio))))
  }

  const updateWidth = (value: number) => {
    setCustomWidth(value)
    if (lockRatio && lockedRatio) setCustomHeight(Math.max(64, Math.min(8192, Math.round(value / lockedRatio))))
  }

  const updateHeight = (value: number) => {
    setCustomHeight(value)
    if (lockRatio && lockedRatio) setCustomWidth(Math.max(64, Math.min(8192, Math.round(value * lockedRatio))))
  }

  const submitCustom = (event: any) => {
    event.preventDefault()
    const error = engine.generateCustom(customWidth, customHeight)
    setCustomError(error)
  }

  const previewFilter = enhancementPreviewFilter(engine.enhancement, comparing)

  return (
    <main className="app min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="hero py-5 text-center">
          <p className="eyebrow text-xs font-bold tracking-[0.22em] text-cyan-700">LOCAL • PRIVATE • WASM</p>
          <h1 className="mx-auto mt-3 max-w-4xl text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">Upload once. Get every size you need.</h1>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600">Smart crop runs on your device. Your image never leaves the browser.</p>
        </header>

        <section
          className="upload-card rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center transition hover:border-cyan-500/60"
          id="dropzone"
          onDragOver={(event: any) => event.preventDefault()}
          onDrop={(event: any) => { event.preventDefault(); processFile(event.dataTransfer?.files?.[0]) }}
        >
          <input ref={fileRef} id="file" type="file" accept="image/*" hidden onChange={(event: any) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; processFile(file) }} />
          <button id="pick" className="primary rounded-xl bg-cyan-600 px-5 py-2.5 font-semibold text-white shadow-lg shadow-cyan-100 disabled:opacity-50" type="button" disabled={engine.busy} onClick={() => fileRef.current?.click()}>Choose image</button>
          <p className="mt-3 text-sm text-slate-500">or drop an image here</p>
          <small id="status" aria-live="polite" className="mt-3 block text-sm text-slate-600">{engine.status}</small>
        </section>

        <EnhancementPanel
          visible={engine.hasImage}
          settings={engine.enhancement}
          status={engine.enhancementStatus}
          onApply={engine.applyEnhancement}
          onAuto={engine.autoEnhance}
          onReset={engine.resetEnhancement}
          onCompareChange={setComparing}
        />

        {engine.hasImage ? (
          <section id="focus-editor" className="focus-editor grid gap-5 rounded-3xl border border-slate-200 bg-white p-5 lg:grid-cols-[minmax(220px,0.35fr)_1fr]">
            <div className="focus-copy">
              <p className="eyebrow text-xs font-bold tracking-[0.2em] text-cyan-700">FOCAL POINT</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">Fine-tune the smart crop</h2>
              <p className="mt-2 text-sm text-slate-600">Drag the target over the subject you want every generated size to prioritize.</p>
              <button id="reset-focus" className="secondary mt-4 rounded-xl border border-slate-300 px-4 py-2 text-sm" type="button" onClick={engine.resetFocus}>Use auto focus</button>
            </div>
            <div
              ref={stageRef}
              id="focus-stage"
              className="focus-stage relative flex min-h-[320px] touch-none items-center justify-center overflow-hidden rounded-2xl bg-slate-50"
              onPointerDown={(event: any) => { setDraggingFocus(true); event.currentTarget.setPointerCapture?.(event.pointerId); focusFromPointer(event) }}
              onPointerMove={(event: any) => { if (draggingFocus) focusFromPointer(event) }}
              onPointerUp={(event: any) => { setDraggingFocus(false); event.currentTarget.releasePointerCapture?.(event.pointerId); focusFromPointer(event) }}
              onPointerCancel={() => setDraggingFocus(false)}
            >
              <img ref={imageRef} id="focus-image" src={engine.sourceUrl} alt="Original upload for focal-point adjustment" className="max-h-[560px] max-w-full select-none object-contain" draggable={false} style={{ filter: previewFilter }} />
              <button id="focus-target" className="focus-target absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-600/40 shadow-[0_0_0_5px_rgba(6,182,212,.25)]" style={targetStyle} type="button" aria-label="Focal point" />
            </div>
          </section>
        ) : null}

        <section id="results" className={`results rounded-3xl border border-slate-200 bg-white p-5 ${menu === 'store' ? 'store-mode' : ''}`}>
          <div className="results-head flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div><p className="eyebrow text-xs font-bold tracking-[0.2em] text-cyan-700">GENERATE</p><h2 className="mt-2 text-2xl font-semibold text-slate-950">Image sizes</h2></div>
            <OutputSettings engine={engine} />
          </div>

          <nav className="size-tabs mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Image size categories">
            {([
              ['social', 'Social media'], ['passport', 'Passport photo'], ['custom', 'Custom'], ['store', 'App Store assets'],
            ] as Array<[PresetGroup, string]>).map(([value, label]) => (
              <button key={value} className={`size-tab whitespace-nowrap rounded-xl px-4 py-2 text-sm ${menu === value ? 'active bg-cyan-600 font-semibold text-white' : 'border border-slate-300 text-slate-700'}`} type="button" data-menu={value} aria-pressed={menu === value} onClick={() => setMenu(value)}>{label}</button>
            ))}
          </nav>

          {menu === 'social' ? <section id="social-panel" className="menu-panel mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="panel-heading flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-lg font-semibold">Social media</h3><p className="text-sm text-slate-600">Adjust the focal point if needed, then generate ready-to-use social media sizes.</p></div><button id="generate-social" className="primary rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white disabled:opacity-40" type="button" disabled={engine.busy} onClick={() => engine.generateGroup('social')}>Generate crop</button></div></section> : null}

          {menu === 'passport' ? <section id="passport-panel" className="menu-panel mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="panel-heading passport-heading flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-lg font-semibold">Passport photo</h3><p className="text-sm text-slate-600">Choose the background and generate portrait-focused 2 × 3, 3 × 4, and 4 × 6 outputs.</p></div><button id="generate-passport" className="primary rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white disabled:opacity-40" type="button" disabled={engine.busy} onClick={() => engine.generateGroup('passport')}>Generate crop</button></div><div className="background-control mt-4 grid gap-3 lg:grid-cols-[220px_1fr]"><div><strong>Background</strong><p className="text-sm text-slate-600">Keep the original scene or replace it with a solid color.</p></div><div><div className="background-options flex flex-wrap gap-2" role="group" aria-label="Passport photo background">{[
            ['original', 'Original'], ['#ffffff', 'White'], ['#d71920', 'Red'], ['#1769d2', 'Blue'],
          ].map(([value, label]) => <button key={value} className={`background-option rounded-full border px-3 py-2 text-sm ${engine.background === value ? 'active border-cyan-500 text-cyan-800' : 'border-slate-300'}`} type="button" data-background={value} aria-pressed={engine.background === value} onClick={() => engine.setBackground(value)}>{label}</button>)}<label className="custom-color-option rounded-full border border-slate-300 px-3 py-2 text-sm"><span>Custom </span><input id="passport-background-color" type="color" value={engine.background.startsWith('#') ? engine.background : '#e5e7eb'} aria-label="Custom passport background color" onChange={(event: any) => engine.setBackground(event.currentTarget.value)} /></label></div><small id="background-status" className="background-status mt-2 block text-sm text-slate-600" aria-live="polite">{engine.backgroundStatus}</small></div></div></section> : null}

          {menu === 'custom' ? <section id="custom-panel" className="menu-panel mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="panel-heading"><div><h3 className="text-lg font-semibold">Custom size</h3><p className="text-sm text-slate-600">Create any pixel size while keeping smart crop and your current focal point.</p></div></div><form id="custom-form" className="custom-form mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={submitCustom}><label className="grid gap-1 text-sm"><span>Width</span><input id="custom-width" className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2" type="number" min="64" max="8192" value={customWidth} inputMode="numeric" required onChange={(event: any) => updateWidth(Number(event.currentTarget.value))} /></label><label className="grid gap-1 text-sm"><span>Height</span><input id="custom-height" className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2" type="number" min="64" max="8192" value={customHeight} inputMode="numeric" required onChange={(event: any) => updateHeight(Number(event.currentTarget.value))} /></label><label className="ratio-lock flex items-center gap-2 self-end rounded-lg border border-slate-300 px-3 py-2 text-sm"><input id="lock-ratio" type="checkbox" checked={lockRatio} onChange={(event: any) => { const checked = event.currentTarget.checked; setLockRatio(checked); if (checked) setLockedRatio(customWidth / Math.max(1, customHeight)) }} /><span>Lock aspect ratio</span></label><div className="ratio-presets flex flex-wrap gap-2 md:col-span-3" aria-label="Quick aspect ratios">{[[1, 1], [4, 5], [9, 16], [16, 9], [2, 3], [3, 4]].map(([w, h]) => <button key={`${w}/${h}`} type="button" data-ratio={`${w}/${h}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs" onClick={() => setRatio(w / h)}>{w}:{h}</button>)}</div><button className="primary custom-generate rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white disabled:opacity-40 md:col-span-3 md:w-fit" type="submit" disabled={engine.busy}>Generate custom size</button><small id="custom-error" className="form-error text-sm text-rose-700 md:col-span-3" aria-live="polite">{customError}</small></form></section> : null}

          {menu === 'store' ? <div className="mt-5"><StoreAssetsPanel /></div> : null}

          {menu !== 'store' ? <><div id="grid" className="grid mt-5 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibleResults.map((item: Generated) => <ResultCard key={item.preset.id} item={item} onDelete={engine.removeCustom} />)}</div>{!visibleResults.length && menu === 'custom' ? <p id="empty-state" className="empty-state mt-5 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">No sizes generated in this category yet.</p> : null}</> : null}
        </section>
      </div>
    </main>
  )
}
