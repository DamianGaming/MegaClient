import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const isWindows = process.platform === 'win32'

function executableTool(label, windowsName, unixName = label) {
  return {
    label,
    command: isWindows ? windowsName : unixName,
    prefixArgs: []
  }
}

export const gitTool = executableTool('git', 'git.exe')
export const ghTool = executableTool('gh', 'gh.exe')
export const cargoTool = executableTool('cargo', 'cargo.exe')

// npm is a .cmd shim on Windows. Spawning npm.cmd directly with shell:false can
// report ENOENT even when this script was itself started by `npm run`.
// Reuse npm's actual JavaScript entry point through the current Node executable.
export const npmTool = (() => {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath && existsSync(npmExecPath)) {
    return {
      label: 'npm',
      command: process.execPath,
      prefixArgs: [npmExecPath]
    }
  }

  if (isWindows) {
    return {
      label: 'npm',
      command: process.env.ComSpec || 'cmd.exe',
      prefixArgs: ['/d', '/s', '/c', 'npm']
    }
  }

  return {
    label: 'npm',
    command: 'npm',
    prefixArgs: []
  }
})()

export function runTool(tool, args, options = {}) {
  const fullArgs = [...tool.prefixArgs, ...args]
  if (options.log !== false) {
    console.log(`\n> ${tool.label} ${args.join(' ')}`)
  }

  const result = spawnSync(tool.command, fullArgs, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio ?? 'inherit',
    input: options.input,
    shell: false,
    env: options.env ?? process.env
  })

  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${tool.label} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`)
  }
  return result
}

export function captureTool(tool, args, options = {}) {
  const result = runTool(tool, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    allowFailure: true,
    log: false
  })

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim()
  }
}

export function requireTool(tool, displayName) {
  const result = captureTool(tool, ['--version'])
  if (!result.ok) {
    const detail = result.stderr || result.stdout
    throw new Error(
      `${displayName} is not installed or is not available in PATH.${detail ? ` ${detail}` : ''}`
    )
  }
}
