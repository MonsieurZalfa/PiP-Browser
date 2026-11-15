// Real Electron integration test; web responses are fixtures, with an isolated profile.
const { app, BrowserWindow, session, globalShortcut } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { BAR_HEIGHT, FRAME_MARGIN, heightForWidth } = require('../src/core');
const profile = path.resolve(__dirname, '../.runtime/smoke-profile');
fs.mkdirSync(profile, { recursive: true });
// Make startup deterministic without touching the user's actual browser profile.
fs.writeFileSync(path.join(profile, 'windows.json'), '[{}, {}]');
app.setPath('userData', profile);
app.whenReady().then(() => {
  session.fromPartition('persist:browsing').protocol.handle('https', request => new URL(request.url).hostname === 'example.test'
    ? new Response(`<!doctype html><title>Page sans vidéo</title><body style="margin:0;padding:20px;background:#12353d;color:white"><p>Page de test</p><a id="link" href="#clicked">Lien</a><button id="button" onclick="window.buttonClicks=(window.buttonClicks||0)+1">Bouton</button><input id="input"></body>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    : new URL(request.url).pathname === '/sample.mp4'
    ? new Response(fs.readFileSync(path.join(__dirname, 'fixtures/flower.mp4')), { headers: { 'content-type': 'video/mp4' } })
    : new Response(`<!doctype html>
    <html><head><title>Lecteur de test</title></head><body style="margin:0;background:#0c1018;color:#eee;font:18px sans-serif">
    <div id="movie_player" style="height:200px;width:320px;background:black;display:grid;place-items:center">
    <video muted autoplay loop src="https://www.youtube.com/sample.mp4" style="width:100%;height:100%;object-fit:contain"></video></div>
    <script>
      window.fixtureWide = innerWidth >= 600;
      window.fixtureReparents = 0;
      addEventListener('resize', () => {
        const wide = innerWidth >= 600;
        if (wide === window.fixtureWide) return;
        window.fixtureWide = wide;
        const player = document.getElementById('movie_player');
        player.remove(); document.body.appendChild(player); window.fixtureReparents++;
      });
    </script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
});
const { recover } = require('../src/main');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let n = 0; n < 150; n++) { if (await check()) return; await delay(100); }
  throw new Error('Timed out waiting for Electron');
}
app.whenReady().then(async () => {
  try {
    await until(() => BrowserWindow.getAllWindows().length === 1 && BrowserWindow.getAllWindows().every(w => w.isVisible() && !w.webContents.isLoading() && w.contentView.children[0]?.webContents.getTitle() === 'Lecteur de test'));
    const win = BrowserWindow.getAllWindows()[0];
    const view = win.contentView.children[0];
    await delay(500);
    console.log('Runtime:', process.versions.electron, process.platform, 'visible:', win.isVisible(), 'top:', win.isAlwaysOnTop());
    const command = (name, value) => win.webContents.executeJavaScript(`window.pip.command(${JSON.stringify(name)}, ${JSON.stringify(value) ?? 'undefined'})`);
    assert.equal(BrowserWindow.getAllWindows().length, 1, 'startup must open only one window even with two saved windows');
    await command('new');
    await until(() => BrowserWindow.getAllWindows().length === 2 && BrowserWindow.getAllWindows().every(w => !w.webContents.isLoading() && w.contentView.children[0]?.webContents.getTitle() === 'Lecteur de test'));
    assert.ok(win.isAlwaysOnTop());
    assert.equal(await win.webContents.executeJavaScript("Boolean(document.querySelector('.app-icon').complete && document.querySelector('.app-icon').naturalWidth > 0)"), true, 'the GUI icon must load');
    assert.equal(view.webContents.getLastWebPreferences().nodeIntegration, false);
    assert.equal(view.webContents.getLastWebPreferences().sandbox, true);
    assert.equal(await view.webContents.executeJavaScript('typeof window.pip'), 'undefined');
    await until(() => view.webContents.executeJavaScript("document.querySelector('video').readyState >= 2"));
    assert.equal(await view.webContents.executeJavaScript("document.querySelector('video').paused"), false, 'the test video should be playing');
    let bounds = view.getBounds();
    console.log('Bounds:', win.getBounds(), win.getContentBounds(), bounds);
    assert.equal(bounds.y, BAR_HEIGHT);
    assert.equal(bounds.height, Math.round(bounds.width * 9 / 16));
    await command('opacity', .55);
    assert.ok(Math.abs(win.getOpacity() - .55) < .01);
    assert.equal(BrowserWindow.getAllWindows().find(other => other.id !== win.id).getOpacity(), 1);
    await command('opacity', 1);
    assert.ok((await command('navigate', 'file:///C:/Windows')).error);
    const videoWindowSize = win.getSize();
    await view.webContents.executeJavaScript("window.pipOriginalVideo = document.querySelector('video');");
    assert.ok(!(await command('video'))?.error, 'video mode should succeed');
    await until(() => view.webContents.executeJavaScript("document.getElementById('movie_player').matches(':popover-open')"));
    assert.deepEqual(win.getSize(), videoWindowSize, 'video mode must not resize the PiP window');
    assert.equal(win.isFullScreen(), false);
    assert.equal(await view.webContents.executeJavaScript("window.pipOriginalVideo === document.querySelector('video') && !document.querySelector('video').paused"), true, 'video mode must preserve the playing video element');
    await delay(250);
    const videoImage = await view.webContents.capturePage();
    fs.writeFileSync(path.resolve(__dirname, '../.runtime/video-mode.png'), videoImage.toPNG());
    const pixels = videoImage.toBitmap();
    const imageSize = videoImage.getSize();
    const middle = (Math.floor(imageSize.height / 2) * imageSize.width + Math.floor(imageSize.width / 2)) * 4;
    assert.ok(pixels[middle] + pixels[middle + 1] + pixels[middle + 2] > 100, 'the composited video must be visible, not black');
    // Responsive YouTube layouts can remove and reinsert the exact same player.
    // Every threshold crossing closes its popover; the mode must restore itself.
    for (const width of [384, 1000, 480, 1200, 384, 800]) {
      win.setContentSize(width, heightForWidth(width, false));
      await delay(80);
      await until(() => view.webContents.executeJavaScript("document.getElementById('movie_player').matches(':popover-open')"));
      assert.equal(await view.webContents.executeJavaScript("window.pipOriginalVideo === document.querySelector('video')"), true);
    }
    assert.ok(await view.webContents.executeJavaScript('window.fixtureReparents >= 4'));
    await view.webContents.executeJavaScript("document.getElementById('movie_player').hidePopover()");
    await until(() => view.webContents.executeJavaScript("document.getElementById('movie_player').matches(':popover-open')"));
    // Also recover if YouTube replaces the player container altogether.
    await view.webContents.executeJavaScript(`(() => {
      const old = document.getElementById('movie_player');
      const replacement = document.createElement('div'); replacement.id = 'movie_player';
      replacement.appendChild(old.querySelector('video')); old.replaceWith(replacement);
    })()`);
    await until(() => view.webContents.executeJavaScript("document.getElementById('movie_player').matches(':popover-open')"));
    await command('video');
    assert.equal(await view.webContents.executeJavaScript("document.getElementById('movie_player').hasAttribute('popover')"), false);
    await delay(100);
    assert.equal(await view.webContents.executeJavaScript("document.getElementById('movie_player').matches(':popover-open')"), false, 'normal mode must stop the repair observers');
    await command('reset-size');
    const rightClick = () => {
      view.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', x: 100, y: 100, clickCount: 1 });
      view.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', x: 100, y: 100, clickCount: 1 });
    };
    rightClick();
    await delay(500);
    assert.equal(view.getBounds().y, BAR_HEIGHT, 'one right click must not change mode');
    rightClick(); await delay(50); rightClick();
    await until(() => view.getBounds().y === FRAME_MARGIN);
    assert.equal(await view.webContents.executeJavaScript("document.getElementById('movie_player').matches(':popover-open')"), true);
    assert.equal(BrowserWindow.getAllWindows().find(other => other.id !== win.id).contentView.children[0].getBounds().y, BAR_HEIGHT, 'gesture must affect only its window');
    await delay(500);
    rightClick(); await delay(50); rightClick();
    await until(() => view.getBounds().y === BAR_HEIGHT);
    assert.equal(await view.webContents.executeJavaScript("document.getElementById('movie_player').hasAttribute('popover')"), false);
    const checkSurfaceDrag = async () => {
      await view.webContents.executeJavaScript("window.surfaceClicks=0; window.countSurfaceClick ||= (() => window.surfaceClicks++); removeEventListener('click', window.countSurfaceClick); addEventListener('click', window.countSurfaceClick);");
      const initialPosition = win.getPosition();
      const initialSize = win.getSize();
      const input = event => view.webContents.sendInputEvent({ button: 'left', clickCount: 1, globalX: initialPosition[0] + event.x, globalY: initialPosition[1] + event.y, ...event });
      input({ type: 'mouseDown', x: 100, y: 100 });
      input({ type: 'mouseUp', x: 100, y: 100 });
      await delay(50);
      assert.deepEqual(win.getPosition(), initialPosition, 'simple click must not move the window');
      assert.equal(await view.webContents.executeJavaScript('window.surfaceClicks'), 1, 'simple click must reach the page');
      input({ type: 'mouseDown', x: 100, y: 100 });
      input({ type: 'mouseMove', x: 102, y: 101, modifiers: ['leftButtonDown'] });
      input({ type: 'mouseUp', x: 102, y: 101 });
      await delay(50);
      assert.deepEqual(win.getPosition(), initialPosition, 'pointer jitter must not start a drag');
      input({ type: 'mouseDown', x: 100, y: 100 });
      input({ type: 'mouseMove', x: 125, y: 120, modifiers: ['leftButtonDown'] });
      input({ type: 'mouseUp', x: 125, y: 120 });
      await delay(50);
      assert.deepEqual(win.getPosition(), initialPosition, 'left-button dragging must remain a website interaction');
      const clicksBeforeRightDrag = await view.webContents.executeJavaScript('window.surfaceClicks');
      // A short right click followed by a drag must not count as a double click.
      const modeBeforeDrag = view.getBounds().y;
      input({ type: 'mouseDown', button: 'right', x: 100, y: 100 });
      input({ type: 'mouseUp', button: 'right', x: 100, y: 100 });
      input({ type: 'mouseDown', button: 'right', x: 100, y: 100 });
      input({ type: 'mouseMove', button: 'right', x: 125, y: 120, modifiers: ['rightButtonDown'] });
      input({ type: 'mouseUp', button: 'right', x: 125, y: 120 });
      await until(() => win.getPosition().some((coordinate, index) => coordinate !== initialPosition[index]));
      assert.equal(view.getBounds().y, modeBeforeDrag, 'dragging after a short right click must not switch modes');
      assert.ok(win.getSize().every((dimension, index) => Math.abs(dimension - initialSize[index]) <= 1), 'surface dragging must preserve size');
      assert.equal(await view.webContents.executeJavaScript('window.surfaceClicks'), clicksBeforeRightDrag, 'releasing a right drag must not click the page');
    };
    await checkSurfaceDrag();
    await command('compact');
    await checkSurfaceDrag();
    await until(() => win.webContents.executeJavaScript("document.documentElement.classList.contains('compact')"));
    const compactFrame = await win.webContents.capturePage();
    assert.ok(compactFrame.toBitmap()[3] <= 2, 'compact frame must be visually transparent');
    assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('header')).display"), 'none');
    const resizeGrip = await win.webContents.executeJavaScript("(()=>{const e=document.querySelector('[data-edge=\"bottom-right\"]'),r=e.getBoundingClientRect();return {width:r.width,height:r.height,color:getComputedStyle(e).borderRightColor};})()");
    assert.equal(resizeGrip.width, 12, 'invisible corner must keep its hit area');
    assert.equal(resizeGrip.height, 12);
    assert.equal(resizeGrip.color, 'rgba(0, 0, 0, 0)');
    bounds = view.getBounds();
    assert.equal(bounds.y, FRAME_MARGIN);
    assert.equal(bounds.height, Math.round(bounds.width * 9 / 16));
    await command('compact');
    await until(() => win.webContents.executeJavaScript("!document.documentElement.classList.contains('compact')"));
    assert.equal((await win.webContents.capturePage()).toBitmap()[3], 255, 'normal frame must return to opaque');
    await command('video');
    await checkSurfaceDrag();
    await command('compact');
    await checkSurfaceDrag();
    await command('compact');
    await command('video');
    await command('game');
    assert.ok(BrowserWindow.getAllWindows().every(w => !w.isFocusable() && w.contentView.children[0].getBounds().y === FRAME_MARGIN));
    await command('game');
    assert.ok(BrowserWindow.getAllWindows().every(w => w.isFocusable() && w.contentView.children[0].getBounds().y === BAR_HEIGHT));
    // Regression: enlarge, then shrink again during the same pointer gesture.
    for (const edge of ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      await command('reset-size');
      const initial = win.getBounds();
      await command('resize-start', { edge, x: 1000, y: 700 });
      await command('resize-move', { x: 1000 + (edge.includes('left') ? -100 : 100), y: 700 + (edge.includes('top') ? -60 : 60) });
      assert.ok(win.getBounds().width > initial.width, `enlarge from ${edge}`);
      await command('resize-move', { x: 1000 + (edge.includes('left') ? 100 : -100), y: 700 + (edge.includes('top') ? 60 : -60) });
      assert.ok(win.getBounds().width < initial.width, `shrink from ${edge}`);
      const resized = win.getContentSize();
      assert.ok(Math.abs(resized[1] - heightForWidth(resized[0], false)) <= 2);
      await command('resize-end');
    }
    await command('reset-size');
    const beforeButton = win.getBounds().width;
    await command('smaller');
    assert.ok(win.getBounds().width < beforeButton);
    await command('larger');
    assert.ok(win.getBounds().width > beforeButton * .9);
    await command('reset-size');
    assert.ok(Math.abs(win.getContentSize()[0] - 640) <= 2);
    const dragWidth = await win.webContents.executeJavaScript("document.querySelector('.drag-zone').getBoundingClientRect().width");
    assert.ok(dragWidth > 300);
    const beforeMove = win.getPosition();
    const beforeMoveSize = win.getSize();
    await command('move-start', { x: 200, y: 100 });
    for (let step = 1; step <= 40; step++) {
      await command('move-move', { x: 200 + step * 1.5, y: 100 + step });
      assert.ok(win.getSize().every((dimension, index) => Math.abs(dimension - beforeMoveSize[index]) <= 1), 'moving must not accumulate size changes (one pixel of DPI rounding is allowed)');
    }
    await command('move-end');
    const afterMove = win.getPosition();
    assert.ok(Math.abs(afterMove[0] - beforeMove[0] - 60) <= 1);
    assert.ok(Math.abs(afterMove[1] - beforeMove[1] - 40) <= 1);
    for (let gesture = 0; gesture < 20; gesture++) {
      await command('move-start', { x: 200, y: 100 });
      await command('move-move', { x: 204, y: 103 });
      await command('move-end');
      assert.ok(win.getSize().every((dimension, index) => Math.abs(dimension - beforeMoveSize[index]) <= 1), 'separate gestures must also preserve the original dimensions');
    }
    const existingIds = BrowserWindow.getAllWindows().map(w => w.id);
    await command('navigate', 'https://example.test/');
    await until(() => view.webContents.getTitle() === 'Page sans vidéo' && !view.webContents.isLoading());
    await delay(500);
    rightClick(); await delay(50); rightClick();
    await until(() => view.getBounds().y === FRAME_MARGIN);
    assert.equal(await view.webContents.executeJavaScript('Boolean(document.querySelector("video"))'), false);
    await checkSurfaceDrag();
    await delay(500);
    rightClick(); await delay(50); rightClick();
    await until(() => view.getBounds().y === BAR_HEIGHT);
    // Normal page controls retain their original click and edit behavior.
    const buttonRect = await view.webContents.executeJavaScript("(()=>{const r=document.getElementById('button').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
    view.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...buttonRect });
    view.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...buttonRect });
    await until(() => view.webContents.executeJavaScript('window.buttonClicks === 1'));
    const linkRect = await view.webContents.executeJavaScript("(()=>{const r=document.getElementById('link').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
    view.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...linkRect });
    view.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...linkRect });
    await until(() => view.webContents.getURL().endsWith('#clicked'));
    const inputRect = await view.webContents.executeJavaScript("(()=>{const r=document.getElementById('input').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
    view.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...inputRect });
    view.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...inputRect });
    await delay(30);
    await view.webContents.insertText('test');
    assert.equal(await view.webContents.executeJavaScript("document.getElementById('input').value"), 'test');
    await command('navigate', 'https://www.youtube.com/');
    await until(() => view.webContents.getTitle() === 'Lecteur de test' && !view.webContents.isLoading());
    await command('new');
    await until(() => BrowserWindow.getAllWindows().length === 3);
    BrowserWindow.getAllWindows().find(w => !existingIds.includes(w.id)).close();
    await delay(300);
    await command('video');
    await delay(500);
    const screenshot = await win.capturePage();
    fs.writeFileSync(path.resolve(__dirname, '../.runtime/prototype.png'), screenshot.toPNG());
    await command('opacity', .3);
    await command('game');
    recover();
    assert.ok(BrowserWindow.getAllWindows().every(w => w.isFocusable() && w.getOpacity() === 1 && w.contentView.children[0].getBounds().y === BAR_HEIGHT));
    assert.ok(globalShortcut.isRegistered('Ctrl+Alt+Shift+R') || globalShortcut.isRegistered('Ctrl+Shift+F12'));
    console.log('SMOKE OK: multi-window, isolated web content, 16:9, independent opacity, compact mode, game mode, recovery.');
    app.quit();
  } catch (error) { console.error(error); app.exit(1); }
});
setTimeout(() => { console.error('Smoke test timed out'); app.exit(1); }, 25000).unref();
