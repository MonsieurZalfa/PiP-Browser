const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { FRAME_MARGIN, BAR_HEIGHT, heightForWidth } = require('../src/core');
const profile = path.resolve('.runtime/twitch-smoke-profile');
fs.mkdirSync(profile,{recursive:true}); app.setPath('userData',profile);
fs.writeFileSync(path.join(profile,'windows.json'),JSON.stringify([{url:'https://www.twitch.tv/fixture',layoutVersion:2}]));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<100;i++){if(await fn())return;await delay(50);}throw Error('Timeout: '+label);}
app.whenReady().then(()=>session.fromPartition('persist:browsing').protocol.handle('https',request=>{
  const url=new URL(request.url);
  if(url.pathname==='/sample.mp4')return new Response(fs.readFileSync(path.join(__dirname,'fixtures/flower.mp4')),{headers:{'content-type':'video/mp4'}});
  const framed=url.pathname==='/framed';
  const media=framed ? '<iframe src="https://player.twitch.tv/inner" style="width:100%;height:100%;border:0"></iframe>' : '<div class="video-ref"><video autoplay muted loop src="https://www.twitch.tv/sample.mp4"></video></div>';
  return new Response('<!doctype html><title>Twitch fixture</title><body style="background:#192028;color:white"><header>Navigation et chat Twitch</header><div class="channel-root channel-root--theatre-mode"><div data-a-target="video-player" class="video-player" style="width:420px;height:240px"><div class="video-player__container" style="max-height:150px">'+media+'</div></div></div><script>window.rightEvents=0;for(const type of ["pointerdown","mousedown"])addEventListener(type,e=>{if(e.button===2){window.rightEvents++;e.stopImmediatePropagation();}},true);</script></body>',{headers:{'content-type':'text/html'}});
}));
require('../src/main');
app.whenReady().then(async()=>{try{
  await until(()=>BrowserWindow.getAllWindows().some(w=>w.contentView.children[0]?.webContents.getTitle()==='Twitch fixture'),'initial page');
  const win=BrowserWindow.getAllWindows().find(w=>w.contentView.children[0]?.webContents.getTitle()==='Twitch fixture'),view=win.contentView.children[0],wc=view.webContents;
  const js=code=>wc.executeJavaScript(code);
  const click=()=>{wc.sendInputEvent({type:'mouseDown',button:'right',x:100,y:100,clickCount:1});wc.sendInputEvent({type:'mouseUp',button:'right',x:100,y:100,clickCount:1});};
  const toggle=async()=>{await delay(500);click();await delay(40);click();};
  for(const route of ['fixture','framed']){
    if(route==='framed'){await wc.loadURL('https://www.twitch.tv/framed');}
    await until(()=>js('Boolean(document.querySelector("video,iframe"))'),'media');
    assert.equal(await js('typeof window.pip'),'undefined');
    await toggle();
    await until(()=>view.getBounds().y===FRAME_MARGIN,'compact on');
    await until(()=>js('Boolean(document.querySelector("[data-pip-browser-player]:popover-open"))'),'player on');
    assert.equal(await js('document.querySelector(".channel-root").classList.contains("channel-root--theatre-mode")'),true,'existing studio layout must be preserved');
    for(const width of [400,950,640]){win.setContentSize(width,heightForWidth(width,true));await delay(120);assert.equal(await js('Boolean(document.querySelector("[data-pip-browser-player]:popover-open"))'),true);}
    const before=win.getBounds();
    wc.sendInputEvent({type:'mouseDown',button:'right',x:100,y:100,globalX:500,globalY:500,clickCount:1});
    wc.sendInputEvent({type:'mouseMove',button:'right',x:160,y:140,globalX:560,globalY:540,modifiers:['rightButtonDown']});
    wc.sendInputEvent({type:'mouseUp',button:'right',x:160,y:140,globalX:560,globalY:540,clickCount:1});
    await until(()=>Math.abs(win.getBounds().x-before.x-60)<=1,'native move');
    assert.ok(Math.abs(win.getBounds().y-before.y-40)<=1);
    assert.ok(Math.abs(win.getBounds().width-before.width)<=1);
    assert.equal(await js('window.rightEvents'),0,'Twitch must not intercept reserved right gestures');
    await toggle();await until(()=>view.getBounds().y===BAR_HEIGHT,'normal mode');
    assert.equal(await js('Boolean(document.querySelector("[data-pip-browser-player]"))'),false);
    assert.equal(await js('document.querySelector(".channel-root").classList.contains("channel-root--theatre-mode")'),true);
  }
  console.log('TWITCH OK: native gestures, direct and iframe player, studio layout, resize, restore, no page bridge.');app.quit();
}catch(e){console.error(e);app.exit(1);}});
setTimeout(()=>app.exit(1),25000).unref();
