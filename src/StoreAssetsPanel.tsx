import {
  createIconZip,
  createScreenshotSource,
  createScreenshotZip,
  downloadBlob,
  generateStoreIcons,
  generateStoreScreenshots,
  revokeOutputs,
  type IconFitMode,
  type IconOutput,
  type ScreenshotSource,
  type StoreFormat,
  type StoreIconOptions,
  type StoreOrientation,
  type StoreOutput,
  type StorePlatform,
  type StorePresetCategory,
  type StoreScreenshotOptions,
  type ResizeMode,
} from './store-assets'

const ALL_CATEGORIES: StorePresetCategory[] = ['phone', 'tablet7', 'tablet10', 'feature', 'iphone', 'ipad']

function ResultCard({ item, icon = false }: { item: StoreOutput | IconOutput; icon?: boolean }) {
  const quality = 'quality' in item ? item.quality : ''
  const upscale = 'upscale' in item ? item.upscale : 1
  return (
    <article className="store-result-card overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
      <div className={`${icon ? 'icon-result-preview' : ''} store-result-preview flex min-h-44 items-center justify-center bg-white p-3`}>
        <img src={item.url} alt={item.label} loading="lazy" className="max-h-72 max-w-full object-contain" />
      </div>
      <div className="store-result-body space-y-2 p-4">
        <strong className="block text-sm text-slate-950">{item.label}</strong>
        <small className="block text-slate-600">{item.width} × {item.height}</small>
        {quality ? <small className={`block ${upscale > 2 ? 'quality-low text-rose-700' : upscale > 1.5 ? 'quality-warn text-amber-700' : 'quality-good text-emerald-700'}`}>{quality}</small> : null}
        <button type="button" className="secondary bg-white text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 compact rounded-lg border border-slate-300 px-3 py-1.5 text-xs" onClick={() => downloadBlob(item.blob, item.filename)}>Download</button>
      </div>
    </article>
  )
}

export function StoreAssetsPanel() {
  const [view, setView] = React.useState<'screenshots' | 'icon'>('screenshots')
  const [sources, setSources] = React.useState<ScreenshotSource[]>([])
  const [outputs, setOutputs] = React.useState<StoreOutput[]>([])
  const [screenshotStatus, setScreenshotStatus] = React.useState('No screenshots added.')
  const [screenshotBusy, setScreenshotBusy] = React.useState(false)
  const [platform, setPlatform] = React.useState<StorePlatform>('both')
  const [orientation, setOrientation] = React.useState<StoreOrientation>('portrait')
  const [resizeMode, setResizeMode] = React.useState<ResizeMode>('fit')
  const [format, setFormat] = React.useState<StoreFormat>('png')
  const [background, setBackground] = React.useState('auto')
  const [categories, setCategories] = React.useState<StorePresetCategory[]>([...ALL_CATEGORIES])
  const [iconSource, setIconSource] = React.useState<ScreenshotSource | undefined>(undefined)
  const [iconOutputs, setIconOutputs] = React.useState<IconOutput[]>([])
  const [iconStatus, setIconStatus] = React.useState('Choose an icon to begin.')
  const [iconBusy, setIconBusy] = React.useState(false)
  const [iconFitMode, setIconFitMode] = React.useState<IconFitMode>('fit')
  const [iconBackground, setIconBackground] = React.useState('transparent')
  const screenshotInputRef = React.useRef<any>(null)
  const iconInputRef = React.useRef<any>(null)
  const draggedId = React.useRef<string | undefined>(undefined)

  const invalidateScreenshots = (message = 'Settings changed — generate screenshot assets when ready.') => {
    revokeOutputs(outputs)
    setOutputs([])
    setScreenshotStatus(message)
  }

  const invalidateIcons = (message = 'Icon settings changed — generate again when ready.') => {
    revokeOutputs(iconOutputs)
    setIconOutputs([])
    setIconStatus(message)
  }

  const screenshotOptions = (): StoreScreenshotOptions => ({ platform, orientation, resizeMode, format, background, categories })
  const iconOptions = (): StoreIconOptions => ({ fitMode: iconFitMode, background: iconBackground })

  const addScreenshotFiles = async (fileList: FileList | File[]) => {
    const files = [...fileList].filter((file) => file.type.startsWith('image/'))
    const remaining = Math.max(0, 10 - sources.length)
    if (!remaining) {
      setScreenshotStatus('Maximum 10 screenshots.')
      return
    }
    setScreenshotStatus('Reading screenshots…')
    const added: ScreenshotSource[] = []
    try {
      for (const file of files.slice(0, remaining)) added.push(await createScreenshotSource(file))
      invalidateScreenshots('Screenshots changed — generate when ready.')
      setSources((current: ScreenshotSource[]) => {
        const next = [...current, ...added]
        setScreenshotStatus(`${next.length} screenshot${next.length === 1 ? '' : 's'} ready.`)
        return next
      })
    } catch (error) {
      for (const item of added) URL.revokeObjectURL(item.url)
      setScreenshotStatus(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const removeSource = (id: string) => {
    const source = sources.find((item) => item.id === id)
    if (source) URL.revokeObjectURL(source.url)
    const next = sources.filter((item) => item.id !== id)
    setSources(next)
    invalidateScreenshots(next.length ? 'Screenshot list changed — generate again when ready.' : 'No screenshots added.')
  }

  const moveSource = (id: string, direction: -1 | 1) => {
    const index = sources.findIndex((item) => item.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= sources.length) return
    const next = [...sources]
    const [moving] = next.splice(index, 1)
    next.splice(target, 0, moving)
    setSources(next)
    invalidateScreenshots('Screenshot order changed — generate again when ready.')
  }

  const dropOnSource = (targetId: string) => {
    const fromId = draggedId.current
    draggedId.current = undefined
    if (!fromId || fromId === targetId) return
    const from = sources.findIndex((item) => item.id === fromId)
    const to = sources.findIndex((item) => item.id === targetId)
    if (from < 0 || to < 0) return
    const next = [...sources]
    const [moving] = next.splice(from, 1)
    next.splice(to, 0, moving)
    setSources(next)
    invalidateScreenshots('Screenshot order changed — generate again when ready.')
  }

  const generateScreenshots = async () => {
    if (!sources.length) {
      setScreenshotStatus('Add at least one screenshot first.')
      return
    }
    revokeOutputs(outputs)
    setOutputs([])
    setScreenshotBusy(true)
    setScreenshotStatus('Generating store screenshots locally…')
    try {
      const next = await generateStoreScreenshots(sources, screenshotOptions(), (done, total) => setScreenshotStatus(`Generated ${done} / ${total}`))
      setOutputs(next)
      setScreenshotStatus(`Done — ${next.length} store asset${next.length === 1 ? '' : 's'} generated.`)
    } catch (error) {
      setScreenshotStatus(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setScreenshotBusy(false)
    }
  }

  const downloadScreenshots = async () => {
    if (!outputs.length) return
    setScreenshotStatus('Creating screenshots ZIP…')
    try {
      const zip = await createScreenshotZip(outputs, screenshotOptions())
      downloadBlob(zip, 'app-store-screenshots.zip')
      setScreenshotStatus('Screenshots ZIP ready.')
    } catch (error) {
      setScreenshotStatus(`ZIP error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const setIconFile = async (file: File) => {
    setIconStatus('Reading icon…')
    try {
      const next = await createScreenshotSource(file)
      if (iconSource) URL.revokeObjectURL(iconSource.url)
      invalidateIcons('Icon ready.')
      setIconSource(next)
      const squareWarning = next.width === next.height ? '' : ' · Non-square source: Fit is recommended.'
      const resolutionWarning = Math.min(next.width, next.height) < 1024 ? ' · Source is below 1024 px and may look soft.' : ''
      setIconStatus(`${next.width} × ${next.height}${squareWarning}${resolutionWarning}`)
    } catch (error) {
      setIconStatus(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const generateIcons = async () => {
    if (!iconSource) {
      setIconStatus('Choose an icon first.')
      return
    }
    revokeOutputs(iconOutputs)
    setIconOutputs([])
    setIconBusy(true)
    setIconStatus('Generating app icons locally…')
    try {
      const next = await generateStoreIcons(iconSource, iconOptions(), (done, total) => setIconStatus(`Generated ${done} / ${total}`))
      setIconOutputs(next)
      setIconStatus(`Done — ${next.length} icons generated.${iconBackground === 'transparent' ? ' Transparent background is preserved; use an opaque background for Apple marketing icons if required.' : ''}`)
    } catch (error) {
      setIconStatus(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIconBusy(false)
    }
  }

  const downloadIcons = async () => {
    if (!iconSource || !iconOutputs.length) return
    setIconStatus('Creating icons ZIP…')
    try {
      const zip = await createIconZip(iconSource, iconOutputs, iconOptions())
      downloadBlob(zip, 'app-icons.zip')
      setIconStatus('Icons ZIP ready.')
    } catch (error) {
      setIconStatus(`ZIP error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  React.useEffect(() => () => {
    for (const item of sources) URL.revokeObjectURL(item.url)
    if (iconSource) URL.revokeObjectURL(iconSource.url)
    revokeOutputs(outputs)
    revokeOutputs(iconOutputs)
  }, [])

  const changeCategory = (category: StorePresetCategory, checked: boolean) => {
    const next = checked ? [...new Set([...categories, category])] : categories.filter((item) => item !== category)
    setCategories(next)
    invalidateScreenshots()
  }

  return (
    <section id="store-panel" className="menu-panel store-panel rounded-3xl border border-slate-200 bg-white p-5 shadow-sm [&_select]:w-full [&_select]:rounded-xl [&_select]:border [&_select]:border-slate-300 [&_select]:bg-white [&_select]:px-3 [&_select]:py-2 [&_select]:text-sm [&_select]:text-slate-900 [&_select]:outline-none [&_select:focus]:border-cyan-500 [&_select:focus]:ring-2 [&_select:focus]:ring-cyan-100">
      <div className="panel-heading flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><h3 className="text-xl font-semibold text-slate-950">App Store assets</h3><p className="mt-1 text-sm text-slate-600">Create screenshots, feature graphics, and app icons for Google Play and Apple App Store.</p></div>
      </div>
      <nav className="store-tabs mt-5 flex gap-2" aria-label="App Store asset type">
        <button type="button" className={`store-tab rounded-xl px-4 py-2 text-sm ${view === 'screenshots' ? 'active bg-cyan-600 font-semibold text-white' : 'border border-slate-300'}`} aria-pressed={view === 'screenshots'} onClick={() => setView('screenshots')}>Screenshots</button>
        <button type="button" className={`store-tab rounded-xl px-4 py-2 text-sm ${view === 'icon' ? 'active bg-cyan-600 font-semibold text-white' : 'border border-slate-300'}`} aria-pressed={view === 'icon'} onClick={() => setView('icon')}>App icon</button>
      </nav>

      {view === 'screenshots' ? (
        <section id="store-screenshots" className="store-view mt-5">
          <div className="store-grid-2 grid gap-5 xl:grid-cols-2">
            <div className="store-card rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="store-card-head flex items-start justify-between gap-3">
                <div><h4 className="font-semibold text-slate-950">Screenshots</h4><p className="text-sm text-slate-600">Upload up to 10 screenshots. Drag to reorder before generating.</p></div>
                <button id="store-pick-screenshots" className="secondary bg-white text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 compact rounded-lg border border-slate-300 px-3 py-2 text-xs" type="button" onClick={() => screenshotInputRef.current?.click()}>Add screenshots</button>
              </div>
              <input ref={screenshotInputRef} id="store-screenshot-input" type="file" accept="image/*" multiple hidden onChange={(event: any) => { const files = event.currentTarget.files; event.currentTarget.value = ''; if (files) void addScreenshotFiles(files) }} />
              <div id="store-screenshot-drop" className="mini-dropzone mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500" onDragOver={(event: any) => event.preventDefault()} onDrop={(event: any) => { event.preventDefault(); if (event.dataTransfer?.files) void addScreenshotFiles(event.dataTransfer.files) }}>Drop screenshots here</div>
              <div id="store-screenshot-list" className="source-list mt-4 space-y-2">
                {sources.map((source, index) => (
                  <article key={source.id} draggable className="source-row flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2" onDragStart={() => { draggedId.current = source.id }} onDragOver={(event: any) => event.preventDefault()} onDrop={() => dropOnSource(source.id)}>
                    <img src={source.url} alt={source.file.name} className="h-14 w-14 rounded-lg object-cover" />
                    <div className="source-info min-w-0 flex-1"><strong className="block truncate text-sm">{String(index + 1).padStart(2, '0')} · {source.file.name}</strong><small className="text-slate-500">{source.width} × {source.height}</small></div>
                    <div className="source-actions flex gap-1 [&_button]:rounded-lg [&_button]:border [&_button]:border-slate-300 [&_button]:bg-white [&_button]:px-2 [&_button]:py-1 [&_button]:text-xs [&_button]:font-medium [&_button]:text-slate-700 [&_button]:transition [&_button:hover]:border-cyan-400 [&_button:hover]:text-cyan-700 [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-40"><button type="button" disabled={index === 0} onClick={() => moveSource(source.id, -1)}>↑</button><button type="button" disabled={index === sources.length - 1} onClick={() => moveSource(source.id, 1)}>↓</button><button type="button" onClick={() => removeSource(source.id)}>Delete</button></div>
                  </article>
                ))}
              </div>
            </div>

            <div className="store-card store-settings rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h4 className="font-semibold text-slate-950">Output settings</h4>
              <div className="field-grid mt-4 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium text-slate-700"><span className="text-xs text-slate-500">Platform</span><select value={platform} onChange={(e: any) => { setPlatform(e.currentTarget.value); invalidateScreenshots() }}><option value="both">Google Play + Apple App Store</option><option value="google">Google Play</option><option value="apple">Apple App Store</option></select></label>
                <label className="grid gap-1 text-sm font-medium text-slate-700"><span className="text-xs text-slate-500">Orientation</span><select value={orientation} onChange={(e: any) => { setOrientation(e.currentTarget.value); invalidateScreenshots() }}><option value="portrait">Portrait</option><option value="landscape">Landscape</option><option value="both">Both</option></select></label>
                <label className="grid gap-1 text-sm font-medium text-slate-700"><span className="text-xs text-slate-500">Resize mode</span><select value={resizeMode} onChange={(e: any) => { setResizeMode(e.currentTarget.value); invalidateScreenshots() }}><option value="fit">Fit</option><option value="smart">Smart crop</option><option value="fill">Fill</option></select></label>
                <label className="grid gap-1 text-sm font-medium text-slate-700"><span className="text-xs text-slate-500">Format</span><select value={format} onChange={(e: any) => { setFormat(e.currentTarget.value); invalidateScreenshots() }}><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label>
              </div>
              <div className="setting-row mt-4"><span className="text-sm">Canvas background</span><div className="pill-group mt-2 flex flex-wrap gap-2">{['auto', '#ffffff', '#000000'].map((value) => <button key={value} type="button" className={`pill rounded-full border px-3 py-1.5 text-xs ${background === value ? 'active border-cyan-500 text-cyan-800' : 'border-slate-300'}`} onClick={() => { setBackground(value); invalidateScreenshots() }}>{value === 'auto' ? 'Auto' : value === '#ffffff' ? 'White' : 'Black'}</button>)}<label className="color-pill rounded-full border border-slate-300 px-3 py-1.5 text-xs">Custom <input type="color" value={background.startsWith('#') ? background : '#f1f5f9'} onChange={(e: any) => { setBackground(e.currentTarget.value); invalidateScreenshots() }} /></label></div></div>
              <div className="asset-checks mt-4 grid gap-2 sm:grid-cols-2">{([
                ['phone', 'Google Play phone'], ['tablet7', 'Google Play 7-inch tablet'], ['tablet10', 'Google Play 10-inch tablet'], ['feature', 'Google Play feature graphic'], ['iphone', 'Apple iPhone 6.9-inch'], ['ipad', 'Apple iPad 13-inch'],
              ] as Array<[StorePresetCategory, string]>).map(([value, label]) => <label key={value} className="text-sm"><input type="checkbox" checked={categories.includes(value)} onChange={(e: any) => changeCategory(value, e.currentTarget.checked)} /> {label}</label>)}</div>
              <button id="store-generate-screenshots" className="primary store-action mt-5 rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white disabled:opacity-50" type="button" disabled={screenshotBusy} onClick={() => void generateScreenshots()}>{screenshotBusy ? 'Generating…' : 'Generate screenshot assets'}</button>
              <small id="store-screenshot-status" className="store-status mt-3 block text-sm text-slate-600" aria-live="polite">{screenshotStatus}</small>
            </div>
          </div>
          <div className="store-output-head mt-6 flex items-end justify-between gap-3"><div><h4 className="font-semibold text-slate-950">Generated screenshots</h4><p className="text-sm text-slate-600">Quality warnings are based on how much the source must be upscaled.</p></div><button id="store-download-screenshots" className="secondary bg-white text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 compact rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-40" type="button" disabled={!outputs.length} onClick={() => void downloadScreenshots()}>Download screenshots ZIP</button></div>
          <div id="store-screenshot-results" className="store-results mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{outputs.map((item) => <ResultCard key={item.id} item={item} />)}</div>
        </section>
      ) : (
        <section id="store-icon" className="store-view mt-5">
          <div className="store-grid-2 grid gap-5 xl:grid-cols-2">
            <div className="store-card rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="store-card-head flex items-start justify-between gap-3"><div><h4 className="font-semibold text-slate-950">Source icon</h4><p className="text-sm text-slate-600">Use a square image at 1024 × 1024 or larger for the best result.</p></div><button id="store-pick-icon" className="secondary bg-white text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 compact rounded-lg border border-slate-300 px-3 py-2 text-xs" type="button" onClick={() => iconInputRef.current?.click()}>Choose icon</button></div>
              <input ref={iconInputRef} id="store-icon-input" type="file" accept="image/*" hidden onChange={(event: any) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void setIconFile(file) }} />
              <div id="store-icon-drop" className="mini-dropzone mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500" onDragOver={(event: any) => event.preventDefault()} onDrop={(event: any) => { event.preventDefault(); const file = event.dataTransfer?.files?.[0]; if (file) void setIconFile(file) }}>Drop an icon here</div>
              <small id="store-icon-source-info" className="store-status mt-3 block text-sm text-slate-600">{iconStatus}</small>
              {iconSource ? <div className="icon-preview-pair mt-4 grid grid-cols-2 gap-4"><div><span className="text-xs text-slate-500">Square</span><div className="icon-preview mt-2 aspect-square overflow-hidden border border-slate-200" style={{ background: iconBackground === 'transparent' ? 'transparent' : iconBackground }}><img src={iconSource.url} alt="App icon preview" className={`h-full w-full ${iconFitMode === 'fit' ? 'object-contain' : 'object-cover'}`} /></div></div><div><span className="text-xs text-slate-500">Rounded preview</span><div className="icon-preview rounded mt-2 aspect-square overflow-hidden rounded-[24%] border border-slate-200" style={{ background: iconBackground === 'transparent' ? 'transparent' : iconBackground }}><img src={iconSource.url} alt="Rounded app icon preview" className={`h-full w-full ${iconFitMode === 'fit' ? 'object-contain' : 'object-cover'}`} /></div></div></div> : null}
            </div>
            <div className="store-card store-settings rounded-2xl border border-slate-200 bg-slate-50 p-4"><h4 className="font-semibold text-slate-950">Icon settings</h4><div className="field-grid mt-4"><label className="grid gap-1 text-sm font-medium text-slate-700"><span className="text-xs text-slate-500">Layout</span><select value={iconFitMode} onChange={(e: any) => { setIconFitMode(e.currentTarget.value); invalidateIcons() }}><option value="fit">Fit</option><option value="fill">Fill</option></select></label></div><div className="setting-row mt-4"><span className="text-sm">Background</span><div className="pill-group mt-2 flex flex-wrap gap-2">{['transparent', '#ffffff', '#000000'].map((value) => <button key={value} type="button" className={`pill rounded-full border px-3 py-1.5 text-xs ${iconBackground === value ? 'active border-cyan-500 text-cyan-800' : 'border-slate-300'}`} onClick={() => { setIconBackground(value); invalidateIcons() }}>{value === 'transparent' ? 'Transparent' : value === '#ffffff' ? 'White' : 'Black'}</button>)}<label className="color-pill rounded-full border border-slate-300 px-3 py-1.5 text-xs">Custom <input type="color" value={iconBackground.startsWith('#') ? iconBackground : '#ffffff'} onChange={(e: any) => { setIconBackground(e.currentTarget.value); invalidateIcons() }} /></label></div></div><div className="store-note mt-4 rounded-xl bg-white p-3 text-sm text-slate-600"><strong className="text-slate-800">Exports</strong><p>Master 1024 × 1024, Google Play 512 × 512, plus common Apple asset-catalog icon sizes. Rounded corners are preview-only.</p></div><button id="store-generate-icons" className="primary store-action mt-5 rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white disabled:opacity-50" type="button" disabled={iconBusy} onClick={() => void generateIcons()}>{iconBusy ? 'Generating…' : 'Generate app icons'}</button></div>
          </div>
          <div className="store-output-head mt-6 flex items-end justify-between gap-3"><div><h4 className="font-semibold text-slate-950">Generated app icons</h4><p className="text-sm text-slate-600">No rounded corners are baked into exported files.</p></div><button id="store-download-icons" className="secondary bg-white text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 compact rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-40" type="button" disabled={!iconOutputs.length} onClick={() => void downloadIcons()}>Download icons ZIP</button></div>
          <div id="store-icon-results" className="store-results mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{iconOutputs.map((item) => <ResultCard key={item.id} item={item} icon />)}</div>
        </section>
      )}
    </section>
  )
}
