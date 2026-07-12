const repository = process.env.GITHUB_REPOSITORY || ''
const [owner, repo] = repository.includes('/') ? repository.split('/') : [process.env.GH_OWNER, process.env.GH_REPO]

module.exports = {
  appId: 'studio.megastudios.megaclient',
  productName: 'MegaClient',
  artifactName: '${productName}-${version}-${arch}.${ext}',
  directories: { output: 'release' },
  files: [
    'out/**/*',
    'package.json',
    { from: 'resources/client/megaclient.bundle', to: 'resources/client/megaclient.bundle' },
    { from: 'resources/client/launch-verifier.jar', to: 'resources/client/launch-verifier.jar' }
  ],
  extraResources: [
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
    uninstallerIcon: 'resources/icons/icon.ico'
  },
  publish: owner && repo ? [{ provider: 'github', owner, repo, releaseType: 'release' }] : null
}
