import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import semver from 'semver'
import { Launcher, type Account } from 'eml-lib'
import type { LaunchProgress, LauncherInstance } from '../types'
import { getValidAccount } from './account'
import {
  MINIMUM_PROTECTED_CLIENT_LOADER,
  PROTECTED_CLIENT_VERSION,
  prepareClientPayload,
  validatePreparedClientPayload,
  type PreparedClientPayload
} from './clientPayload'
import { getInstance, updateInstance } from './instances'
import { instanceDirectory, modsDirectory } from './paths'
import { store } from './store'
import { getLoaderVersions } from './versions'
import { protectedClientFor } from './protectedClientVersions'
import { ensureRequiredMod } from './modrinth'
import { showLauncherActivity, showLaunchingActivity, showPlayingActivity } from './discordActivity'
import { setGameplayUpdatePause } from './updater'
import { setServerStatusPaused } from './servers'
import { consoleFonts } from './consoleFonts'
import {
  findGameJavaProcesses,
  runPreflightSecurity,
  scanGameJvmArguments,
  scanLoadedModules,
  scanRunningTools,
  secureChildEnvironment,
  terminateProcesses
} from './security'

const MINIMUM_CLIENT_LOADER = MINIMUM_PROTECTED_CLIENT_LOADER
export const CLIENT_VERSION = PROTECTED_CLIENT_VERSION
const ESCAPED_CLIENT_VERSION = CLIENT_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const CLIENT_VERSION_PATTERN = new RegExp(`(?:^|[\\s\\-:])megaclient(?:[\\s\\-:@]|$)[^\\r\\n]{0,80}\\b${ESCAPED_CLIENT_VERSION}\\b`, 'im')
const CLIENT_MOD_PATTERN = new RegExp(`mod\\s+megaclient\\s+${ESCAPED_CLIENT_VERSION}`, 'im')

let activeLauncher: Launcher | null = null
// Reserve the launch synchronously, before account, network and payload awaits.
// Otherwise rapid Play clicks can stage two runtimes in the same instance.
let launchReserved = false
let activeInstanceId: string | null = null
export function isInstanceLaunchActive(id: string): boolean { return launchReserved && activeInstanceId === id }
let consoleWindow: BrowserWindow | null = null
let gameTray: Tray | null = null
let securityTimer: NodeJS.Timeout | null = null
let clientVerificationTimer: NodeJS.Timeout | null = null
let securityCheckRunning = false
let consoleLines: Array<{ line: string; kind: 'info' | 'error' | 'game' | 'muted' | 'success' }> = []
let consolePending: Array<{ line: string; kind: 'info' | 'error' | 'game' | 'muted' | 'success' }> = []
let consoleFlushTimer: NodeJS.Timeout | null = null
let consoleFlushInFlight = false
let lastConsoleState = 'Preparing'
let gamePerformanceActive = false
let securityMonitorGeneration = 0
let clientVerificationGeneration = 0

function appIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'resources', 'icons', 'icon.png')
}

function emit(mainWindow: BrowserWindow, event: string, payload: unknown): void {
  if (!mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload)
}

function showMainWindow(mainWindow: BrowserWindow): void {
  if (mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createGameTray(mainWindow: BrowserWindow): void {
  if (gameTray) return
  const icon = nativeImage.createFromPath(appIconPath()).resize({ width: 32, height: 32, quality: 'best' })
  gameTray = new Tray(icon)
  gameTray.setToolTip('MegaClient · Minecraft is running')
  gameTray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open MegaClient', click: () => showMainWindow(mainWindow) },
    { label: 'Open launch console', click: () => showConsole() },
    { type: 'separator' },
    { label: 'Quit launcher', click: () => app.quit() }
  ]))
  gameTray.on('click', () => showMainWindow(mainWindow))
  gameTray.on('double-click', () => showMainWindow(mainWindow))
}

function destroyGameTray(): void {
  gameTray?.destroy()
  gameTray = null
}

function consoleHtml(iconDataUrl: string): string {
  // The launcher drives this page through #log (rows of `.line <kind>`) and #state,
  // so those hooks stay exactly as they are. Filters, search, copy and clear run
  // entirely inside the page and never touch the launch logic.
  // NOTE: this is a template literal; keep the inline script free of backticks and "${".
  const f = consoleFonts
  return `<!doctype html><html><head><meta charset="utf-8"><title>MegaClient Console</title><style>
  @font-face{font-family:Poppins;font-weight:400;src:url(data:font/woff;base64,${f.poppins400}) format("woff")}
  @font-face{font-family:Poppins;font-weight:500;src:url(data:font/woff;base64,${f.poppins500}) format("woff")}
  @font-face{font-family:Poppins;font-weight:600 800;src:url(data:font/woff;base64,${f.poppins700}) format("woff")}
  @font-face{font-family:"JetBrains Mono";font-weight:400 700;src:url(data:font/woff;base64,${f.mono400}) format("woff")}
  :root{color-scheme:dark;--bg:#090a0f;--surface:#12141c;--surface2:#171a24;--surface3:#1e2230;--surface4:#262b3c;--line:rgba(255,255,255,.07);--line2:rgba(255,255,255,.12);--text:#eef0f7;--soft:#c4c9d8;--muted:#8d93a7;--dim:#626879;--accent:#7b7bff;--accent2:#a46bff;--ok:#5fd69a;--warn:#f2b25c;--danger:#ff6b7d}
  *{box-sizing:border-box}
  html,body{width:100%;height:100%;margin:0}
  body{display:flex;flex-direction:column;overflow:hidden;color:var(--soft);font:12.5px/1.5 Poppins,"Segoe UI Variable","Segoe UI",system-ui,sans-serif;border:1px solid var(--line2);border-radius:14px;background:radial-gradient(700px 320px at 0% -10%,rgba(123,110,255,.13),transparent 60%),var(--bg);-webkit-font-smoothing:antialiased}
  ::selection{background:rgba(123,123,255,.35)}
  button,input{font:inherit;color:inherit}
  button{cursor:pointer}
  .bar{-webkit-app-region:drag;flex:0 0 auto;display:flex;align-items:center;gap:14px;height:58px;padding:0 6px 0 18px;border-bottom:1px solid var(--line)}
  .brand{display:flex;align-items:center;gap:12px;min-width:0}
  .mark{display:grid;place-items:center;width:36px;height:36px;border-radius:12px;background:rgba(123,123,255,.14);border:1px solid rgba(123,123,255,.3)}
  .mark img{width:23px;height:23px;object-fit:contain}
  .title{font-size:13.5px;font-weight:700;letter-spacing:-.01em;color:var(--text)}
  .state{display:inline-flex;align-items:center;gap:8px;height:28px;margin-left:auto;padding:0 13px;border-radius:20px;background:var(--surface);border:1px solid var(--line);color:var(--soft);font-size:11.5px;font-weight:500;white-space:nowrap}
  .state::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--warn);box-shadow:0 0 0 3px rgba(242,178,92,.16)}
  .state[data-tone=ok]::before{background:var(--ok);box-shadow:0 0 0 3px rgba(95,214,154,.18)}
  .state[data-tone=bad]::before{background:var(--danger);box-shadow:0 0 0 3px rgba(255,107,125,.18)}
  .state[data-tone=idle]::before{background:var(--dim);box-shadow:0 0 0 3px rgba(98,104,121,.2)}
  .controls{-webkit-app-region:no-drag;display:flex;align-self:stretch}
  .controls button{display:grid;place-items:center;width:46px;border:0;background:transparent;color:var(--muted);transition:background-color .12s,color .12s}
  .controls button:hover{background:rgba(255,255,255,.07);color:#fff}
  .controls button.close{border-top-right-radius:13px}
  .controls button.close:hover{background:#e5384f;color:#fff}
  .tools{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line)}
  .filters{display:inline-flex;gap:3px;padding:3px;background:#0d0f16;border:1px solid var(--line);border-radius:12px}
  .filters button{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px;border:0;background:transparent;border-radius:9px;color:var(--muted);font-size:12px;font-weight:500;transition:background-color .12s,color .12s}
  .filters button:hover{color:var(--text)}
  .filters button.on{background:var(--surface4);color:#fff;box-shadow:inset 0 0 0 1px var(--line2)}
  .filters b{min-width:20px;height:18px;padding:0 6px;display:inline-grid;place-items:center;border-radius:9px;background:rgba(255,255,255,.08);color:var(--soft);font-size:10px;font-weight:500}
  .filters button[data-f=error] b.has{background:rgba(255,107,125,.2);color:#ff9aa7}
  .search{position:relative;flex:1;min-width:120px}
  .search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--dim);pointer-events:none}
  .search input{width:100%;height:36px;padding:0 12px 0 36px;background:#0d0f16;border:1px solid var(--line2);border-radius:11px;outline:none;font-size:12px;transition:border-color .14s,box-shadow .14s}
  .search input::placeholder{color:var(--dim)}
  .search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(123,123,255,.16)}
  .act{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 14px;background:var(--surface3);border:1px solid var(--line);border-radius:11px;color:var(--text);font-size:12px;font-weight:500;transition:background-color .12s,border-color .12s}
  .act:hover{background:var(--surface4);border-color:var(--line2)}
  .act.done{color:var(--ok)}
  #log{flex:1 1 auto;min-height:0;overflow:auto;padding:10px 12px 14px;white-space:pre-wrap;word-break:break-word;font:12px/1.65 "JetBrains Mono","Cascadia Mono",ui-monospace,Consolas,monospace;scrollbar-width:thin;scrollbar-color:#2a2f40 transparent}
  #log::-webkit-scrollbar{width:10px}
  #log::-webkit-scrollbar-thumb{background:#262b3b;border-radius:10px;border:3px solid transparent;background-clip:content-box}
  .line{padding:1px 10px 1px 12px;border-left:2px solid transparent;border-radius:0 7px 7px 0}
  .line[hidden]{display:none}
  .line:hover{background:rgba(255,255,255,.035)}
  .info{color:#d3d7e2}
  .game{color:#b4beff;border-left-color:rgba(123,123,255,.45)}
  .success{color:var(--ok);border-left-color:rgba(95,214,154,.6)}
  .error{color:#ff8a99;border-left-color:var(--danger);background:rgba(255,107,125,.07)}
  .error:hover{background:rgba(255,107,125,.11)}
  .muted{color:var(--dim)}
  .empty{display:none;position:absolute;inset:0;place-content:center;justify-items:center;gap:6px;color:var(--dim);font-size:12px;pointer-events:none}
  .wrap{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
  .wrap.none .empty{display:grid}
  .foot{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;height:34px;padding:0 18px;border-top:1px solid var(--line);color:var(--dim);font-size:11px;background:rgba(255,255,255,.015)}
  .foot span{display:inline-flex;align-items:center;gap:8px}
  .foot span::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--accent)}
  </style></head><body>
  <div class="bar"><div class="brand"><span class="mark"><img src="${iconDataUrl}"/></span><span class="title">MegaClient Console</span></div><span id="state" class="state" data-tone="warn">Preparing</span><div class="controls"><button aria-label="Minimise" onclick="window.mega.consoleWindow.minimize()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg></button><button aria-label="Maximise" onclick="window.mega.consoleWindow.maximize()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/></svg></button><button class="close" aria-label="Close" onclick="window.mega.consoleWindow.close()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>
  <div class="tools"><div class="filters" id="filters"><button class="on" data-f="all">All <b id="c-all">0</b></button><button data-f="game">Game <b id="c-game">0</b></button><button data-f="error">Errors <b id="c-error">0</b></button></div><label class="search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="q" type="text" placeholder="Search output" spellcheck="false"/></label><button class="act" id="copy">Copy</button><button class="act" id="clear">Clear</button></div>
  <div class="wrap" id="wrap"><div id="log"></div><div class="empty"><span>No matching lines</span></div></div>
  <div class="foot"><span id="foot">Live output</span><span style="margin-left:auto">Latest 900 lines</span></div>
  <script>
  (function(){
    var log=document.getElementById('log'),wrap=document.getElementById('wrap'),q=document.getElementById('q');
    var kind='all',term='',NL=String.fromCharCode(10);
    function kindOf(el){var l=['info','error','game','muted','success'];for(var i=0;i<l.length;i++){if(el.classList.contains(l[i]))return l[i]}return 'info'}
    function apply(el){var k=kindOf(el);var okK=kind==='all'||(kind==='game'&&k==='game')||(kind==='error'&&k==='error');var okT=!term||el.textContent.toLowerCase().indexOf(term)!==-1;el.hidden=!(okK&&okT)}
    function counts(){
      var all=log.children.length,g=log.getElementsByClassName('game').length,e=log.getElementsByClassName('error').length,shown=0,i;
      for(i=0;i<log.children.length;i++){if(!log.children[i].hidden)shown++}
      document.getElementById('c-all').textContent=all;document.getElementById('c-game').textContent=g;
      var eb=document.getElementById('c-error');eb.textContent=e;eb.className=e?'has':'';
      wrap.className=all&&!shown?'wrap none':'wrap';
      document.getElementById('foot').textContent=(term||kind!=='all')?(shown+' of '+all+' lines shown'):'Live output';
    }
    function refresh(){for(var i=0;i<log.children.length;i++)apply(log.children[i]);counts()}
    new MutationObserver(function(ms){ms.forEach(function(m){for(var i=0;i<m.addedNodes.length;i++){var n=m.addedNodes[i];if(n.nodeType===1)apply(n)}});counts()}).observe(log,{childList:true});
    document.getElementById('filters').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;kind=b.getAttribute('data-f');var all=this.children;for(var i=0;i<all.length;i++)all[i].classList.toggle('on',all[i]===b);refresh();log.scrollTop=log.scrollHeight});
    q.addEventListener('input',function(){term=q.value.trim().toLowerCase();refresh()});
    function flash(btn,text){var old=btn.getAttribute('data-l')||btn.textContent;btn.setAttribute('data-l',old);btn.textContent=text;btn.classList.add('done');setTimeout(function(){btn.textContent=old;btn.classList.remove('done')},1200)}
    document.getElementById('copy').addEventListener('click',function(){
      var rows=[],i;for(i=0;i<log.children.length;i++){if(!log.children[i].hidden)rows.push(log.children[i].textContent)}
      var t=document.createElement('textarea');t.value=rows.join(NL);t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();
      var ok=false;try{ok=document.execCommand('copy')}catch(err){}document.body.removeChild(t);flash(this,ok?'Copied':'Copy failed');
    });
    document.getElementById('clear').addEventListener('click',function(){log.replaceChildren();counts();flash(this,'Cleared')});
    var st=document.getElementById('state');
    function tone(){var t=(st.textContent||'').toLowerCase();st.setAttribute('data-tone',/crash|error|fail/.test(t)?'bad':/run|play|live|started/.test(t)?'ok':/clos|exit|stop|ended|finish/.test(t)?'idle':'warn')}
    new MutationObserver(tone).observe(st,{childList:true,characterData:true,subtree:true});tone();counts();
  })();
  </script></body></html>`
}

function flushConsole(): void {
  consoleFlushTimer = null
  if (!consoleWindow || consoleWindow.isDestroyed() || !consoleWindow.isVisible() || consoleWindow.isMinimized()) {
    consolePending = []
    return
  }
  if (!consolePending.length || consoleFlushInFlight) return
  const batch = consolePending.splice(0, consolePending.length)
  consoleFlushInFlight = true
  const target = consoleWindow
  const script = `(() => { const log=document.getElementById('log'); const rows=${JSON.stringify(batch)}; const frag=document.createDocumentFragment(); for(const entry of rows){const row=document.createElement('div');row.className='line '+entry.kind;row.textContent=entry.line;frag.appendChild(row)} log.appendChild(frag); while(log.childElementCount>900)log.firstElementChild?.remove(); log.scrollTop=log.scrollHeight; })()`
  void target.webContents.executeJavaScript(script).catch(() => undefined).finally(() => {
    consoleFlushInFlight = false
    // Apply backpressure: never queue concurrent DOM injections for fast log streams.
    if (consolePending.length && consoleWindow === target && !target.isDestroyed() && target.isVisible()) {
      if (!consoleFlushTimer) consoleFlushTimer = setTimeout(flushConsole, gamePerformanceActive ? 180 : 75)
    }
  })
}

function queueConsole(entries: typeof consolePending): void {
  // Fabric can emit thousands of log lines. Keep history bounded and avoid DOM
  // work while the console is hidden or minimised so it cannot compete with the
  // game for CPU/GPU time.
  if (!consoleWindow || consoleWindow.isDestroyed() || !consoleWindow.isVisible() || consoleWindow.isMinimized()) return
  consolePending.push(...entries)
  if (consolePending.length > 400) consolePending = consolePending.slice(-300)
  if (!consoleFlushTimer) consoleFlushTimer = setTimeout(flushConsole, gamePerformanceActive ? 500 : 140)
}

function replayConsole(): void {
  if (!consoleWindow || consoleWindow.isDestroyed()) return
  consolePending = []
  void consoleWindow.webContents.executeJavaScript("document.getElementById('log')?.replaceChildren()").then(() => {
    queueConsole(consoleLines.slice(-900))
  }).catch(() => undefined)
}

function showConsole(): BrowserWindow {
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.show()
    consoleWindow.focus()
    return consoleWindow
  }
  const iconImage = nativeImage.createFromPath(appIconPath())
  consoleWindow = new BrowserWindow({
    width: 940,
    height: 580,
    minWidth: 680,
    minHeight: 400,
    show: false,
    frame: false,
    transparent: false,
    roundedCorners: true,
    title: 'MegaClient Console',
    backgroundColor: '#090a0f',
    icon: appIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  void consoleWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(consoleHtml(iconImage.toDataURL()))}`)
  consoleWindow.once('ready-to-show', () => {
    consoleWindow?.show()
    setConsoleState(lastConsoleState)
  })
  consoleWindow.on('show', replayConsole)
  consoleWindow.on('restore', replayConsole)
  consoleWindow.on('closed', () => {
    consoleWindow = null
    consolePending = []
    if (consoleFlushTimer) clearTimeout(consoleFlushTimer)
    consoleFlushTimer = null
  })
  return consoleWindow
}

function appendConsole(line: string, kind: 'info' | 'error' | 'game' | 'muted' | 'success' = 'info'): void {
  const entry = { line, kind }
  consoleLines.push(entry)
  if (consoleLines.length > 1400) consoleLines = consoleLines.slice(-1000)
  queueConsole([entry])
}

function setConsoleState(state: string): void {
  lastConsoleState = state
  if (!consoleWindow || consoleWindow.isDestroyed()) return
  void consoleWindow.webContents.executeJavaScript(`document.getElementById('state').textContent=${JSON.stringify(state)}`).catch(() => undefined)
}

async function resolveLoader(instance: LauncherInstance): Promise<LauncherInstance> {
  if (instance.loader === 'vanilla') return instance
  // A chosen older loader or imported modpack is pinned for compatibility.
  // Only auto-managed profiles (including the protected client) track stable
  // compatible builds. If a validated installed choice exists, offline launches
  // still work when the version service is temporarily unreachable.
  const refresh = instance.customClient || instance.autoUpdateLoader === true || !instance.loaderVersion
  if (!refresh) return instance

  const minLoader = instance.customClient ? protectedClientFor(instance.minecraftVersion).minimumFabricLoader : MINIMUM_CLIENT_LOADER
  const oldVersion = instance.loaderVersion?.trim()
  const canUseOffline = oldVersion !== undefined && (!instance.customClient ||
    (instance.loader === 'fabric' && semver.valid(oldVersion) !== null && semver.gte(oldVersion, minLoader)))
  let versions: string[]
  try {
    versions = await getLoaderVersions(instance.loader, instance.minecraftVersion)
  } catch (error) {
    if (canUseOffline) return instance
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not resolve ${instance.loader} for Minecraft ${instance.minecraftVersion}: ${detail}`)
  }

  const version = instance.customClient
    ? versions.find((candidate) => semver.valid(candidate) !== null && semver.gte(candidate, minLoader))
    : versions[0]
  if (!version) {
    if (instance.customClient) throw new Error(`MegaClient ${CLIENT_VERSION} requires Fabric Loader ${minLoader} or newer for Minecraft ${instance.minecraftVersion}.`)
    throw new Error(`No compatible ${instance.loader} loader was found for Minecraft ${instance.minecraftVersion}.`)
  }
  if (oldVersion === version) return instance
  return updateInstance(instance.id, { loaderVersion: version })
}

async function prepareCustomClient(instance: LauncherInstance, mainWindow: BrowserWindow): Promise<PreparedClientPayload | null> {
  if (!instance.customClient) return null

  const client = protectedClientFor(instance.minecraftVersion)
  const mods = modsDirectory(instance.slug)
  await fs.mkdir(mods, { recursive: true })
  const modNames = await fs.readdir(mods).catch(() => [] as string[])
  await Promise.all(modNames
    .filter((name) => /^megaclient(?:[-_.].*)?\.jar(?:\.disabled)?$/i.test(name))
    .map((name) => fs.rm(path.join(mods, name), { force: true }).catch(() => undefined)))

  // Resolve required Modrinth dependencies before staging the private runtime.
  // This keeps the decrypted client on disk for the shortest possible time.
  emit(mainWindow, 'launch:progress', { phase: 'client', message: 'Installing required client files' } satisfies LaunchProgress)
  appendConsole('[MegaClient] Resolving required Fabric dependencies', 'muted')
  try {
    const fabricApi = await ensureRequiredMod(instance.id, 'P7dR8mSH', (message, progress) => {
      emit(mainWindow, 'launch:progress', { phase: 'client', message, progress } satisfies LaunchProgress)
    }, 24 * 60 * 60_000, client.minimumFabricApi)
    appendConsole(`[MegaClient] Fabric API ${fabricApi.versionNumber ?? 'compatible build'} is ready`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    appendConsole(`[MegaClient] Dependency setup failed: ${message}`, 'error')
    throw new Error(`MegaClient could not install its required Fabric API dependency. ${message}`)
  }

  emit(mainWindow, 'launch:progress', { phase: 'client', message: 'Preparing MegaClient' } satisfies LaunchProgress)
  appendConsole('[MegaClient] Decrypting and verifying the protected runtime', 'muted')
  const payload = await prepareClientPayload(instance.slug, instance.minecraftVersion, (done, total) => {
    emit(mainWindow, 'launch:progress', { phase: 'client', message: `Checking existing mods (${done}/${total})` } satisfies LaunchProgress)
    setConsoleState(`Checking mods (${done}/${total})`)
  })
  try {
    emit(mainWindow, 'launch:progress', { phase: 'client', message: 'Verifying MegaClient runtime' } satisfies LaunchProgress)
    await validatePreparedClientPayload(payload, instance.minecraftVersion)
    appendConsole(`[MegaClient] Protected runtime prepared for Fabric Loader ${instance.loaderVersion}`, 'success')
    return payload
  } catch (error) {
    await payload.cleanup()
    throw error
  }
}

function stopSecurityMonitor(): void {
  securityMonitorGeneration++
  if (securityTimer) clearTimeout(securityTimer)
  securityTimer = null
  securityCheckRunning = false
}

function stopClientVerification(): void {
  clientVerificationGeneration++
  if (clientVerificationTimer) clearTimeout(clientVerificationTimer)
  clientVerificationTimer = null
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function setElectronPriority(active: boolean): void {
  const priority = active
    ? os.constants.priority.PRIORITY_BELOW_NORMAL
    : os.constants.priority.PRIORITY_NORMAL
  for (const metric of app.getAppMetrics()) {
    try { os.setPriority(metric.pid, priority) } catch { /* unsupported/protected process */ }
  }
}

export function isGamePerformanceModeActive(): boolean { return gamePerformanceActive }

function setGamePerformanceMode(mainWindow: BrowserWindow, active: boolean): void {
  if (gamePerformanceActive === active) return
  gamePerformanceActive = active
  setGameplayUpdatePause(active)
  setServerStatusPaused(active)
  setElectronPriority(active)

  // Background throttling remains enabled so hidden launcher windows do not
  // continuously render while Minecraft owns the foreground/GPU.
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.setBackgroundThrottling(true)
    mainWindow.webContents.send('launcher:performance-mode', active)
  }
  if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.webContents.setBackgroundThrottling(true)

  appendConsole(
    active
      ? '[Performance] Game mode active: launcher priority lowered and background network activity paused.'
      : '[Performance] Game mode ended: normal launcher activity restored.',
    'muted'
  )
}

function startSecurityMonitor(mainWindow: BrowserWindow, instance: LauncherInstance): void {
  stopSecurityMonitor()
  const generation = securityMonitorGeneration
  let gameProcesses: Awaited<ReturnType<typeof findGameJavaProcesses>> = []
  let jvmArgumentsChecked = false
  let nextToolScanAt = 0
  let nextModuleScanAt = Date.now() + 45_000
  let stopped = false

  const schedule = (delay: number): void => {
    if (stopped || generation !== securityMonitorGeneration) return
    securityTimer = setTimeout(() => void run(), delay)
    securityTimer.unref()
  }

  const run = async (): Promise<void> => {
    if (stopped || generation !== securityMonitorGeneration) return
    if (securityCheckRunning) {
      schedule(30_000)
      return
    }
    securityCheckRunning = true
    let foundViolation = false
    try {
      gameProcesses = gameProcesses.filter((item) => Boolean(item.ProcessId && processIsAlive(item.ProcessId)))
      if (!gameProcesses.length) gameProcesses = await findGameJavaProcesses(instance)

      const processIds = gameProcesses.map((item) => item.ProcessId ?? 0).filter((id) => id > 0)
      const jvmFindings = !jvmArgumentsChecked && gameProcesses.length
        ? scanGameJvmArguments(gameProcesses)
        : []
      if (gameProcesses.length) jvmArgumentsChecked = true

      // Exact process identities are checked infrequently with lightweight
      // Get-Process. Loaded module inspection is deliberately rare because
      // enumerating every native module can produce noticeable Windows spikes.
      const now = Date.now()
      let toolFindings: Awaited<ReturnType<typeof scanRunningTools>> = []
      if (now >= nextToolScanAt) {
        nextToolScanAt = now + 5 * 60_000
        toolFindings = await scanRunningTools('runtime')
      }
      let moduleFindings: Awaited<ReturnType<typeof scanLoadedModules>> = []
      if (processIds.length && now >= nextModuleScanAt) {
        nextModuleScanAt = now + 15 * 60_000
        moduleFindings = await scanLoadedModules(processIds)
      }

      const finding = [...jvmFindings, ...toolFindings, ...moduleFindings][0]
      if (finding) {
        foundViolation = true
        stopped = true
        const message = `${finding.title}: ${finding.detail}`
        appendConsole(`[Security] ${message}`, 'error')
        setConsoleState('Launch protection stopped the game')
        emit(mainWindow, 'launch:error', { message })
        await terminateProcesses(processIds)
        stopSecurityMonitor()
      }
    } catch (error) {
      appendConsole(`[Security] Monitor warning: ${error instanceof Error ? error.message : String(error)}`, 'muted')
    } finally {
      securityCheckRunning = false
    }
    if (!foundViolation && !stopped && generation === securityMonitorGeneration) schedule(120_000)
  }

  schedule(10_000)
}

function clientLoadedInText(text: string): boolean {
  return /\[MegaClient verifier\] Protected client origin and SHA-256 verified/i.test(text)
    || CLIENT_VERSION_PATTERN.test(text)
    || /loaded\s+mod[^\r\n]*\bmegaclient\b/im.test(text)
    || CLIENT_MOD_PATTERN.test(text)
}

function clientFailureFromLog(text: string): string | null {
  // Do not reinterpret another legitimate mod's own compatibility error as a
  // protected-client failure. Only lines that explicitly identify MegaClient or
  // its verifier can fail the protected-client check.
  const lines = text.split(/\r?\n/).filter((line) => /megaclient(?:-launch-verifier)?/i.test(line))
  const failure = lines.find((line) => /error|failed|incompatible|requires|could not find|required mod|resolution failed/i.test(line))
  return failure?.trim().slice(0, 600) ?? null
}

interface ClientVerificationMarker {
  mod?: string
  version?: string
  nonce?: string
  sha256?: string
  originVerified?: boolean
  verified?: boolean
}

async function readTextTail(file: string, maximumBytes = 256 * 1024): Promise<string> {
  const stat = await fs.stat(file)
  const length = Math.min(stat.size, maximumBytes)
  if (length <= 0) return ''
  const handle = await fs.open(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, stat.size - length))
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function readClientMarker(payload: PreparedClientPayload): Promise<boolean> {
  try {
    const marker = JSON.parse(await fs.readFile(payload.markerPath, 'utf8')) as ClientVerificationMarker
    return marker.mod === 'megaclient'
      && marker.version === CLIENT_VERSION
      && marker.nonce === payload.markerNonce
      && marker.sha256 === payload.sha256
      && marker.originVerified === true
      && marker.verified === true
  } catch {
    return false
  }
}

function startClientVerification(
  mainWindow: BrowserWindow,
  instance: LauncherInstance,
  payload: PreparedClientPayload,
  verificationStartedAt: number,
  hasSeenClient: () => boolean,
  markClientSeen: () => void
): void {
  stopClientVerification()
  const generation = clientVerificationGeneration
  const deadline = verificationStartedAt + 240_000
  const logFallbackAt = verificationStartedAt + 15_000
  const latestLog = path.join(instanceDirectory(instance.slug), 'logs', 'latest.log')
  let nextLogReadAt = verificationStartedAt + 8_000
  let lastLogStamp = ''

  const finishSuccess = (source: 'marker' | 'log'): void => {
    stopClientVerification()
    markClientSeen()
    appendConsole(
      source === 'marker'
        ? `[MegaClient] MegaClient ${CLIENT_VERSION} was verified inside the running Fabric client`
        : `[MegaClient] MegaClient ${CLIENT_VERSION} was confirmed in Fabric's active mod output`,
      'success'
    )
    emit(mainWindow, 'launch:progress', { phase: 'client', message: `MegaClient ${CLIENT_VERSION} loaded`, progress: 1 } satisfies LaunchProgress)
  }

  const failClosed = async (detail: string): Promise<void> => {
    stopClientVerification()
    const message = `MegaClient ${CLIENT_VERSION} did not load correctly. ${detail}`
    appendConsole(`[MegaClient] ${message}`, 'error')
    setConsoleState('MegaClient failed to load')
    emit(mainWindow, 'launch:error', { message })
    const processes = await findGameJavaProcesses(instance)
    await terminateProcesses(processes.map((item) => item.ProcessId ?? 0))
  }

  const poll = async (): Promise<void> => {
    if (generation !== clientVerificationGeneration) return
    if (await readClientMarker(payload)) {
      finishSuccess('marker')
      return
    }

    // Fabric logs can be very busy with large modpacks. Read only a small tail
    // and only when the file actually changed, rather than reading 256 KB every
    // 1.5 seconds for the entire protected-client verification window.
    if (Date.now() >= nextLogReadAt) {
      nextLogReadAt = Date.now() + 8_000
      const stat = await fs.stat(latestLog).catch(() => null)
      if (stat && stat.mtimeMs >= verificationStartedAt - 2_000) {
        const stamp = `${stat.size}:${Math.trunc(stat.mtimeMs)}`
        if (stamp !== lastLogStamp) {
          lastLogStamp = stamp
          const log = await readTextTail(latestLog, 64 * 1024).catch(() => '')
          if (clientLoadedInText(log)) markClientSeen()
          const failure = clientFailureFromLog(log)
          if (failure) {
            await failClosed(`Fabric reported: ${failure}`)
            return
          }
        }
      }
    }

    if (hasSeenClient() && Date.now() >= logFallbackAt) {
      finishSuccess('log')
      return
    }

    if (Date.now() >= deadline) {
      await failClosed("Neither the runtime verifier nor Fabric's active mod list confirmed the protected client. The game was stopped instead of silently starting plain Fabric.")
      return
    }

    clientVerificationTimer = setTimeout(() => void poll().catch((error) => {
      if (generation !== clientVerificationGeneration) return
      appendConsole(`[MegaClient] Verification warning: ${error instanceof Error ? error.message : String(error)}`, 'muted')
      clientVerificationTimer = setTimeout(() => void poll(), 2_000)
    }), 2_000)
  }

  clientVerificationTimer = setTimeout(() => void poll(), 2_000)
}

function serverGameArgs(address?: string): string[] {
  const value = address?.trim()
  if (!value) return []
  const match = value.match(/^(.+?)(?::(\d{1,5}))?$/)
  if (!match) throw new Error('The partner server address is invalid.')
  const host = match[1]!
  const port = match[2] ? Number(match[2]) : undefined
  if (port != null && (port < 1 || port > 65535)) throw new Error('The partner server port is invalid.')
  return ['--server', host, ...(port ? ['--port', String(port)] : [])]
}

export async function launchInstance(mainWindow: BrowserWindow, instanceId: string, serverAddress?: string): Promise<void> {
  if (activeLauncher || launchReserved) throw new Error('Minecraft is already being launched by MegaClient.')
  launchReserved = true
  activeInstanceId = instanceId
  let stagedPayload: PreparedClientPayload | null = null
  try {
  const settings = store.getData().settings
  consoleLines = []
  consolePending = []
  if (settings.showConsole) showConsole()
  const reportSetup = (phase: string, message: string): void => {
    emit(mainWindow, 'launch:progress', { phase, message } satisfies LaunchProgress)
    appendConsole(`[MegaClient] ${message}`, 'info')
    setConsoleState(message)
  }
  reportSetup('profile', 'Loading selected Minecraft profile')
  appendConsole(`[MegaClient] Starting ${new Date().toLocaleString()}`, 'muted')
  if (serverAddress) appendConsole(`[MegaClient] Direct connection: ${serverAddress}`, 'muted')

  let instance = getInstance(instanceId)
  if (instance.customClient) {
    protectedClientFor(instance.minecraftVersion)
    if (instance.loader !== 'fabric') throw new Error('MegaClient profiles require Fabric Loader.')
  }
  reportSetup('profile', `Checking ${instance.loader === 'vanilla' ? 'Minecraft' : instance.loader + ' loader'} compatibility`)
  instance = await resolveLoader(instance)
  appendConsole(`[MegaClient] Profile ready: Minecraft ${instance.minecraftVersion} · ${instance.loader}${instance.loaderVersion ? ' ' + instance.loaderVersion : ''}`, 'success')
  showLaunchingActivity(instance, serverAddress)

  reportSetup('security', 'Checking launch security and installed mods')
  appendConsole('[Security] Checking high-confidence blocked identities without restricting legitimate native mods', 'muted')
  await runPreflightSecurity(instance, (done, total) => {
    emit(mainWindow, 'launch:progress', { phase: 'security', message: `Checking installed mods (${done}/${total})`, progress: total ? done / total : undefined } satisfies LaunchProgress)
    setConsoleState(`Checking mods (${done}/${total})`)
  })
  appendConsole('[Security] Preflight checks completed', 'success')

  reportSetup('account', 'Verifying Microsoft game session')
  const account: Account = await getValidAccount(mainWindow)
  appendConsole(`[MegaClient] Microsoft session ready for ${account.name}`, 'success')
  reportSetup('client', instance.customClient ? 'Preparing protected MegaClient files' : 'Preparing Minecraft launch')
  const clientPayload = await prepareCustomClient(instance, mainWindow)
  stagedPayload = clientPayload
  const javaArgs = ['-Dmegaclient.launcher=true']
  if (instance.loader === 'fabric') javaArgs.push('-Dfabric.debug.disableModShuffle=true')
  if (clientPayload) {
    javaArgs.push(`-Dmegaclient.payload.sha256=${clientPayload.sha256}`)
    javaArgs.push(`-Dmegaclient.payload.path=${clientPayload.jarPath.replaceAll('\\', '/')}`)
    javaArgs.push(`-Dmegaclient.marker=${clientPayload.markerPath}`)
    javaArgs.push(`-Dmegaclient.marker.nonce=${clientPayload.markerNonce}`)
    appendConsole(`[MegaClient] Staged the protected client in this isolated instance (${clientPayload.sha256.slice(0, 12)}…)`, 'success')
  }

  if (instance.customClient) {
    await fs.rm(path.join(instanceDirectory(instance.slug), 'logs', 'latest.log'), { force: true }).catch(() => undefined)
  }

  reportSetup('prepare', `Starting Minecraft ${instance.minecraftVersion} setup`)
  const launcher = new Launcher({
    root: 'megaclient',
    storage: 'isolated',
    profile: {
      slug: instance.slug,
      minecraft: {
        version: instance.minecraftVersion,
        loader: instance.loader === 'vanilla'
          ? { loader: 'vanilla' }
          : { loader: instance.loader, version: instance.loaderVersion },
        args: serverGameArgs(serverAddress)
      }
    },
    cleaning: { enabled: false },
    account,
    memory: { min: settings.memoryMin, max: settings.memoryMax },
    window: { width: settings.width, height: settings.height, fullscreen: settings.fullscreen },
    java: settings.javaMode === 'manual'
      ? { install: 'manual', absolutePath: settings.javaPath, args: javaArgs }
      : { install: 'auto', args: javaArgs }
  })
  activeLauncher = launcher
  // Pause launcher-owned network/background work before Minecraft begins its
  // own downloads and connections, preventing an update scan from starting
  // during a long Fabric preparation phase.
  setGamePerformanceMode(mainWindow, true)

  let payloadCleaned = false
  let gameSpawned = false
  let sessionFinalized = false
  let clientObserved = false
  let gameStartedAt = Date.now()
  const cleanupPayload = async (): Promise<void> => {
    if (payloadCleaned) return
    payloadCleaned = true
    await clientPayload?.cleanup()
  }

  let lastProgressSent = 0
  const progress = (phase: string, message: string, value?: number): void => {
    const payload: LaunchProgress = { phase, message, progress: value }
    emit(mainWindow, 'launch:progress', payload)
    appendConsole(`[MegaClient] ${message}`, 'info')
    setConsoleState(message)
  }

  launcher.on('launch_compute_download', () => progress('prepare', 'Checking game files'))
  launcher.on('launch_download', ({ total }) => progress('download', `Preparing ${total.amount} downloads`))
  launcher.on('download_progress', ({ downloaded, total, speed }) => {
    const now = Date.now()
    if (now - lastProgressSent < 120 && downloaded.size < total.size) return
    lastProgressSent = now
    const value = total.size ? downloaded.size / total.size : undefined
    emit(mainWindow, 'launch:progress', {
      phase: 'download', message: 'Downloading game files', progress: value,
      downloaded: downloaded.size, total: total.size, speed
    } satisfies LaunchProgress)
    setConsoleState('Downloading')
    if (total.size && downloaded.size >= total.size) appendConsole('[MegaClient] Game file downloads complete', 'success')
  })
  launcher.on('download_error', ({ filename, message }) => appendConsole(`[Download] ${filename}: ${String(message)}`, 'error'))
  launcher.on('launch_install_loader', ({ type, minecraftVersion, loaderVersion }) => progress('loader', `Installing ${type === 'VANILLA' ? 'Minecraft' : `${type} ${loaderVersion}`} for ${minecraftVersion}`))
  launcher.on('launch_check_java', () => progress('java', 'Checking the required Java runtime'))
  launcher.on('java_info', ({ version, arch }) => appendConsole(`[Java] ${version} (${arch})`, 'muted'))
  launcher.on('launch_copy_assets', () => progress('assets', 'Preparing Minecraft assets'))
  launcher.on('launch_extract_natives', () => progress('natives', 'Extracting native libraries'))
  launcher.on('launch_patch_loader', () => progress('loader', 'Finalising the mod loader'))
  launcher.on('launch_launch', () => {
    gameSpawned = true
    if (clientPayload) {
      // Validated before spawn; do not synchronously re-read megabytes of JARs
      // inside EML's process-spawn event.
      appendConsole('[MegaClient] Fabric can read the verified runtime JARs', 'success')
    }
    gameStartedAt = Date.now()
    setGamePerformanceMode(mainWindow, true)
    progress('launch', serverAddress ? 'Joining partner server' : 'Minecraft is running', 1)
    setConsoleState('Minecraft running')
    showPlayingActivity(instance, serverAddress, gameStartedAt)
    startSecurityMonitor(mainWindow, instance)
    if (instance.customClient && clientPayload) {
      startClientVerification(mainWindow, instance, clientPayload, Date.now(), () => clientObserved, () => { clientObserved = true })
    }
    if (settings.minimizeToTrayOnLaunch) {
      createGameTray(mainWindow)
      mainWindow.hide()
    }
  })
  launcher.on('launch_data', (line) => {
    const cleaned = line.replace(/\r?\n$/, '')
    if (!cleaned) return
    if (!clientObserved && clientLoadedInText(cleaned)) clientObserved = true
    appendConsole(cleaned, 'game')
  })
  launcher.on('launch_debug', (line) => {
    const isFinalCommand = line.startsWith('Launching Minecraft with args:')
    if (isFinalCommand && instance.customClient && clientPayload) {
      const normalisedLine = line.replaceAll('\\', '/')
      const expectedClientPath = clientPayload.jarPath.replaceAll('\\', '/')
      const hasMarker = normalisedLine.includes('-Dmegaclient.marker=')
        && normalisedLine.includes('-Dmegaclient.marker.nonce=')
        && normalisedLine.includes('-Dmegaclient.payload.path=')
        && normalisedLine.includes(expectedClientPath)
      if (!hasMarker) {
        throw new Error('The final Java command did not contain the protected MegaClient verification arguments.')
      }
      appendConsole('[MegaClient] Confirmed protected runtime verification arguments in the final Java command', 'success')
      appendConsole('[Launcher] Final Java command prepared (protected paths hidden)', 'muted')
      return
    }
    appendConsole(line, 'muted')
  })
  launcher.on('launch_crash', (data) => {
    appendConsole(`[Crash] ${JSON.stringify(data)}`, 'error')
    emit(mainWindow, 'launch:crash', data)
  })
  // EML's launch() starts a separate Java process. Its Promise can settle while
  // Minecraft is still booting, so never delete the protected Fabric JARs or
  // re-enable background updater traffic from launch()'s finally block.
  const finishGameSession = async (code?: number | null): Promise<void> => {
    if (sessionFinalized) return
    sessionFinalized = true
    stopSecurityMonitor()
    stopClientVerification()
    setGamePerformanceMode(mainWindow, false)
    destroyGameTray()
    showMainWindow(mainWindow)
    showLauncherActivity(instance)
    if (code != null) {
      setConsoleState(code === 0 ? 'Finished' : `Exited (${code})`)
    }
    // Windows can hold an open handle to a just-terminated Java process.
    // cleanupPayload() already retries locked files and remains idempotent.
    try { await cleanupPayload() } catch (error) {
      appendConsole(`[MegaClient] Could not remove a temporary runtime file: ${String(error)}`, 'muted')
    } finally {
      if (activeLauncher === launcher) activeLauncher = null
      launchReserved = false
      activeInstanceId = null
      // Report closure after protected files are cleaned and Play can be used again.
      if (code != null) emit(mainWindow, 'launch:closed', { code })
    }
  }

  launcher.on('launch_close', (code) => {
    void finishGameSession(code)
  })

  let restoreEnvironment: (() => void) | null = null
  try {
    restoreEnvironment = secureChildEnvironment()
    // Give Chromium a turn to paint the final preparation status before EML
    // enters its installation pipeline (which may include synchronous setup).
    await new Promise<void>((resolve) => setImmediate(resolve))
    await launcher.launch()
    await updateInstance(instance.id, { lastPlayedAt: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    appendConsole(`[Error] ${message}`, 'error')
    setConsoleState('Launch failed')
    // The IPC launch handler emits this error to the renderer once.
    // Only launch_close can safely release a runtime after process spawn.
    if (!gameSpawned) await finishGameSession()
    throw error
  } finally {
    restoreEnvironment?.()
    // No Minecraft process was ever spawned, so there will be no close event.
    // Otherwise launch_close is the only owner of protected runtime cleanup.
    if (!gameSpawned) await finishGameSession()
  }
  } catch (error) {
    // Also recover failures before a Launcher is constructed, such as an
    // unavailable account, invalid loader metadata or failed Fabric setup.
    if (!activeLauncher) {
      appendConsole(`[Error] ${error instanceof Error ? error.message : String(error)}`, 'error')
      setConsoleState('Launch failed')
      if (stagedPayload) {
        try { await stagedPayload.cleanup() } catch { /* best effort */ }
      }
      launchReserved = false
      activeInstanceId = null
      setGamePerformanceMode(mainWindow, false)
      showLauncherActivity()
    }
    throw error
  }
}

export function openLaunchConsole(): void {
  showConsole()
}
