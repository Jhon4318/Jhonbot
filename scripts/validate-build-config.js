const assert = require('node:assert/strict')
const pkg = require('../package.json')
const build = pkg.build || {}
const winTargets = Array.isArray(build.win?.target) ? build.win.target : [build.win?.target]

assert.equal(pkg.main, 'src/main.js', 'Electron entry point must remain src/main.js')
assert.ok(pkg.devDependencies?.electron, 'Electron must be available for development and packaging')
assert.ok(pkg.devDependencies?.['electron-builder'], 'electron-builder must be installed')
assert.equal(build.appId, 'com.jhonbot.bedrockbotconsole', 'appId must remain stable across upgrades')
assert.equal(build.asar, true, 'Application files should be packaged in app.asar')
assert.ok(winTargets.some(target => target?.target === 'nsis' && target.arch?.includes('x64')), 'Windows x64 NSIS target is required')
assert.equal(build.nsis?.oneClick, true, 'Installer should use one-click setup')
assert.equal(build.nsis?.perMachine, false, 'Installer should install per user')
assert.equal(build.nsis?.deleteAppDataOnUninstall, false, 'Uninstall must preserve user data')
assert.ok(build.files?.includes('src/**/*'), 'Application source must be packaged')
assert.ok(build.files?.includes('package.json'), 'Package metadata must be packaged')

console.log(`Windows installer configuration is valid for Bedrock Bot Console ${pkg.version}.`)
