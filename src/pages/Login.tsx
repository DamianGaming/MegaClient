import { useState } from 'react'
import { ArrowRight, LoaderCircle, LogIn, ShieldCheck } from 'lucide-react'
import comet from '../assets/comet.png'
import type { LauncherController } from '../hooks/useLauncher'
import { safeMessage } from '../lib/utils'

export function LoginPage({ controller }: { controller: LauncherController }) {
  const { bootstrap } = controller
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  if (!bootstrap) return null
  const saved = bootstrap.accounts.find(account => account.active) ?? bootstrap.accounts[0]

  const beginLogin = async () => {
    setBusy(true)
    setMessage('')
    controller.setAuthError(null)
    try {
      await controller.signIn()
    } catch (error) {
      const text = safeMessage(error)
      if (!text.toLowerCase().includes('cancel')) setMessage(text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-shell login-shell--minimal">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-card__logo">
          <span><img src={comet} alt="" draggable={false} /></span>
          <div><strong>MegaClient</strong><small>Minecraft launcher</small></div>
        </div>

        <div className="login-card__copy">
          <h1 id="login-title">{saved ? `Reconnect ${saved.name}` : 'Sign in once. Play anytime.'}</h1>
          <p>
            {saved
              ? 'Microsoft needs to reconnect this saved account. Your launcher profiles and settings are already here.'
              : 'Connect your Microsoft account once. MegaClient securely remembers the session on this Windows account.'}
          </p>
        </div>

        {saved && (
          <div className="login-card__saved">
            <img src={saved.avatarUrl || comet} alt="" />
            <span><strong>{saved.name}</strong><small>Saved account</small></span>
            <ShieldCheck size={18} />
          </div>
        )}

        <button className="button button--primary login-card__button" disabled={busy} onClick={() => void beginLogin()}>
          <span>{busy ? <LoaderCircle className="spin" size={18} /> : <LogIn size={18} />}{busy ? 'Opening Microsoft…' : 'Continue with Microsoft'}</span>
          <ArrowRight size={17} />
        </button>

        <p className="login-card__note"><ShieldCheck size={14} /> Credentials are stored for the current Windows user.</p>
        {(message || controller.authError) && <div className="login-message login-message--error" role="alert">{message || controller.authError}</div>}
      </section>
    </main>
  )
}
