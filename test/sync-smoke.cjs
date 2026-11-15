// Real Electron integration test for guild synchronisation, without network:
// a local fixture stands in for a YouTube watch page and the main process
// side of the synchronisation is simulated.
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const profile = path.resolve(__dirname, '../.runtime/sync-smoke-profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
const VIDEO = 'dQw4w9WgXcQ';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let n = 0; n < 150; n++) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}

// Byte ranges let the fixture video seek like a real streaming server.
const videoBytes = fs.readFileSync(path.join(__dirname, 'fixtures/flower.mp4'));
function videoResponse(request) {
  const match = /bytes=(d+)-(d*)/.exec(request.headers.get('range') || '');
  if (!match) return new Response(videoBytes, { headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': String(videoBytes.length) } });
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), videoBytes.length - 1) : videoBytes.length - 1;
  return new Response(videoBytes.subarray(start, end + 1), { status: 206, headers: {
    'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': String(end - start + 1),
    'content-range': `bytes ${start}-${end}/${videoBytes.length}`,
  } });
}

app.whenReady().then(async () => {
  try {
    const partition = 'sync-smoke';
    session.fromPartition(partition).protocol.handle('https', request => new URL(request.url).pathname === '/sample.mp4'
      ? videoResponse(request)
      : new Response(`<!doctype html><title>Lecteur synchro</title><body style="margin:0;background:#000">
        <div id="movie_player"><video muted src="https://www.youtube.com/sample.mp4" style="width:100%"></video></div></body>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } }));

    const reports = [];
    ipcMain.on('pip:sync-media', (_event, report) => reports.push(report));
    const win = new BrowserWindow({ width: 660, height: 420, show: true });
    const view = new WebContentsView({ webPreferences: {
      preload: path.join(__dirname, '../src/surface-preload.js'), sandbox: true, contextIsolation: true, partition,
    } });
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 640, height: 360 });
    const page = view.webContents;
    const js = code => page.executeJavaScript(code);
    await page.loadURL(`https://www.youtube.com/watch?v=${VIDEO}`);
    await until(() => js("document.querySelector('video').readyState >= 2"), 'fixture video ready');
    assert.equal(await js('typeof require'), 'undefined', 'the page must not get Electron access');

    // Without a room target, local playback is never reported.
    await js("document.querySelector('video').play()");
    await delay(300);
    await js("document.querySelector('video').pause()");
    await delay(300);
    assert.equal(reports.length, 0, 'unsynced windows must stay silent');

    // Remote state: paused at 3 s.
    page.send('pip:sync-apply', { videoId: VIDEO, playing: false, position: 3 });
    await until(() => js("Math.abs(document.querySelector('video').currentTime - 3) < 0.3"), 'seek to room position');
    assert.equal(await js("document.querySelector('video').paused"), true);

    // Remote play: the page follows and does not echo it back.
    page.send('pip:sync-apply', { videoId: VIDEO, playing: true, position: 3 });
    await until(() => js("!document.querySelector('video').paused"), 'remote play');
    await delay(600);
    assert.deepEqual(reports.filter(report => ['play', 'pause', 'seeked'].includes(report.type)), [], 'remote changes must not be echoed');

    // A local pause is reported and not undone by the drift correction.
    await js("document.querySelector('video').pause()");
    await until(() => reports.some(report => report.type === 'pause'), 'local pause report');
    const pause = reports.find(report => report.type === 'pause');
    assert.equal(pause.videoId, VIDEO);
    assert.equal(pause.playing, false);
    await delay(2600);
    assert.equal(await js("document.querySelector('video').paused"), true, 'local pause must win until the room answers');

    // Drift correction: a far local position is brought back to the room.
    page.send('pip:sync-apply', { videoId: VIDEO, playing: false, position: 1 });
    await until(() => js("Math.abs(document.querySelector('video').currentTime - 1) < 0.3"), 'drift correction');

    // Leaving the room stops all reports.
    page.send('pip:sync-apply', null);
    reports.length = 0;
    await js("document.querySelector('video').play()");
    await delay(400);
    assert.equal(reports.length, 0, 'no report after leaving the room');

    // Sync panel: renders states sent by the main process, with no Node access.
    const commands = [];
    ipcMain.handle('pip:sync-command', (_event, name, value) => { commands.push([name, value]); });
    const panel = new BrowserWindow({ width: 380, height: 620, show: true, webPreferences: {
      preload: path.join(__dirname, '../src/sync-preload.js'), sandbox: true, contextIsolation: true,
    } });
    await panel.loadFile(path.join(__dirname, '../src/sync.html'));
    const ui = code => panel.webContents.executeJavaScript(code);
    assert.equal(await ui('typeof require'), 'undefined');
    const base = { configured: true, enabled: true, status: 'ready', message: '', user: { id: 'u', name: 'Zalfa' }, rooms: [], room: null, queue: [], viewers: [], window: null };
    panel.webContents.send('pip:sync-state', { ...base, enabled: false });
    await until(() => ui("!document.getElementById('off').hidden"), 'disabled panel');
    panel.webContents.send('pip:sync-state', { ...base, status: 'signed-out' });
    await until(() => ui("!document.getElementById('signed-out').hidden"), 'sign-in panel');
    await ui("document.getElementById('sign-in').click()");
    panel.webContents.send('pip:sync-state', { ...base, rooms: [{ id: 'ABC234', name: '<img src=x onerror=alert(1)>', video_title: null, playing: false }] });
    await until(() => ui("!document.getElementById('lobby').hidden"), 'lobby');
    assert.equal(await ui("document.querySelector('#rooms li .grow').textContent"), '<img src=x onerror=alert(1)>', 'names are shown as text');
    assert.equal(await ui("document.querySelectorAll('#rooms img').length"), 0, 'names must never become HTML');
    panel.webContents.send('pip:sync-state', { ...base,
      room: { id: 'ABC234', name: 'Soirée', videoId: VIDEO, title: 'Une vidéo', playing: true, mine: false },
      queue: [{ id: 7, title: 'Suivante', added_by_name: 'Aria', mine: true }, { id: 8, title: 'Autre', added_by_name: 'Bob', mine: false }],
      viewers: ['Aria', 'Zalfa'], window: { title: 'Lecteur', videoId: VIDEO, outOfSync: false } });
    await until(() => ui("!document.getElementById('room').hidden"), 'room panel');
    assert.equal(await ui("document.getElementById('room-code').textContent"), 'ABC234');
    assert.equal(await ui("document.querySelectorAll('#queue li').length"), 2);
    assert.equal(await ui("document.querySelectorAll('#queue li')[1].querySelectorAll('button').length"), 1, 'others’ items cannot be removed');
    assert.equal(await ui("document.getElementById('viewers').textContent"), 'Aria, Zalfa');
    assert.equal(await ui("document.getElementById('share').disabled"), true, 'the room video is already shared');
    await ui("document.getElementById('queue-url').value = 'https://youtu.be/aqz-KE-bpKQ'; document.getElementById('queue-form').requestSubmit()");
    await ui("document.querySelector('#queue li button').click()");
    await delay(200);
    assert.deepEqual(commands.map(([name]) => name), ['ready', 'sign-in', 'enqueue', 'play-item']);
    assert.deepEqual(commands[2], ['enqueue', 'https://youtu.be/aqz-KE-bpKQ']);
    assert.deepEqual(commands[3], ['play-item', 7]);
    await delay(300);
    const image = await panel.webContents.capturePage();
    fs.writeFileSync(path.resolve(__dirname, '../.runtime/sync-panel.png'), image.toPNG());

    console.log('SYNC SMOKE OK: page follows room state, no echo, local actions reported, panel rendering and commands.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
