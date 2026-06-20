import { useEffect, useState } from 'react'
import {
  Copy,
  FolderOpen,
  Grid2X2,
  Layers3,
  LoaderCircle,
  MoreHorizontal,
  Package,
  PackageOpen,
  Play,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X
} from 'lucide-react'
import { EmptyState } from '../components/EmptyState'
import { SectionHeader } from '../components/SectionHeader'
import type { LauncherController } from '../hooks/useLauncher'
import { launcherApi, openPath } from '../lib/api'
import type { InstalledContent, InstanceProfile, LoaderKind } from '../lib/types'
import { formatDuration, formatLoaderName, formatRelativeDate, safeMessage } from '../lib/utils'

const loaders: LoaderKind[] = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']
const CONTENT_PAGE_SIZE = 8

export function LibraryPage({ controller }: { controller: LauncherController }) {
  const { bootstrap, selectedInstance, setError } = controller
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showContent, setShowContent] = useState(false)
  const [detail, setDetail] = useState<InstanceProfile | null>(selectedInstance)
  const [content, setContent] = useState<InstalledContent[]>([])
  const [contentLoading, setContentLoading] = useState(false)
  const [contentBusy, setContentBusy] = useState<string | null>(null)
  const [contentPage, setContentPage] = useState(0)
  const [name, setName] = useState('New instance')
  const [version, setVersion] = useState(bootstrap?.versions.latestRelease || '1.21.1')
  const [loader, setLoader] = useState<LoaderKind>('fabric')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    setDetail(selectedInstance)
  }, [selectedInstance?.id])

  const loadContent = async (instance = detail) => {
    if (!instance) {
      setContent([])
      return
    }
    setContentLoading(true)
    try {
      setContent(await launcherApi.listContent(instance.id))
    } catch (error) {
      setError(safeMessage(error))
    } finally {
      setContentLoading(false)
    }
  }

  useEffect(() => {
    setContent([])
    setContentPage(0)
  }, [detail?.id])

  const openContent = (instance: InstanceProfile) => {
    setDetail(instance)
    setContentPage(0)
    setShowContent(true)
    void loadContent(instance)
  }

  if (!bootstrap) return null

  const filtered = bootstrap.instances.filter(instance =>
    instance.name.toLowerCase().includes(query.toLowerCase()) || instance.minecraftVersion.includes(query)
  )
  const visibleContent = content.slice(contentPage * CONTENT_PAGE_SIZE, (contentPage + 1) * CONTENT_PAGE_SIZE)
  const contentPages = Math.max(1, Math.ceil(content.length / CONTENT_PAGE_SIZE))

  const create = async () => {
    setCreating(true)
    try {
      const instance = await launcherApi.createInstance({ name, minecraftVersion: version, loader })
      await controller.refreshInstances()
      await controller.setSelectedInstance(instance.id)
      setDetail(instance)
      setShowCreate(false)
    } catch (error) {
      setError(safeMessage(error))
    } finally {
      setCreating(false)
    }
  }

  const remove = async (instance: InstanceProfile) => {
    if (!window.confirm(`Delete “${instance.name}” and its files?`)) return
    try {
      await launcherApi.deleteInstance(instance.id)
      const next = await controller.refreshInstances()
      setDetail(next[0] ?? null)
      if (next[0]) await controller.setSelectedInstance(next[0].id)
    } catch (error) {
      setError(safeMessage(error))
    }
  }

  const toggleFavorite = async (instance: InstanceProfile) => {
    try {
      const saved = await launcherApi.updateInstance({ ...instance, favorite: !instance.favorite })
      await controller.refreshInstances()
      if (detail?.id === saved.id) setDetail(saved)
    } catch (error) {
      setError(safeMessage(error))
    }
  }

  const duplicate = async (instance: InstanceProfile) => {
    try {
      const copy = await launcherApi.duplicateInstance(instance.id)
      await controller.refreshInstances()
      setDetail(copy)
      await controller.setSelectedInstance(copy.id)
    } catch (error) {
      setError(safeMessage(error))
    }
  }

  const toggleContent = async (item: InstalledContent) => {
    if (!detail) return
    setContentBusy(item.id)
    try {
      await launcherApi.toggleContent(detail.id, item.id, !item.enabled)
      setContent(current => current.map(value => value.id === item.id ? { ...value, enabled: !value.enabled } : value))
    } catch (error) {
      setError(safeMessage(error))
    } finally {
      setContentBusy(null)
    }
  }

  const updateContent = async (item: InstalledContent) => {
    if (!detail) return
    setContentBusy(item.id)
    try {
      await launcherApi.updateContent(detail.id, item.id)
      await loadContent(detail)
    } catch (error) {
      setError(safeMessage(error))
    } finally {
      setContentBusy(null)
    }
  }

  const removeContent = async (item: InstalledContent) => {
    if (!detail || !window.confirm(`Remove “${item.name}” from this profile?`)) return
    setContentBusy(item.id)
    try {
      await launcherApi.deleteContent(detail.id, item.id)
      const next = content.filter(value => value.id !== item.id)
      setContent(next)
      const lastPage = Math.max(0, Math.ceil(next.length / CONTENT_PAGE_SIZE) - 1)
      setContentPage(page => Math.min(page, lastPage))
    } catch (error) {
      setError(safeMessage(error))
    } finally {
      setContentBusy(null)
    }
  }



  return (
    <div className="page">
      <SectionHeader
        title="Library"
        action={<button className="button button--primary" onClick={() => setShowCreate(true)}><Plus size={17} /> New instance</button>}
      />

      <div className="toolbar">
        <label className="search-field"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search instances" /></label>
        <div className="toolbar__hint"><Grid2X2 size={15} /> {filtered.length} profiles</div>
      </div>

      {bootstrap.instances.length === 0 ? (
        <EmptyState icon={PackageOpen} title="No instances yet" description="Create a clean profile to start playing." action={<button className="button button--primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Create instance</button>} />
      ) : (
        <div className="library-layout">
          <div className="instance-grid">
            {filtered.map(instance => (
              <article key={instance.id} className={detail?.id === instance.id ? 'instance-card is-selected' : 'instance-card'} onClick={() => { setDetail(instance); void controller.setSelectedInstance(instance.id) }}>
                <div className="instance-card__top">
                  <span className="instance-card__art"><Layers3 size={26} /></span>
                  <button className={instance.favorite ? 'icon-button is-favorite' : 'icon-button'} aria-label={instance.favorite ? 'Remove favorite' : 'Add favorite'} onClick={event => { event.stopPropagation(); void toggleFavorite(instance) }}><Star size={15} fill={instance.favorite ? 'currentColor' : 'none'} /></button>
                </div>
                <div className="instance-card__body">
                  <h3>{instance.name}</h3>
                  <p>{instance.minecraftVersion} · {formatLoaderName(instance.loader)}</p>
                  <div className="tag-row"><span>{formatRelativeDate(instance.lastPlayedAt)}</span><span>{formatDuration(instance.playTimeSeconds)}</span></div>
                </div>
                <div className="instance-card__actions">
                  <button className="button button--small button--primary" onClick={event => { event.stopPropagation(); void controller.setSelectedInstance(instance.id); void controller.launchInstance(instance.id) }}><Play size={14} fill="currentColor" /> Play</button>
                  <button className="icon-button" onClick={event => { event.stopPropagation(); setDetail(instance); void controller.setSelectedInstance(instance.id) }} aria-label="More options"><MoreHorizontal size={17} /></button>
                </div>
              </article>
            ))}
          </div>

          {detail && (
            <aside className="instance-detail">
              <div className="instance-detail__head">
                <span className="instance-detail__icon"><Layers3 size={23} /></span>
                <div><small>Selected profile</small><h2>{detail.name}</h2><p>{detail.minecraftVersion} · {formatLoaderName(detail.loader)}</p></div>
              </div>
              <div className="instance-detail__stats">
                <span><strong>{detail.minecraftVersion}</strong><small>Version</small></span>
                <span><strong>{formatLoaderName(detail.loader)}</strong><small>Loader</small></span>
                <span><strong>{formatDuration(detail.playTimeSeconds)}</strong><small>Playtime</small></span>
              </div>
              <div className="instance-detail__buttons">
                <button className="button button--primary" onClick={() => void controller.launchInstance(detail.id)}><Play size={16} fill="currentColor" /> Launch</button>
                <button className="button button--ghost" onClick={() => void openPath(detail.directory)}><FolderOpen size={16} /> Folder</button>
                <button className="button button--soft instance-detail__content-button" onClick={() => openContent(detail)}><Package size={16} /> Installed content</button>
              </div>
              <div className="detail-section">
                <div className="detail-section__heading"><strong>Profile actions</strong></div>
                <button className="detail-action" onClick={() => void duplicate(detail)}><Copy size={15} /> Duplicate profile</button>
                <button className="detail-action detail-action--danger" onClick={() => void remove(detail)}><Trash2 size={15} /> Delete profile</button>
              </div>
            </aside>
          )}
        </div>
      )}

      {showCreate && (
        <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowCreate(false) }}>
          <div className="modal-card">
            <div className="modal-card__head"><div><h2>Create instance</h2></div><button className="icon-button" onClick={() => setShowCreate(false)}><X size={18} /></button></div>
            <div className="form-stack">
              <label><span>Name</span><input value={name} onChange={event => setName(event.target.value)} /></label>
              <label><span>Minecraft version</span><input value={version} onChange={event => setVersion(event.target.value)} /></label>
              <label><span>Mod loader</span><select value={loader} onChange={event => setLoader(event.target.value as LoaderKind)}>{loaders.map(item => <option key={item} value={item}>{formatLoaderName(item)}</option>)}</select></label>
            </div>
            <div className="modal-card__actions"><button className="button button--ghost" onClick={() => setShowCreate(false)}>Cancel</button><button className="button button--primary" disabled={creating || !name.trim() || !version.trim()} onClick={() => void create()}>{creating ? 'Creating…' : 'Create instance'}</button></div>
          </div>
        </div>
      )}

      {showContent && detail && (
        <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowContent(false) }}>
          <div className="modal-card installed-content-modal">
            <div className="modal-card__head">
              <div><span className="eyebrow">{detail.name}</span><h2>Installed content</h2></div>
              <button className="icon-button" aria-label="Close installed content" onClick={() => setShowContent(false)}><X size={18} /></button>
            </div>
            <p className="modal-subtitle">Enable, disable, update, or remove content without opening the instance folder.</p>
            {contentLoading ? (
              <div className="page-loading installed-content-modal__loading"><LoaderCircle className="spin" size={20} /> Loading installed files…</div>
            ) : content.length === 0 ? (
              <EmptyState icon={Package} title="Nothing installed" description="Install mods and packs from the Content page." />
            ) : (
              <div className="installed-content-list installed-content-list--modal">
                {visibleContent.map(item => (
                  <article key={item.id} className={item.enabled ? 'installed-content-row installed-content-row--modal' : 'installed-content-row installed-content-row--modal is-disabled'}>
                    <span className="installed-content-row__icon">{item.iconUrl ? <img src={item.iconUrl} alt="" /> : <Package size={19} />}</span>
                    <div className="installed-content-row__copy">
                      <strong>{item.name}</strong>
                      <small>{item.dependency ? 'Required dependency · ' : ''}{item.versionNumber || item.fileName}</small>
                    </div>
                    <label className="content-toggle" title={item.enabled ? 'Disable' : 'Enable'}>
                      <input type="checkbox" checked={item.enabled} disabled={contentBusy === item.id || item.kind === 'modpack'} onChange={() => void toggleContent(item)} />
                      <span />
                    </label>
                    <div className="installed-content-row__actions">
                      {item.projectId && item.updateAvailable && <button className="icon-button content-update-button" title="Update available" disabled={contentBusy === item.id} onClick={() => void updateContent(item)}>{contentBusy === item.id ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</button>}
                      <button className="icon-button icon-button--danger" title="Remove" disabled={contentBusy === item.id} onClick={() => void removeContent(item)}><Trash2 size={15} /></button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {content.length > CONTENT_PAGE_SIZE && (
              <div className="modal-pagination">
                <button className="button button--small button--ghost" disabled={contentPage === 0} onClick={() => setContentPage(page => Math.max(0, page - 1))}>Previous</button>
                <span>{contentPage + 1} / {contentPages}</span>
                <button className="button button--small button--ghost" disabled={contentPage + 1 >= contentPages} onClick={() => setContentPage(page => page + 1)}>Next</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
