// Every protected MegaClient release is bound to a specific Minecraft/Fabric runtime.
// Keep old bundles untouched when adding another supported Minecraft version.
export const PROTECTED_CLIENTS = {
  '26.2': {
    minecraftVersion: '26.2', clientVersion: '0.14.3',
    bundle: 'megaclient.bundle', verifier: 'launch-verifier.jar',
    clientSha256: '4d97712d181e47f6851b9d53c696333af58e7c495e0705b7c4772347de3f68e7', verifierSha256: '37835a5c4dfb40ef1adf059c06780b18daa744298cdcb8238967c9f23b438537',
    minimumFabricLoader: '0.19.3', minimumFabricApi: '0.152.2', javaClassVersion: 69
  },
  '26.3': {
    minecraftVersion: '26.3', clientVersion: '0.14.3',
    bundle: 'megaclient-26.3.bundle', verifier: 'launch-verifier-26.3.jar',
    clientSha256: 'e49e9c38b9e55574961abf274f3af64a2a4fed2569a57be0f25c4c8dd27aa5c9', verifierSha256: 'e08f1b8771086c78c6b832c27250e67c76c650fa4442fe867ca2c78342c38840',
    minimumFabricLoader: '0.19.5', minimumFabricApi: '0.162.0', javaClassVersion: 69
  }
} as const

export type ProtectedMinecraftVersion = keyof typeof PROTECTED_CLIENTS
export const PROTECTED_MINECRAFT_VERSIONS = Object.keys(PROTECTED_CLIENTS) as ProtectedMinecraftVersion[]
export const LATEST_PROTECTED_MINECRAFT_VERSION: ProtectedMinecraftVersion = '26.3'

export function protectedClientFor(minecraftVersion: string) {
  if (!Object.prototype.hasOwnProperty.call(PROTECTED_CLIENTS, minecraftVersion)) {
    throw new Error(`MegaClient is only available for Minecraft ${PROTECTED_MINECRAFT_VERSIONS.join(' and ')}. Create a supported MegaClient instance.`)
  }
  return PROTECTED_CLIENTS[minecraftVersion as ProtectedMinecraftVersion]
}
