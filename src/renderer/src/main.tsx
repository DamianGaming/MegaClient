import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import App, { SplashWindow } from './App'
import './styles.css'

interface BoundaryState { error: Error | null }

class LauncherErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[MegaClient] Renderer error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return <StartupFailure title="MegaClient could not finish loading" detail={this.state.error.message} />
    }
    return this.props.children
  }
}

function StartupFailure({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="startup-failure">
      <section>
        <img src="./logo.png" alt="MegaClient" />
        <span>STARTUP ISSUE</span>
        <h1>{title}</h1>
        <p>{detail}</p>
        <small>Your instances and Minecraft files are safe. Reloading only restarts the launcher interface.</small>
        <div className="startup-failure-actions"><button onClick={() => typeof window.mega === 'undefined' ? window.close() : void window.mega.app.quit()}>Close</button><button onClick={() => typeof window.mega === 'undefined' ? window.location.reload() : void window.mega.app.reload()}>Reload interface</button></div>
      </section>
    </main>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('The renderer root element is missing.')

const bridgeAvailable = typeof window.mega !== 'undefined'

const splashView = new URLSearchParams(window.location.search).get('view') === 'splash'

ReactDOM.createRoot(root).render(
  <LauncherErrorBoundary>
    {bridgeAvailable
      ? splashView ? <SplashWindow /> : <App />
      : <StartupFailure title="The secure launcher bridge did not load" detail="MegaClient could not connect the interface to its desktop process." />}
  </LauncherErrorBoundary>
)
