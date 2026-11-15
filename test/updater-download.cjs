const { NsisUpdater } = require('electron-updater');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
const { app } = require('electron');
const { createUpdateManager } = require('../src/updates');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const useGithub = process.argv.includes('--github');
const root = path.resolve(__dirname, '../release');
const version = require('../package.json').version;
const installer = 'PiP-Browser-Setup-' + version + '-x64.exe';
const cache = path.resolve(__dirname, '../.runtime/update-download-' + Date.now());
fs.mkdirSync(cache, { recursive: true });
app.setPath('userData', cache);
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1));
  if (!['latest.yml', installer, installer + '.blockmap'].includes(name)) { response.writeHead(404); response.end(); return; }
  const file = path.join(root, name);
  response.writeHead(200, { 'content-length': fs.statSync(file).size });
  fs.createReadStream(file).pipe(response);
});
(async () => {
  await app.whenReady();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const adapter = {
    version: '0.1.7', name: 'PiP Browser test', isPackaged: true,
    appUpdateConfigPath: path.join(root, 'win-unpacked/resources/app-update.yml'),
    userDataPath: cache, baseCachePath: cache,
    whenReady: async () => {}, onQuit() {}, quit() { throw new Error('Test must never install'); }, relaunch() {},
  };
  const updater = new NsisUpdater(null, adapter);
  updater.httpExecutor = new ElectronHttpExecutor(() => {});
  updater.setFeedURL(useGithub ? { provider: 'github', owner: 'MonsieurZalfa', repo: 'PiP-Browser' } : { provider: 'generic', url: 'http://127.0.0.1:' + server.address().port });
  updater.disableDifferentialDownload = true;
  updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
  const manager = createUpdateManager({
    app: { getVersion: () => adapter.version }, autoUpdater: updater,
    dialog: { showMessageBox() { throw new Error('No UI in download test'); } },
  });
  try {
    const result = await updater.checkForUpdates();
    assert.equal(result.isUpdateAvailable, true);
    const files = await result.downloadPromise;
    assert.equal(manager.state.status, 'downloaded');
    assert.equal(manager.state.version, version);
    const hash = file => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('hex');
    if (useGithub) {
      assert.equal(crypto.createHash('sha512').update(fs.readFileSync(files[0])).digest('base64'), result.updateInfo.files[0].sha512);
    } else assert.equal(hash(files[0]), hash(path.join(root, installer)));
    console.log((useGithub ? 'GITHUB ' : 'LOCAL ') + 'REAL UPDATE OK: detection, download, SHA-512 integrity and ready-to-restart state. Installer not executed.');
  } finally { manager.dispose(); server.close(); app.quit(); }
})().catch(error => { console.error(error); server.close(); app.exit(1); });
