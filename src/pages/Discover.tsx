import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  Package,
  Power,
  RefreshCw,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { EmptyState } from '../components/EmptyState'
import { SectionHeader } from '../components/SectionHeader'
import type { LauncherController } from '../hooks/useLauncher'
import { launcherApi } from '../lib/api'
import type { ContentKind, InstalledContent, ModrinthProject, ModrinthVersion } from '../lib/types'
import { formatCompactNumber, formatLoaderName, safeMessage } from '../lib/utils'

const PAGE_SIZE = 18
const VERSION_PAGE_SIZE = 7
const kinds: Array<{ id: ContentKind; label: string }> = [
  { id: 'mod', label: 'Mods' },
  { id: 'modpack', label: 'Modpacks' },
  { id: 'resourcepack', label: 'Resource packs' },
  { id: 'shader', label: 'Shaders' }
]
const categories = [
  { value: '', label: 'All categories' },
  { value: 'optimization', label: 'Optimization' },
  { value: 'technology', label: 'Technology' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'decoration', label: 'Decoration' },
  { value: 'magic', label: 'Magic' },
  { value: 'utility', label: 'Utility' },
  { value: 'worldgen', label: 'World generation' }
]

type ContentView = 'browse' | 'installed'

export function DiscoverPage({ controller }: { controller: LauncherController }) {
  const { selectedInstance, setError } = controller
  const [view, setView] = useState<ContentView>('browse')
  const [kind, setKind] = useState<ContentKind>('mod')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [results, setResults] = useState<ModrinthProject[]>([])
  const [loading, setLoading] = useState(false)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [installedContent, setInstalledContent] = useState<InstalledContent[]>([])
  const [installedLoading, setInstalledLoading] = useState(false)
  const [versionProject, setVersionProject] = useState<ModrinthProject | null>(null)
  const [versions, setVersions] = useState<ModrinthVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionPage, setVersionPage] = useState(0)
  const searchRequest = useRef(0)

  const selectedLabel = useMemo(() => kinds.find(item => item.id === kind)?.label ?? 'Content', [kind])
  const managedItems = useMemo(
    () => installedContent.filter(item => item.kind === kind),
    [installedContent, kind]
  )

  const loadInstalled = async () => {
    if (!selectedInstance) {
      setInstalledContent([])
      setInstalledIds(new Set())
      return
    }
    setInstalledLoading(true)
    try {
      const items = await launcherApi.listContent(selectedInstance.id)
      setInstalledContent(items)
      setInstalledIds(new Set(items.flatMap(item => item.projectId ? [item.projectId] : [])))
    } catch (error) {
      setError(safeMessage(error))
    } finally {
      setInstalledLoading(false)
    }
  }

  const search = async (pageNumber = page) => {
    const requestId = ++searchRequest.current
    setLoading(true)
    try {
      const projects = await launcherApi.search({
        query: query.trim(),
        projectType: kind,
        gameVersion: selectedInstance?.minecraftVersion,
        loader: selectedInstance?.loader,
        category: category || undefined,
        offset: (pageNumber - 1) * PAGE_SIZE,
        limit: PAGE_SIZE
      })
      if (requestId !== searchRequest.current) return
      setResults(projects)
      setHasNextPage(projects.length === PAGE_SIZE)
    } catch (error) {
      if (requestId === searchRequest.current) setError(safeMessage(error))
    } finally {
      if (requestId === searchRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    setPage(1)
  }, [kind, category, selectedInstance?.id])

  useEffect(() => {
    const timer = window.setTimeout(() => void search(page), query ? 300 : 80)
    return () => window.clearTimeout(timer)
  }, [kind, category, page, selectedInstance?.id, query])

  useEffect(() => {
    void loadInstalled()
  }, [selectedInstance?.id])

  const install = async (project: ModrinthProject, versionId?: string) => {
    if (!selectedInstance) {
      setError('Select an instance first.')
      return
    }
    setInstalling(versionId ?? project.id)
    try {
      await launcherApi.installContent({
        instanceId: selectedInstance.id,
        projectId: project.id,
        versionId,
        kind: project.projectType
      })
      await loadInstalled()
      if (versionId) setVersionProject(null)
    } catch (error) {
      setError(safeMessage(error))
    } finally {
      setInstalling(null)
    }
  }

  const openVersions = async (project: ModrinthProject) => {
    setVersionProject(project)
    setVersions([])
    setVersionPage(0)
    setVersionsLoading(true)
    try {
      const items = await launcherApi.projectVersions(
        project.id,
        selectedInstance?.minecraftVersion,
        selectedInstance?.loader
      )
      setVersions(items)
    } catch (error) {
      setError(safeMessage(error))
      setVersionProject(null)
    } finally {
      setVersionsLoading(false)
    }
  }

  const toggleInstalled = async (item: InstalledContent) => {
    if (!selectedInstance) return
    try {
      await launcherApi.toggleContent(selectedInstance.id, item.id, !item.enabled)
      await loadInstalled()
    } catch (error) {
      setError(safeMessage(error))
    }
  }

  const updateInstalled = async (item: InstalledContent) => {
    if (!selectedInstance) return
    setInstalling(item.id)
    try {
      await launcherApi.updateContent(selectedInstance.id, item.id)
      await loadInstalled()
    } catch (error) {
      setError(safeMessage(error))
    } finally {
      setInstalling(null)
    }
  }

  const removeInstalled = async (item: InstalledContent) => {
    if (!selectedInstance || !window.confirm(`Remove “${item.name}”?`)) return
    try {
      await launcherApi.deleteContent(selectedInstance.id, item.id)
      await loadInstalled()
    } catch (error) {
      setError(safeMessage(error))
    }
  }

  return (
    <div className="page">
      <SectionHeader
        title="Content"
        action={<div className="compatibility-chip"><span className="status-dot" /> {selectedInstance ? `${selectedInstance.minecraftVersion} · ${formatLoaderName(selectedInstance.loader)}` : 'Select an instance'}</div>}
      />

      <div className="content-view-tabs" role="tablist" aria-label="Content pages">
        <button className={view === 'browse' ? 'is-active' : ''} onClick={() => setView('browse')}>Browse</button>
        <button className={view === 'installed' ? 'is-active' : ''} onClick={() => setView('installed')}>Installed <span>{installedContent.length}</span></button>
      </div>

      <div className="discover-tabs">
        {kinds.map(item => (
          <button key={item.id} className={kind === item.id ? 'is-active' : ''} onClick={() => setKind(item.id)}>{item.label}</button>
        ))}
      </div>

      {view === 'browse' ? (
        <>
          <div className="discover-searchbar discover-searchbar--expanded">
            <label className="search-field search-field--large">
              <Search size={18} />
              <input value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder={`Search ${selectedLabel.toLowerCase()}`} />
            </label>
            <select value={category} onChange={event => setCategory(event.target.value)} aria-label="Category">
              {categories.map(item => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
            </select>
            <button className="button button--primary" onClick={() => void search(1)}><Search size={16} /> Search</button>
          </div>

          {!selectedInstance && <div className="inline-notice">Select an instance to filter compatibility and install content.</div>}

          {results.length === 0 && !loading ? (
            <EmptyState icon={Package} title="No results" description="Try a different search or category." />
          ) : (
            <div className="project-grid">
              {results.map(project => {
                const done = installedIds.has(project.id)
                const busy = installing === project.id
                return (
                  <article className="project-card" key={project.id}>
                    <div className="project-card__image">
                      {project.iconUrl ? <img src={project.iconUrl} alt="" loading="lazy" /> : <Package size={28} />}
                    </div>
                    <div className="project-card__body">
                      <div><h3>{project.title}</h3><span>{project.author}</span></div>
                      <p>{project.description}</p>
                      <div className="tag-row">{project.categories.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div>
                    </div>
                    <div className="project-card__footer project-card__footer--actions">
                      <span><Download size={14} /> {formatCompactNumber(project.downloads)}</span>
                      <div>
                        <button className="button button--small button--ghost" disabled={!selectedInstance} onClick={() => void openVersions(project)}>Versions</button>
                        <button className={done ? 'button button--small button--success' : 'button button--small button--soft'} disabled={busy || done || !selectedInstance} onClick={() => void install(project)}>
                          {done ? <><Check size={14} /> Installed</> : busy ? <><LoaderCircle className="spin" size={14} /> Installing</> : 'Install'}
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          <div className="pagination-bar">
            <button className="button button--ghost button--small" disabled={page === 1 || loading} onClick={() => setPage(current => Math.max(1, current - 1))}><ChevronLeft size={15} /> Previous</button>
            <span>Page {page}</span>
            <button className="button button--ghost button--small" disabled={!hasNextPage || loading} onClick={() => setPage(current => current + 1)}>Next <ChevronRight size={15} /></button>
          </div>
        </>
      ) : (
        <section className="installed-content-page">
          {!selectedInstance ? (
            <EmptyState icon={Package} title="No instance selected" description="Choose an instance from the launch bar." />
          ) : installedLoading ? (
            <div className="page-loading"><LoaderCircle className="spin" size={22} /> Loading content…</div>
          ) : managedItems.length === 0 ? (
            <EmptyState icon={Package} title={`No ${selectedLabel.toLowerCase()} installed`} description="Browse Modrinth to add content." action={<button className="button button--primary" onClick={() => setView('browse')}>Browse</button>} />
          ) : (
            <div className="installed-content-list">
              {managedItems.map(item => (
                <article key={item.id} className={item.enabled ? 'installed-content-row' : 'installed-content-row is-disabled'}>
                  <span className="installed-content-row__icon">{item.iconUrl ? <img src={item.iconUrl} alt="" /> : <Package size={19} />}</span>
                  <div className="installed-content-row__copy">
                    <strong>{item.name}</strong>
                    <small>{item.versionNumber || item.fileName}</small>
                  </div>
                  <span className={item.enabled ? 'state-pill is-on' : 'state-pill'}>{item.enabled ? 'Enabled' : 'Disabled'}</span>
                  <div className="installed-content-row__actions">
                    {item.kind !== 'modpack' && <button className="icon-button" title={item.enabled ? 'Disable' : 'Enable'} onClick={() => void toggleInstalled(item)}><Power size={15} /></button>}
                    {item.projectId && item.updateAvailable && <button className="icon-button content-update-button" title="Update available" disabled={installing === item.id} onClick={() => void updateInstalled(item)}>{installing === item.id ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</button>}
                    <button className="icon-button icon-button--danger" title="Remove" onClick={() => void removeInstalled(item)}><Trash2 size={15} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {versionProject && (
        <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setVersionProject(null) }}>
          <div className="modal-card version-modal">
            <div className="modal-card__head">
              <div><span className="eyebrow">Choose version</span><h2>{versionProject.title}</h2></div>
              <button className="icon-button" onClick={() => setVersionProject(null)}><X size={18} /></button>
            </div>
            <div className="version-list">
              {versionsLoading ? (
                <div className="page-loading"><LoaderCircle className="spin" size={20} /> Loading versions…</div>
              ) : versions.length === 0 ? (
                <p className="quiet-copy">No compatible versions found.</p>
              ) : versions.slice(versionPage * VERSION_PAGE_SIZE, (versionPage + 1) * VERSION_PAGE_SIZE).map(version => (
                <div key={version.id} className="version-row">
                  <div><strong>{version.versionNumber}</strong><small>{version.name}</small></div>
                  <span>{version.gameVersions.slice(0, 2).join(', ')}</span>
                  <button className="button button--small button--soft" disabled={installing === version.id} onClick={() => void install(versionProject, version.id)}>
                    {installing === version.id ? 'Installing…' : 'Install'}
                  </button>
                </div>
              ))}
            </div>
            {!versionsLoading && versions.length > VERSION_PAGE_SIZE && (
              <div className="modal-pagination">
                <button className="button button--small button--ghost" disabled={versionPage === 0} onClick={() => setVersionPage(page => Math.max(0, page - 1))}><ChevronLeft size={14} /> Previous</button>
                <span>{versionPage + 1} / {Math.ceil(versions.length / VERSION_PAGE_SIZE)}</span>
                <button className="button button--small button--ghost" disabled={(versionPage + 1) * VERSION_PAGE_SIZE >= versions.length} onClick={() => setVersionPage(page => page + 1)}>Next <ChevronRight size={14} /></button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
