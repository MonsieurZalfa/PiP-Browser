const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSyncManager } = require('../src/sync');

const VIDEO_A = 'dQw4w9WgXcQ';
const VIDEO_B = 'aqz-KE-bpKQ';

// Minimal in-memory stand-in for the Supabase project and its SQL functions.
function fakeSupabase({ member = true, now }) {
  const db = { rooms: new Map(), queue: [], nextItem: 1, calls: [], channels: [] };
  const stamp = () => new Date(now()).toISOString();
  const update = (room, patch) => Object.assign(room, patch, { revision: room.revision + 1, state_updated_at: stamp() });
  const rpcs = {
    server_now: () => stamp(),
    create_room: ({ p_name }) => {
      const room = { id: 'ABC234', name: p_name, created_by: 'user-1', video_id: null, video_title: null, playing: false, position: 0, revision: 0, state_updated_at: stamp() };
      db.rooms.set(room.id, room);
      return room;
    },
    set_playback: ({ p_room, p_video_id, p_playing, p_position, p_title }) => update(db.rooms.get(p_room), {
      video_id: p_video_id, playing: p_playing, position: p_position, video_title: p_title,
    }),
    enqueue: ({ p_room, p_video_id, p_title }) => {
      const item = { id: db.nextItem++, room_id: p_room, video_id: p_video_id, title: p_title, added_by: 'user-1', added_by_name: 'Zalfa' };
      db.queue.push(item);
      return item;
    },
    advance_queue: ({ p_room, p_expected }) => {
      const room = db.rooms.get(p_room);
      if (room.video_id !== p_expected) return room;
      const index = db.queue.findIndex(item => item.room_id === p_room);
      if (index < 0) return update(room, { playing: false });
      const [item] = db.queue.splice(index, 1);
      return update(room, { video_id: item.video_id, video_title: item.title, playing: true, position: 0 });
    },
  };
  const query = table => {
    const filters = {};
    const builder = {
      select: () => builder, order: () => builder, limit: () => builder,
      eq: (column, value) => { filters[column] = value; return builder; },
      maybeSingle: () => Promise.resolve({ data: structuredClone(db.rooms.get(filters.id) ?? null), error: null }),
      then: (resolve, reject) => Promise.resolve({
        data: table === 'rooms' ? [...db.rooms.values()].map(room => structuredClone(room)) : structuredClone(db.queue.filter(item => item.room_id === filters.room_id)),
        error: null,
      }).then(resolve, reject),
    };
    return builder;
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'jwt' } } }),
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
      signOut: async () => ({ error: null }),
      signInWithOAuth: async ({ options }) => { db.calls.push(['oauth', options]); return { data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=discord' }, error: null }; },
      exchangeCodeForSession: async code => { db.calls.push(['exchange', code]); return { data: { session: { provider_token: 'discord-token' } }, error: null }; },
    },
    functions: {
      invoke: async (name, { body }) => {
        db.calls.push([name, body]);
        return member ? { data: { displayName: 'Zalfa' }, error: null } : { data: null, error: { context: { json: async () => ({ error: 'not_member' }) } } };
      },
    },
    rpc: async (name, args) => { db.calls.push([name, args]); return { data: structuredClone(rpcs[name](args)), error: null }; },
    from: query,
    channel: (topic, options) => {
      const channel = {
        topic, options, handlers: [],
        on(type, filter, callback) { channel.handlers.push({ type, filter, callback }); return channel; },
        subscribe(callback) {
          callback?.('SUBSCRIBED');
          for (const entry of channel.handlers) if (entry.type === 'presence') entry.callback();
          return channel;
        },
        track: async () => {}, presenceState: () => ({ a: [{ name: 'Zalfa' }], b: [{ name: 'Aria' }] }),
      };
      db.channels.push(channel);
      return channel;
    },
    removeChannel: async () => {},
    realtime: { setAuth: async () => {}, disconnect() {} },
  };
  return { client, db };
}

function setup({ member = true, enabled = true, token = 'discord-token' } = {}) {
  let time = Date.parse('2026-11-15T12:00:00.000Z');
  const now = () => time;
  const { client, db } = fakeSupabase({ member, now });
  const storage = new Map(token ? [['pip-sync-discord-token', token]] : []);
  const targets = [];
  const opened = [];
  let created = 0;
  const manager = createSyncManager({
    createClient: () => { created++; return client; },
    config: { supabaseUrl: 'https://project.supabase.co', supabaseKey: 'publishable' },
    authStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    settings: { enabled, lastRoom: null },
    openExternal: async url => opened.push(url),
    fetchImpl: async () => ({ ok: true, json: async () => ({ title: 'Une vidéo' }) }),
    onRoomState: target => targets.push(target),
    listen: async () => ({ code: Promise.resolve('oauth-code'), cancel() {} }),
    now,
  });
  return { manager, db, storage, targets, opened, advance: ms => { time += ms; }, created: () => created };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('nothing connects while the option is disabled', async () => {
  const { manager, created } = setup({ enabled: false });
  manager.start();
  await settle();
  assert.equal(created(), 0);
  assert.equal(manager.state.status, 'off');
});

test('members outside the Discord guild cannot use rooms', async () => {
  const { manager } = setup({ member: false });
  manager.start();
  await settle(); await settle();
  assert.equal(manager.state.status, 'not-member');
  await manager.createRoom('Test');
  assert.equal(manager.state.room, null);
  assert.match(manager.state.message, /Connecte-toi/);
});

test('Discord sign-in stores the token and verifies guild membership', async () => {
  const { manager, db, storage, opened } = setup({ token: null });
  manager.start();
  await settle(); await settle();
  assert.equal(manager.state.status, 'signed-out');
  await manager.signIn();
  assert.deepEqual(opened, ['https://project.supabase.co/auth/v1/authorize?provider=discord']);
  assert.equal(db.calls.find(([name]) => name === 'oauth')[1].scopes, 'identify guilds.members.read');
  assert.deepEqual(db.calls.find(([name]) => name === 'exchange'), ['exchange', 'oauth-code']);
  assert.equal(storage.get('pip-sync-discord-token'), 'discord-token');
  assert.equal(manager.state.status, 'ready');
  assert.equal(manager.state.user.name, 'Zalfa');
});

test('the waiting list starts playback for everyone and advances once at the end', async () => {
  const { manager, db, targets } = setup();
  manager.start();
  await settle(); await settle();
  await manager.createRoom('Soirée ciné');
  assert.equal(manager.state.room.id, 'ABC234');
  assert.deepEqual(manager.state.viewers, ['Aria', 'Zalfa']);
  assert.ok(db.channels.some(channel => channel.topic === 'room:ABC234' && channel.options.config.private));

  await manager.enqueue('https://example.com/not-youtube');
  assert.match(manager.state.message, /YouTube/);
  await manager.enqueue(`https://youtu.be/${VIDEO_A}`);
  assert.equal(manager.state.room.videoId, VIDEO_A);
  assert.equal(manager.state.room.title, 'Une vidéo');
  assert.equal(targets.at(-1).playing, true);
  await manager.enqueue(`https://www.youtube.com/watch?v=${VIDEO_B}`);
  assert.equal(manager.state.queue.length, 1);

  // Two members finishing the same video advance the list only once.
  manager.handleMedia({ type: 'ended', time: 200, videoId: VIDEO_A });
  await wait(5);
  const advances = db.calls.filter(([name]) => name === 'advance_queue');
  assert.equal(advances.at(-1)[1].p_expected, VIDEO_A);
  assert.equal(manager.state.room.videoId, VIDEO_B);
  assert.equal(manager.state.queue.length, 0);
  // A late "ended" for the previous video is ignored.
  const calls = db.calls.length;
  manager.handleMedia({ type: 'ended', time: 200, videoId: VIDEO_A });
  await wait(5);
  assert.equal(db.calls.length, calls);
  assert.equal(manager.state.room.videoId, VIDEO_B);
});

test('local pause is shared, echoes and stale events are ignored', async () => {
  const { manager, db, targets, advance } = setup();
  manager.start();
  await settle(); await settle();
  await manager.createRoom('Salon');
  await manager.shareVideo(VIDEO_A, 30, true);
  assert.equal(targets.at(-1).videoId, VIDEO_A);

  advance(5000);
  // Same state as the room (playing at ~35 s): nothing is sent.
  const sent = db.calls.filter(([name]) => name === 'set_playback').length;
  manager.handleMedia({ type: 'play', time: 35.2, videoId: VIDEO_A, playing: true });
  await wait(300);
  assert.equal(db.calls.filter(([name]) => name === 'set_playback').length, sent);

  manager.handleMedia({ type: 'pause', time: 35.4, videoId: VIDEO_A, playing: false });
  await wait(300);
  const last = db.calls.filter(([name]) => name === 'set_playback').at(-1)[1];
  assert.deepEqual([last.p_playing, last.p_position], [false, 35.4]);
  assert.equal(manager.state.room.playing, false);

  // An older realtime update arriving late must not resume playback.
  const roomChannel = db.channels.find(channel => channel.topic === 'db:ABC234');
  const handler = roomChannel.handlers.find(entry => entry.filter.table === 'rooms').callback;
  handler({ new: { id: 'ABC234', revision: 0, playing: true, video_id: VIDEO_A, position: 0 } });
  assert.equal(manager.state.room.playing, false);

  // Reports for another video (the window browsed elsewhere) are ignored.
  manager.handleMedia({ type: 'play', time: 1, videoId: VIDEO_B, playing: true });
  await wait(300);
  assert.equal(db.calls.filter(([name]) => name === 'set_playback').at(-1)[1].p_video_id, VIDEO_A);
});
