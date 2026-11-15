const { app, BrowserWindow, WebContentsView, ipcMain, globalShortcut, Menu, Tray, screen, dialog, session, shell, safeStorage, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { BAR_HEIGHT, FRAME_MARGIN, MIN_WIDTH, normalizeUrl, heightForWidth, constrainResize, sanitizeSavedWindow } = require('./core');
const { setPlayerMode } = require('./player-mode');
const { createUpdateManager } = require('./updates');
const { createSyncManager, createFileStorage } = require('./sync');
const { parseYoutubeVideo, watchUrl, sanitizeSyncSettings } = require('./sync-core');

const windows = new Map();
const shortcuts = {};
let updateManager, syncManager, syncWin = null, syncTargetId = null;
let tray, lastActive, saveTimer, quitting = false, gameMode = false, allHidden = false;
const shellFile = path.join(__dirname, 'index.html');
const isYoutube = url => { try { return /(^|\.)youtube\.com$/.test(new URL(url).hostname); } catch { return false; } };
const videoCSS = `
  html:has(#movie_player:popover-open), html:has(#movie_player:popover-open) body { overflow: hidden !important; }
  #movie_player[popover]:popover-open {
    position: fixed !important; inset: 0 !important; margin: 0 !important;
    width: 100vw !important; height: 100vh !important;
    max-width: none !important; max-height: none !important;
    border: 0 !important; padding: 0 !important; transform: none !important;
    background: black !important; overflow: hidden !important;
  }
  #movie_player:popover-open::backdrop { background: black; }
  #movie_player:popover-open .html5-video-container {
    position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important;
  }
  #movie_player:popover-open video {
    width: 100% !important; height: 100% !important;
    left: 0 !important; top: 0 !important; object-fit: contain !important;
  }
`;

function statePath() { return path.join(app.getPath('userData'), 'windows.json'); }
function persist() {
  clearTimeout(saveTimer);
  try {
    const states = [...windows.values()].map(({ win, state, view, beforeGameCompact, size }) => ({
      ...state, ...win.getBounds(), width: size.width, compact: beforeGameCompact ?? state.compact, url: view.webContents.getURL() || state.url,
    }));
    fs.writeFileSync(`${statePath()}.tmp`, JSON.stringify(states, null, 2));
    fs.renameSync(`${statePath()}.tmp`, statePath());
  } catch (error) { console.error('Sauvegarde impossible :', error.message); }
}
function scheduleSave() { if (!quitting) { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 350); } }
function update(record) {
  if (record.win.isDestroyed()) return;
  const wc = record.view.webContents;
  record.win.webContents.send('pip:state', {
    ...record.state,
    url: wc.getURL() || record.state.url,
    title: wc.getTitle(),
    canGoBack: wc.navigationHistory.canGoBack(),
    youtube: isYoutube(wc.getURL()),
    shortcuts,
    updates: updateManager?.state,
    sync: { enabled: Boolean(syncManager?.state.enabled), active: record.win.id === syncTargetId, inRoom: Boolean(syncManager?.state.room) },
  });
}
function layout(record) {
  const [width, height] = record.win.getContentSize();
  const top = record.state.compact ? FRAME_MARGIN : BAR_HEIGHT;
  // Fractional Windows display scaling can round native client bounds by 1–2 px.
  // Fit the browser view itself to an exact 16:9 rectangle inside those bounds.
  const videoWidth = Math.max(1, Math.min(width - FRAME_MARGIN * 2, Math.floor(Math.max(1, height - top - FRAME_MARGIN) * 16 / 9)));
  const videoHeight = Math.round(videoWidth * 9 / 16);
  record.view.setBounds({ x: Math.floor((width - videoWidth) / 2), y: top, width: videoWidth, height: videoHeight });
}
function setWidth(record, requested) {
  const work = screen.getDisplayMatching(record.win.getBounds()).workArea;
  const chrome = (record.state.compact ? FRAME_MARGIN : BAR_HEIGHT) + FRAME_MARGIN;
  const maxWidth = Math.min(work.width, Math.floor((work.height - chrome) * 16 / 9) + FRAME_MARGIN * 2);
  const width = Math.round(Math.max(MIN_WIDTH, Math.min(requested, maxWidth)));
  record.size = { width, height: heightForWidth(width, record.state.compact) };
  record.win.setContentSize(record.size.width, record.size.height);
  layout(record);
  scheduleSave();
}
function resizeWindow(record, point) {
  const start = record.resizeStart;
  if (!start || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const proposed = {
    ...start.bounds,
    width: start.bounds.width + (start.edge.includes('left') ? -dx : dx),
    height: start.bounds.height + (start.edge.includes('top') ? -dy : dy),
  };
  const next = constrainResize(start.bounds, proposed, start.edge, record.state.compact);
  record.size = { width: next.width, height: next.height };
  // Each move is calculated from the pointer-down bounds, never from a rounded
  // intermediate Windows rectangle. This also allows reversing a drag to shrink.
  record.win.setBounds(next);
}
function startMove(record, point) {
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) record.moveStart = { ...point, bounds: { ...record.win.getBounds(), ...record.size } };
}
function moveWindow(record, point) {
  if (!record.moveStart || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const start = record.moveStart;
  // Preserve the requested size instead of reusing rounded Windows bounds.
  record.win.setBounds({ ...start.bounds, x: Math.round(start.bounds.x + point.x - start.x), y: Math.round(start.bounds.y + point.y - start.y) });
}
function setCompact(record, compact) {
  record.state.compact = compact;
  const { width } = record.size;
  record.size = { width, height: heightForWidth(width, compact) };
  record.win.setMinimumSize(MIN_WIDTH, heightForWidth(MIN_WIDTH, compact));
  record.win.setContentSize(record.size.width, record.size.height);
  layout(record);
  update(record);
  scheduleSave();
}
async function applyVideo(record) {
  const wc = record.view.webContents;
  const enable = record.state.videoOnly && isYoutube(wc.getURL());
  try {
    // The browser top layer escapes YouTube's ancestor clipping/compositing
    // contexts without moving the player node or recreating its video surface.
    if (enable && !record.cssKey) record.cssKey = await wc.insertCSS(videoCSS);
    await wc.executeJavaScript(`(${setPlayerMode.toString()})(${JSON.stringify(enable)})`, true);
    if (!enable && record.cssKey) { await wc.removeInsertedCSS(record.cssKey); record.cssKey = null; }
  } catch (error) {
    await wc.executeJavaScript(`(${setPlayerMode.toString()})(false)`).catch(() => {});
    if (record.cssKey) { await wc.removeInsertedCSS(record.cssKey).catch(() => {}); record.cssKey = null; }
    record.state.videoOnly = false;
    update(record);
    throw error;
  }
}
function queueModeChange(record, change) {
  const task = (record.modeTask || Promise.resolve()).then(change);
  record.modeTask = task.catch(() => {});
  return task;
}
function toggleVideoCompact(record) {
  return queueModeChange(record, async () => {
    if (gameMode) return;
    const wc = record.view.webContents;
    const hasPlayer = isYoutube(wc.getURL()) && await wc.executeJavaScript("Boolean(document.querySelector('#movie_player video'))");
    if (!hasPlayer) {
      if (record.state.videoOnly) { record.state.videoOnly = false; await applyVideo(record); }
      setCompact(record, !record.state.compact);
      return;
    }
    const enable = !(record.state.videoOnly && record.state.compact);
    record.state.videoOnly = enable;
    await applyVideo(record);
    setCompact(record, enable);
    update(record);
    scheduleSave();
  });
}
function setGame(enabled) {
  gameMode = enabled;
  for (const record of windows.values()) {
    if (enabled) {
      record.beforeGameCompact = record.state.compact;
      setCompact(record, true);
    } else if (record.beforeGameCompact !== undefined) {
      setCompact(record, record.beforeGameCompact);
      delete record.beforeGameCompact;
    }
    record.win.setIgnoreMouseEvents(enabled);
    record.win.setFocusable(!enabled);
    record.win.setAlwaysOnTop(true, 'screen-saver');
  }
  rebuildMenu();
}
function toggleWindows() {
  allHidden = !allHidden;
  for (const record of windows.values()) {
    delete record.moveStart;
    delete record.resizeStart;
    if (allHidden) record.win.hide();
    else record.win.showInactive();
  }
  rebuildMenu();
}
function recover() {
  allHidden = false;
  if (gameMode) setGame(false);
  let offset = 0;
  for (const record of windows.values()) {
    const work = screen.getPrimaryDisplay().workArea;
    record.win.setOpacity(1);
    record.state.opacity = 1;
    setCompact(record, false);
    setWidth(record, 640);
    record.win.setPosition(work.x + 30 + offset, work.y + 30 + offset);
    record.win.showInactive();
    offset += 35;
  }
  scheduleSave();
  rebuildMenu();
}
function targetWindow() { return windows.get(lastActive) || windows.values().next().value; }
function shortcutLabel(name) { return shortcuts[name] ? ` (${shortcuts[name]})` : ' (menu uniquement)'; }
function rebuildMenu() {
  if (!tray) return;
  tray.setToolTip(`PiP Browser${gameMode ? ' — mode jeu' : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Nouvelle fenêtre${shortcutLabel('new')}`, click: () => createWindow() },
    { label: `${allHidden ? 'Afficher' : 'Masquer'} toutes les fenêtres${shortcutLabel('visibility')}`, click: toggleWindows },
    { label: `Mode jeu — clics traversants${shortcutLabel('game')}`, type: 'checkbox', checked: gameMode, click: () => setGame(!gameMode) },
    { label: `Afficher / masquer les commandes${shortcutLabel('compact')}`, click: () => { const r = targetWindow(); if (r && !gameMode) setCompact(r, !r.state.compact); } },
    { label: `Récupérer toutes les fenêtres${shortcutLabel('recover')}`, click: recover },
    { label: 'Synchro guilde…', click: () => openSync(targetWindow()) },
    { type: 'separator' },
    ...[...windows.values()].map(record => ({ label: (record.view.webContents.getTitle() || 'YouTube').slice(0, 70), click: () => {
      if (gameMode) setGame(false);
      setCompact(record, false);
      record.win.show(); record.win.focus();
    } })),
    { type: 'separator' },
    { label: 'PiP Browser ' + app.getVersion(), enabled: false },
    { label: updateManager?.label() || 'Mises à jour', enabled: Boolean(updateManager?.state.enabled) && !['checking', 'downloading'].includes(updateManager?.state.status), click: () => updateManager?.act() },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]));
}

// Guild synchronisation ---------------------------------------------------------
function syncPath(name) { return path.join(app.getPath('userData'), name); }
function syncConfig() {
  const packaged = require('../package.json').pipSync || {};
  return {
    supabaseUrl: process.env.PIP_SYNC_SUPABASE_URL || packaged.supabaseUrl || '',
    supabaseKey: process.env.PIP_SYNC_SUPABASE_KEY || packaged.supabaseKey || '',
  };
}
function syncRecord() { return windows.get(syncTargetId) || null; }
function windowSyncInfo() {
  const record = syncRecord();
  if (!record) return null;
  const wc = record.view.webContents;
  const videoId = parseYoutubeVideo(wc.getURL());
  const roomVideo = syncManager?.state.room?.videoId;
  return { title: (wc.getTitle() || 'Fenêtre PiP').slice(0, 80), videoId, outOfSync: Boolean(roomVideo) && videoId !== roomVideo };
}
function sendSyncState() {
  if (!syncManager) return;
  if (syncWin && !syncWin.isDestroyed()) syncWin.webContents.send('pip:sync-state', { ...syncManager.state, window: windowSyncInfo() });
  for (const record of windows.values()) update(record);
}
// Applies the room state to the synced window. The window only follows a
// change of room video: if its user browses elsewhere, it stays there until
// « Revenir au salon ».
function applySyncTarget(target, force = false) {
  const record = syncRecord();
  if (!record) { sendSyncState(); return; }
  const wc = record.view.webContents;
  if (!target?.videoId) { record.syncVideo = null; wc.send('pip:sync-apply', null); sendSyncState(); return; }
  if (force || target.videoId !== record.syncVideo) {
    record.syncVideo = target.videoId;
    if (parseYoutubeVideo(wc.getURL()) !== target.videoId) {
      wc.loadURL(watchUrl(target.videoId)).catch(() => {});
      sendSyncState();
      return; // did-finish-load sends the target to the new page.
    }
  }
  wc.send('pip:sync-apply', target);
  sendSyncState();
}
function sendSyncTarget(record) {
  if (record.win.id !== syncTargetId || !syncManager) return;
  record.view.webContents.send('pip:sync-apply', syncManager.target());
}
function attachSync(record) {
  if (!record || record.win.id === syncTargetId) return;
  const previous = syncRecord();
  if (previous) { previous.view.webContents.send('pip:sync-apply', null); previous.syncVideo = null; }
  syncTargetId = record.win.id;
  applySyncTarget(syncManager?.target());
}
function openSync(record) {
  if (record) attachSync(record);
  if (syncWin && !syncWin.isDestroyed()) { syncWin.show(); syncWin.focus(); sendSyncState(); return; }
  const anchor = record?.win.getBounds();
  const work = screen.getDisplayMatching(anchor || screen.getPrimaryDisplay().workArea).workArea;
  const x = anchor ? Math.min(anchor.x + anchor.width + 8, work.x + work.width - 380) : undefined;
  syncWin = new BrowserWindow({
    icon: path.join(__dirname, '../assets/icon.ico'), title: 'Synchro guilde — PiP Browser',
    width: 380, height: 620, minWidth: 320, minHeight: 360, alwaysOnTop: true, autoHideMenuBar: true,
    ...(anchor ? { x, y: Math.max(work.y, anchor.y) } : {}),
    backgroundColor: '#10151e', maximizable: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'sync-preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  syncWin.setAlwaysOnTop(true, 'screen-saver');
  syncWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  syncWin.webContents.on('will-navigate', event => event.preventDefault());
  syncWin.on('closed', () => { syncWin = null; });
  syncWin.loadFile(path.join(__dirname, 'sync.html'));
}
function setupSync() {
  const settingsFile = syncPath('sync.json');
  let settings;
  try { settings = sanitizeSyncSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch { settings = sanitizeSyncSettings(); }
  const config = syncConfig();
  syncManager = createSyncManager({
    createClient: require('@supabase/supabase-js').createClient,
    config,
    authStorage: createFileStorage(syncPath('sync-session.bin'), safeStorage),
    settings,
    saveSettings: next => { try { fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2)); } catch (error) { console.error('Synchro :', error.message); } },
    openExternal: url => {
      // Only the sign-in page of the configured Supabase project may be opened.
      if (new URL(url).origin !== new URL(config.supabaseUrl).origin) throw new Error('Adresse de connexion inattendue.');
      return shell.openExternal(url);
    },
    onChange: sendSyncState,
    onRoomState: target => applySyncTarget(target),
  });
  syncManager.start();
}

function createWindow(saved) {
  if (windows.size >= 12) return;
  if (gameMode) setGame(false);
  const state = sanitizeSavedWindow(saved);
  const work = screen.getDisplayMatching({ x: state.x ?? 0, y: state.y ?? 0, width: state.width, height: heightForWidth(state.width, state.compact) }).workArea;
  state.width = Math.max(MIN_WIDTH, Math.min(state.width, work.width, Math.floor((work.height - (state.compact ? FRAME_MARGIN : BAR_HEIGHT) - FRAME_MARGIN) * 16 / 9) + FRAME_MARGIN * 2));
  const height = heightForWidth(state.width, state.compact);
  const offset = windows.size * 36;
  const x = Math.round(Math.max(work.x, Math.min(state.x ?? work.x + 40 + offset, work.x + work.width - state.width)));
  const y = Math.round(Math.max(work.y, Math.min(state.y ?? work.y + 40 + offset, work.y + work.height - height)));
  const win = new BrowserWindow({
    icon: path.join(__dirname, '../assets/icon.ico'),
    x, y, width: state.width, height, frame: false, thickFrame: false, resizable: false, useContentSize: true,
    minWidth: MIN_WIDTH, minHeight: heightForWidth(MIN_WIDTH, state.compact),
    alwaysOnTop: true, show: false, transparent: true, hasShadow: false, backgroundColor: '#00000000', opacity: state.opacity,
    maximizable: false, fullscreenable: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, disableHtmlFullscreenWindowResize: true },
  });
  const view = new WebContentsView({ webPreferences: {
    preload: path.join(__dirname, 'surface-preload.js'),
    nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false,
    disableHtmlFullscreenWindowResize: true, partition: 'persist:browsing',
  } });
  const record = { win, view, state, size: { width: state.width, height } };
  windows.set(win.id, record);
  lastActive = win.id;
  win.contentView.addChildView(view);
  layout(record);
  win.loadFile(shellFile);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  const wc = view.webContents;
  wc.on('before-mouse-event', (event, mouse) => {
    if (!gameMode && mouse.type === 'contextMenu') event.preventDefault();
  });
  const guardNavigation = (event, url) => { try { normalizeUrl(url); } catch { event.preventDefault(); } };
  wc.on('will-navigate', guardNavigation);
  wc.on('will-redirect', guardNavigation);
  wc.setWindowOpenHandler(({ url }) => {
    try { createWindow({ url: normalizeUrl(url) }); } catch {}
    return { action: 'deny' };
  });
  for (const event of ['did-navigate', 'did-navigate-in-page', 'did-stop-loading']) wc.on(event, () => { update(record); scheduleSave(); });
  wc.on('page-title-updated', () => { update(record); rebuildMenu(); if (win.id === syncTargetId) sendSyncState(); });
  wc.on('did-navigate-in-page', (_event, _url, isMainFrame) => { if (isMainFrame && win.id === syncTargetId) { sendSyncTarget(record); sendSyncState(); } });
  wc.on('did-finish-load', () => {
    record.cssKey = null;
    if (win.id === syncTargetId) sendSyncTarget(record);
    if (record.state.videoOnly) applyVideo(record).catch(error => console.warn('Mode vidéo :', error.message));
  });
  wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) dialog.showMessageBox(win, { type: 'error', message: 'Impossible de charger la page', detail: `${url}\n${description}\nVérifie ta connexion ou utilise une autre adresse.` });
  });
  wc.on('render-process-gone', () => dialog.showMessageBox(win, { type: 'error', message: 'Le navigateur de cette fenêtre s’est arrêté.', detail: 'Utilise ↻ pour recharger la page.' }));
  wc.loadURL(state.url).catch(() => {});
  win.once('ready-to-show', () => { if (!allHidden) win.show(); win.setAlwaysOnTop(true, 'screen-saver'); update(record); });
  win.on('show', () => { if (allHidden) { allHidden = false; rebuildMenu(); } });
  win.on('focus', () => { lastActive = win.id; win.setAlwaysOnTop(true, 'screen-saver'); });
  wc.on('focus', () => { lastActive = win.id; });
  win.on('resize', () => { layout(record); scheduleSave(); });
  win.on('move', scheduleSave);
  win.on('closed', () => {
    windows.delete(win.id);
    if (syncTargetId === win.id) { syncTargetId = null; sendSyncState(); }
    if (!wc.isDestroyed()) wc.close();
    if (!quitting && windows.size === 0) app.quit();
    else if (!quitting) { scheduleSave(); rebuildMenu(); }
  });
  rebuildMenu(); scheduleSave();
  return record;
}

ipcMain.handle('pip:command', async (event, name, value) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const record = win && windows.get(win.id);
  if (!record || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
  try {
    const wc = record.view.webContents;
    switch (name) {
      case 'updates': await updateManager?.act(); break;
      case 'ready': update(record); break;
      case 'navigate': record.state.url = normalizeUrl(value); wc.loadURL(record.state.url).catch(() => {}); break;
      case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
      case 'reload': wc.reload(); break;
      case 'new': createWindow(); break;
      case 'visibility': toggleWindows(); break;
      case 'sync': openSync(record); break;
      case 'close': win.close(); break;
      case 'smaller': setWidth(record, record.size.width * .8); break;
      case 'larger': setWidth(record, record.size.width * 1.25); break;
      case 'reset-size': setWidth(record, 640); break;
      case 'resize-start':
        if (value && ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(value.edge) && Number.isFinite(value.x) && Number.isFinite(value.y)) {
          record.resizeStart = { ...value, bounds: win.getBounds() };
        }
        break;
      case 'resize-move': resizeWindow(record, value); break;
      case 'resize-end': delete record.resizeStart; break;
      case 'move-start':
        startMove(record, value);
        break;
      case 'move-move':
        moveWindow(record, value);
        break;
      case 'move-end': delete record.moveStart; break;
      case 'opacity': if (typeof value === 'number' && Number.isFinite(value)) { record.state.opacity = Math.max(.2, Math.min(1, value)); win.setOpacity(record.state.opacity); update(record); } break;
      case 'compact': if (!gameMode) setCompact(record, !record.state.compact); break;
      case 'game': setGame(!gameMode); break;
      case 'video': if (isYoutube(wc.getURL())) await queueModeChange(record, async () => { record.state.videoOnly = !record.state.videoOnly; await applyVideo(record); update(record); }); break;
    }
    scheduleSave();
  } catch (error) { return { error: error.message }; }
});

ipcMain.on('pip:surface-drag', (event, phase, point) => {
  const record = [...windows.values()].find(item => item.view.webContents === event.sender);
  if (!record || event.senderFrame !== record.view.webContents.mainFrame || gameMode) return;
  if (phase === 'start') startMove(record, point);
  else if (phase === 'move') moveWindow(record, point);
  else if (phase === 'end') delete record.moveStart;
  else if (phase === 'toggle') toggleVideoCompact(record).catch(error => console.warn('Double clic droit :', error.message));
});

ipcMain.handle('pip:sync-command', async (event, name, value) => {
  if (!syncWin || syncWin.isDestroyed() || event.sender !== syncWin.webContents || event.senderFrame !== syncWin.webContents.mainFrame || !syncManager) return;
  const text = typeof value === 'string' ? value.slice(0, 2048) : '';
  switch (name) {
    case 'ready': break;
    case 'enable': await syncManager.setEnabled(value === true); break;
    case 'sign-in': await syncManager.signIn(); break;
    case 'sign-out': await syncManager.signOut(); break;
    case 'retry': await syncManager.retry(); break;
    case 'refresh-rooms': await syncManager.refreshRooms(); break;
    case 'create-room': if (!syncRecord()) attachSync(targetWindow()); await syncManager.createRoom(text); break;
    case 'join-room': if (!syncRecord()) attachSync(targetWindow()); await syncManager.joinRoom(text); break;
    case 'leave-room': await syncManager.leaveRoom(); break;
    case 'enqueue': await syncManager.enqueue(text); break;
    case 'remove-item': await syncManager.removeItem(value); break;
    case 'play-item': await syncManager.playItem(value); break;
    case 'next': await syncManager.next(); break;
    case 'copy-code': if (syncManager.state.room) clipboard.writeText(syncManager.state.room.id); break;
    case 'resync': applySyncTarget(syncManager.target(), true); break;
    case 'share': {
      const record = syncRecord();
      const videoId = record && parseYoutubeVideo(record.view.webContents.getURL());
      if (!videoId) break;
      const [time, playing] = await record.view.webContents.executeJavaScript(
        "(() => { const v = document.querySelector('#movie_player video'); return v ? [v.currentTime, !v.paused] : [0, true]; })()",
      ).catch(() => [0, true]);
      record.syncVideo = videoId;
      await syncManager.shareVideo(videoId, Number.isFinite(time) ? time : 0, playing === true);
      break;
    }
  }
  sendSyncState();
});

ipcMain.on('pip:sync-media', (event, report) => {
  const record = syncRecord();
  if (!record || event.sender !== record.view.webContents || event.senderFrame !== record.view.webContents.mainFrame) return;
  syncManager?.handleMedia(report);
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', recover);
  app.whenReady().then(() => {
    app.setAppUserModelId('fr.pipbrowser.desktop');
    session.fromPartition('persist:browsing').setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.fromPartition('persist:browsing').setPermissionCheckHandler(() => false);
    session.fromPartition('persist:browsing').on('will-download', event => event.preventDefault());
    tray = new Tray(path.join(__dirname, '../assets/tray.png'));
    tray.on('double-click', recover);
    const bindings = [
      ['new', ['Ctrl+Alt+N', 'Ctrl+Alt+Shift+N'], () => createWindow()],
      ['visibility', ['Ctrl+Alt+H', 'Ctrl+Alt+Shift+H'], toggleWindows],
      ['game', ['Ctrl+Alt+G', 'Ctrl+Alt+Shift+G'], () => setGame(!gameMode)],
      ['compact', ['Ctrl+Alt+B', 'Ctrl+Alt+Shift+B'], () => { const r = targetWindow(); if (r && !gameMode) setCompact(r, !r.state.compact); }],
      ['recover', ['Ctrl+Alt+Shift+R', 'Ctrl+Shift+F12'], recover],
    ];
    for (const [name, candidates, handler] of bindings) {
      shortcuts[name] = candidates.find(key => globalShortcut.register(key, handler)) || null;
    }
    updateManager = createUpdateManager({
      app, autoUpdater: require('electron-updater').autoUpdater, dialog,
      enabled: app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE,
      beforeInstall: () => { persist(); quitting = true; clearTimeout(saveTimer); },
      onChange: () => { for (const record of windows.values()) update(record); rebuildMenu(); },
    });
    updateManager.start();
    setupSync();
    let saved;
    try { saved = JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch {}
    createWindow(Array.isArray(saved) ? saved[0] : undefined);
  });
  app.on('before-quit', () => { if (!quitting) persist(); quitting = true; clearTimeout(saveTimer); });
  app.on('will-quit', () => { updateManager?.dispose(); syncManager?.dispose(); globalShortcut.unregisterAll(); });
  app.on('window-all-closed', () => app.quit());
}

module.exports = { recover };
