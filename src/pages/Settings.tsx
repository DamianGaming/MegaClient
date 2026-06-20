import { useEffect, useState } from 'react'
import {
  Check,
  Download,
  FolderOpen,
  HardDrive,
  KeyRound,
  LoaderCircle,
  MemoryStick,
  Monitor,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus
} from 'lucide-react'
import { SectionHeader } from '../components/SectionHeader'
import type { LauncherController } from '../hooks/useLauncher'
import { launcherApi, pickFolder } from '../lib/api'
import type { LauncherSettings, LauncherUpdateState } from '../lib/types'
import { safeMessage } from '../lib/utils'

export function SettingsPage({ controller }: { controller: LauncherController }) {
  const { bootstrap, setError } = controller
  const [draft, setDraft] = useState<LauncherSettings | null>(bootstrap?.settings ?? null)
  const [saving, setSaving] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)

  useEffect(() => { if (bootstrap) setDraft(bootstrap.settings) }, [bootstrap?.settings])
  if (!bootstrap || !draft) return null

  const save = async () => {
    setSaving(true)
    try {
      await controller.saveSettings(draft)
    } catch (error) {
      setError(safeMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const chooseGameDirectory = async () => {
    const path = await pickFolder(draft.gameDirectory)
    if (path) setDraft({ ...draft, gameDirectory: path })
  }

  const beginLogin = async () => {
    setAuthBusy(true)
    try {
      const account = await launcherApi.signInMicrosoft()
      await controller.finishAuthentication(account)
    } catch (error) {
      setError(safeMessage(error))
    } finally {
      setAuthBusy(false)
    }
  }

  return (
    <div className="page">
      <SectionHeader title="Settings" action={<button className="button button--primary" disabled={saving} onClick={() => void save()}><Save size={16} /> {saving ? 'Saving…' : 'Save changes'}</button>} />
      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel settings-section">
            <div className="settings-section__head"><span><MemoryStick size={19} /></span><div><h2>Minecraft runtime</h2></div></div>
            <div className="form-grid">
              <label><span>Minimum memory</span><div className="number-field"><input type="number" min={512} step={256} value={draft.minRamMb} onChange={event => setDraft({ ...draft, minRamMb: Number(event.target.value) })} /><em>MB</em></div></label>
              <label><span>Maximum memory</span><div className="number-field"><input type="number" min={1024} step={256} value={draft.maxRamMb} onChange={event => setDraft({ ...draft, maxRamMb: Number(event.target.value) })} /><em>MB</em></div></label>
              <label><span>Java executable</span><input value={draft.javaPath} onChange={event => setDraft({ ...draft, javaPath: event.target.value })} placeholder="Auto-detect" /></label>
            </div>
          </section>

          <section className="panel settings-section">
            <div className="settings-section__head"><span><HardDrive size={19} /></span><div><h2>Storage</h2></div></div>
            <label className="path-field"><span>Game data directory</span><div><input value={draft.gameDirectory} onChange={event => setDraft({ ...draft, gameDirectory: event.target.value })} /><button className="icon-button" onClick={() => void chooseGameDirectory()}><FolderOpen size={16} /></button></div></label>
          </section>

          <section className="panel settings-section">
            <div className="settings-section__head"><span><Monitor size={19} /></span><div><h2>Window</h2></div></div>
            <div className="toggle-list">
              <Toggle label="Reduced motion" description="Use fewer animations." checked={draft.reducedMotion} onChange={value => setDraft({ ...draft, reducedMotion: value })} />
              <Toggle label="Compact navigation" description="Use an icon-only sidebar." checked={draft.compactNavigation} onChange={value => setDraft({ ...draft, compactNavigation: value })} />
              <Toggle label="Show snapshots" description="Show snapshot versions." checked={draft.showSnapshots} onChange={value => setDraft({ ...draft, showSnapshots: value })} />
              <Toggle label="Minimize while playing" description="Minimize MegaClient when Minecraft starts and restore it when the game exits." checked={draft.minimizeWhilePlaying} onChange={value => setDraft({ ...draft, minimizeWhilePlaying: value })} />
              <Toggle label="Show launch console" description="Open a dismissible console when Play is pressed. It remains available after MegaClient is restored." checked={draft.showConsoleOnLaunch} onChange={value => setDraft({ ...draft, showConsoleOnLaunch: value })} />
            </div>
          </section>

          <section className="panel settings-section">
            <div className="settings-section__head"><span><RefreshCw size={19} /></span><div><h2>Updates</h2></div></div>
            <div className="toggle-list">
              <Toggle label="Check automatically" description="Check when MegaClient starts." checked={draft.autoCheckUpdates} onChange={value => setDraft({ ...draft, autoCheckUpdates: value })} />
              <Toggle label="Download automatically" description="Download updates automatically." checked={draft.autoDownloadUpdates} onChange={value => setDraft({ ...draft, autoDownloadUpdates: value, autoCheckUpdates: value ? true : draft.autoCheckUpdates })} />
            </div>
            <UpdaterStatus controller={controller} />
          </section>
        </div>

        <aside className="settings-side">
          <section className="panel account-panel">
            <div className="panel__heading"><div><span className="eyebrow">Accounts</span><h2>Microsoft sign-in</h2></div><KeyRound size={19} /></div>
            <div className="account-list">
              {bootstrap.accounts.map(account => (
                <div key={account.id} className={account.active ? 'account-row is-active' : 'account-row'}>
                  <button className="account-row__select" disabled={account.active} onClick={() => void controller.activateAccount(account.id).catch(error => setError(safeMessage(error)))}>
                    <img src={account.avatarUrl} alt="" /><span><strong>{account.name}</strong><small>{account.active ? 'Active account' : 'Switch account'}</small></span>{account.active && <Check size={15} />}
                  </button>
                  <button className="account-row__remove" aria-label={`Remove ${account.name}`} onClick={() => { if (window.confirm(`Remove ${account.name} from MegaClient?`)) void controller.removeAccount(account.id).catch(error => setError(safeMessage(error))) }}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            <button className="button button--soft" disabled={authBusy} onClick={() => void beginLogin()}><UserPlus size={16} /> {authBusy ? 'Waiting for Microsoft…' : 'Add Microsoft account'}</button>
          </section>


          <section className="panel about-panel">
            <span className="metric-icon metric-icon--pink"><ShieldCheck size={19} /></span><div><small>MegaClient</small><strong>Version {bootstrap.appVersion}</strong><p>{controller.updaterEnabled ? 'Updates enabled' : 'Development build'}</p></div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function UpdaterStatus({ controller }: { controller: LauncherController }) {
  const state = controller.updateState
  const busy = state.state === 'checking' || state.state === 'downloading' || state.state === 'installing'
  const status = updateStatusCopy(state)

  return (
    <div className={`updater-status updater-status--${state.state}`}>
      <span className="updater-status__icon">
        {busy ? <LoaderCircle className="spin" size={18} /> : state.state === 'downloaded' ? <Check size={18} /> : state.state === 'error' ? <RefreshCw size={18} /> : <ShieldCheck size={18} />}
      </span>
      <div className="updater-status__copy">
        <strong>{status.title}</strong>
        <small>{status.detail}</small>
        {state.state === 'downloading' && <div className="updater-status__progress"><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, state.percent / 100))})` }} /></div>}
      </div>
      <div className="updater-status__actions">
        {(state.state === 'idle' || state.state === 'not-available' || state.state === 'error' || state.state === 'disabled') && <button className="button button--ghost button--small" disabled={busy || !controller.updaterEnabled} onClick={() => void controller.checkForUpdates()}><RefreshCw size={14} /> Check now</button>}
        {state.state === 'available' && <button className="button button--soft button--small" onClick={() => void controller.downloadUpdate()}><Download size={14} /> Download</button>}
        {state.state === 'downloaded' && <button className="button button--primary button--small" onClick={() => void controller.installUpdate()}><RotateCcw size={14} /> Install and restart</button>}
      </div>
    </div>
  )
}

function updateStatusCopy(state: LauncherUpdateState): { title: string; detail: string } {
  switch (state.state) {
    case 'checking': return { title: 'Checking for updates…', detail: 'Checking for a new version.' }
    case 'available': return { title: `Version ${state.version} is available`, detail: state.notes || 'A new version is ready.' }
    case 'downloading': return { title: `Downloading ${Math.round(state.percent)}%`, detail: state.message || 'Downloading update.' }
    case 'downloaded': return { title: `Version ${state.version} is ready`, detail: 'Restart to finish updating.' }
    case 'installing': return { title: 'Installing update…', detail: 'MegaClient will restart.' }
    case 'not-available': return { title: 'MegaClient is up to date', detail: state.checkedAt ? `Last checked ${new Date(state.checkedAt).toLocaleString()}.` : 'No update is available.' }
    case 'error': return { title: 'Update check failed', detail: state.message || 'Check your connection and try again.' }
    case 'disabled': return { title: 'Automatic updates are not configured', detail: state.message || 'Updates are unavailable in this build.' }
    default: return { title: 'Ready to check', detail: 'Check for a new version.' }
  }
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><i /></label>
}
