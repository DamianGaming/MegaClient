import { readFileSync } from 'node:fs'
import path from 'node:path'

// Keep release utilities on Node 22 without requiring a TypeScript loader.
// Runtime and release checks read the same catalogue values.
export function readProtectedClientCatalog(root) {
  const catalog = readFileSync(path.join(root, 'src/main/services/protectedClientVersions.ts'), 'utf8')
  const clients = []
  for (const match of catalog.matchAll(/^  '(\d+\.\d+)': \{([\s\S]*?)^  \},?/gm)) {
    const body = match[2]
    const get = (key) => {
      const value = body.match(new RegExp(`\\b${key}: '([^']+)'`))?.[1]
      if (!value) throw new Error(`Missing ${key} in protected Minecraft ${match[1]} entry`)
      return value
    }
    clients.push({
      minecraftVersion: get('minecraftVersion'), clientVersion: get('clientVersion'),
      bundle: get('bundle'), verifier: get('verifier'),
      clientSha256: get('clientSha256'), verifierSha256: get('verifierSha256'),
      minimumFabricLoader: get('minimumFabricLoader'), minimumFabricApi: get('minimumFabricApi')
    })
    if (clients.at(-1).minecraftVersion !== match[1]) throw new Error(`Protected client catalogue mismatch: ${match[1]}`)
  }
  if (!clients.length) throw new Error('No protected client versions were configured')
  return clients
}
