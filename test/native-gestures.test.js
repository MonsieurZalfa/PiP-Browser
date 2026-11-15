const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRightGesture } = require('../src/native-gestures');
function harness() {
  let time = 0; const calls = [];
  const g = createRightGesture({ start:p=>calls.push(['start',p]), move:p=>calls.push(['move',p]), end:()=>calls.push(['end']), toggle:()=>calls.push(['toggle']), now:()=>time });
  return { calls, cancel:g.cancel, send(type, data={}) { time+=40; let blocked=false; g.handle({preventDefault(){blocked=true;}},{type,button:'right',globalX:100,globalY:100,...data});return blocked; } };
}
test('native Twitch double right click toggles only after two releases',()=>{
  const h=harness();h.send('mouseDown');h.send('mouseUp');h.send('mouseDown');assert.equal(h.calls.length,0);h.send('mouseUp');assert.deepEqual(h.calls,[['toggle']]);
});
test('a short right click followed by a drag never toggles mode',()=>{
  const h=harness();h.send('mouseDown');h.send('mouseUp');h.send('mouseDown');h.send('mouseMove',{globalX:140,globalY:130,modifiers:['rightButtonDown']});h.send('mouseUp');assert.deepEqual(h.calls.map(c=>c[0]),['start','move','end']);assert.deepEqual(h.calls[1][1],{x:140,y:130});
});
test('native gesture leaves left input untouched and cancellation stops dragging',()=>{
  const h=harness();assert.equal(h.send('mouseDown',{button:'left'}),false);h.send('mouseDown');h.send('mouseMove',{globalX:130,modifiers:['rightButtonDown']});h.cancel();h.send('mouseMove',{globalX:170});assert.deepEqual(h.calls.map(c=>c[0]),['start','move','end']);
});
