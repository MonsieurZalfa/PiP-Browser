const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateManager } = require('../src/updates');
function setup(enabled = true) {
  const updater = new EventEmitter(), messages = [];
  let checks = 0, installs = 0, saves = 0, answer = 1;
  updater.checkForUpdates = async () => { checks++; updater.emit('checking-for-update'); updater.emit('update-not-available'); };
  updater.quitAndInstall = () => { installs++; assert.equal(saves, 1); };
  const manager = createUpdateManager({
    app: { getVersion: () => '0.2.0' }, autoUpdater: updater, enabled,
    dialog: { showMessageBox: async options => { messages.push(options); return { response: answer }; } },
    beforeInstall: () => { saves++; },
  });
  return { updater, manager, messages, get checks() { return checks; }, get installs() { return installs; }, answer: value => { answer = value; } };
}
test('development and portable builds never check or install', async () => {
  const x = setup(false); x.manager.start(); await x.manager.check(); await x.manager.act();
  assert.equal(x.checks, 0); assert.equal(x.installs, 0); assert.equal(x.messages.length, 0); x.manager.dispose();
});
test('concurrent checks are deduplicated and normal quit does not install', async () => {
  const x = setup(); await Promise.all([x.manager.check(), x.manager.check()]);
  assert.equal(x.checks, 1); assert.equal(x.updater.autoDownload, true); assert.equal(x.updater.autoInstallOnAppQuit, false);
  x.updater.emit('update-available', { version: '0.2.1' }); x.updater.emit('download-progress', { percent: 52.4 });
  assert.equal(x.manager.state.progress, 52); await x.manager.check(); assert.equal(x.checks, 1);
});
test('installation requires confirmation and saves the session first', async () => {
  const x = setup(); x.updater.emit('update-downloaded', { version: '0.2.1' });
  await x.manager.act(); assert.equal(x.installs, 0);
  x.answer(0); await x.manager.act(); assert.equal(x.installs, 1);
});
test('failed checks can be retried and manual failures show an explanation', async () => {
  const x = setup(); x.updater.checkForUpdates = async () => { throw new Error('offline'); };
  await x.manager.act(); assert.equal(x.manager.state.status, 'error'); assert.match(x.messages[0].message, /Impossible/);
  x.updater.checkForUpdates = async () => { x.updater.emit('update-not-available'); };
  await x.manager.check(); assert.equal(x.manager.state.status, 'idle');
});

