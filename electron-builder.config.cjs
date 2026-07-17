const repository = process.env.GITHUB_REPOSITORY || ''
const [owner, repo] = repository.includes('/') ? repository.split('/') : [process.env.GH_OWNER, process.env.GH_REPO]

module.exports = {
  appId: 'studio.megastudios.megaclient',
  productName: 'MegaClient',
  artifactName: '${productName}-${version}-${arch}.${ext}',
  directories: { output: 'release' },
  files: [
    'out/**/*',
    'package.json'
  ],
  extraResources: [
    { from: 'resources/client', to: 'resources/client' },
    { from: 'resources/discord', to: 'discord' },
    { from: 'resources/icons/icon.png', to: 'icon.png' }
  ],
  asar: true,
  compression: 'maximum',
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'resources/icons/icon.ico',
    executableName: 'MegaClient'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'MegaClient',
    deleteAppDataOnUninstall: false,
    installerIcon: 'resources/icons/icon.ico',
    uninstallerIcon: 'resources/icons/icon.ico',
    include: 'build/installer.nsh'
  },
  publish: owner && repo ? [{ provider: 'github', owner, repo, releaseType: 'release' }] : null
}
