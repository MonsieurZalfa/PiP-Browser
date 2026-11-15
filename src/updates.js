function createUpdateManager({ app, autoUpdater, dialog, onChange = () => {}, beforeInstall = () => {}, enabled = true }) {
  let state = { enabled, status: enabled ? 'idle' : 'disabled', version: app.getVersion(), progress: 0 };
  let checking = null, startupTimer, periodicTimer;
  const setState = patch => { state = { ...state, ...patch }; onChange(state); };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }));
  autoUpdater.on('update-available', info => setState({ status: 'downloading', version: info.version, progress: 0 }));
  autoUpdater.on('download-progress', info => setState({ status: 'downloading', progress: Math.round(info.percent) }));
  autoUpdater.on('update-not-available', () => setState({ status: 'idle', version: app.getVersion() }));
  autoUpdater.on('update-downloaded', info => setState({ status: 'downloaded', version: info.version, progress: 100 }));
  autoUpdater.on('error', error => { console.warn('Mise à jour :', error.message); setState({ status: 'error' }); });
  async function check() {
    if (!enabled || ['downloaded', 'downloading'].includes(state.status)) return;
    if (checking) return checking;
    checking = Promise.resolve().then(() => autoUpdater.checkForUpdates()).catch(error => {
      setState({ status: 'error' }); throw error;
    }).finally(() => { checking = null; });
    return checking;
  }
  function label() {
    if (!enabled) return 'Mises à jour : application installée uniquement';
    if (state.status === 'checking') return 'Recherche de mises à jour…';
    if (state.status === 'downloading') return 'Téléchargement de la version ' + state.version + ' : ' + state.progress + ' %';
    if (state.status === 'downloaded') return 'Redémarrer pour installer la version ' + state.version;
    return 'Vérifier les mises à jour';
  }
  async function act() {
    if (!enabled) return;
    if (state.status === 'downloaded') {
      const { response } = await dialog.showMessageBox({
        type: 'question', buttons: ['Redémarrer et installer', 'Plus tard'], defaultId: 1, cancelId: 1,
        title: 'PiP Browser — Mise à jour', message: 'La version ' + state.version + ' est prête.',
        detail: 'Les fenêtres seront fermées pendant la mise à jour. Les réglages et les cookies seront conservés.',
      });
      if (response === 0) { beforeInstall(); autoUpdater.quitAndInstall(false, true); }
      return;
    }
    try {
      await check();
      await dialog.showMessageBox({
        type: state.status === 'error' ? 'warning' : 'info', title: 'PiP Browser — Mise à jour',
        message: state.status === 'error' ? 'Impossible de vérifier les mises à jour.' : state.status === 'idle' ? 'PiP Browser est à jour.' : label(),
      });
    } catch {
      await dialog.showMessageBox({
        type: 'warning', title: 'PiP Browser — Mise à jour', message: 'Impossible de vérifier les mises à jour.',
        detail: 'Vérifie ta connexion. Le dépôt de versions doit être public et contenir un installateur et son fichier latest.yml.',
      });
    }
  }
  return {
    get state() { return state; }, label, act, check,
    start() {
      if (!enabled || startupTimer || periodicTimer) return;
      startupTimer = setTimeout(() => { check().catch(() => {}); }, 10000);
      periodicTimer = setInterval(() => { check().catch(() => {}); }, 6 * 60 * 60 * 1000);
      startupTimer.unref?.(); periodicTimer.unref?.();
    },
    dispose() { clearTimeout(startupTimer); clearInterval(periodicTimer); },
  };
}
module.exports = { createUpdateManager };

