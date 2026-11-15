// Guild synchronisation: Discord sign-in through Supabase, shared rooms,
// playback state and waiting list. Runs in the main process only, so tokens
// never reach the local interface or the websites.
const fs = require('node:fs');
const http = require('node:http');
const {
  parseYoutubeVideo, normalizeRoomCode, cleanText, expectedPosition, needsCorrection,
  isNewerRoom, clockOffset, sanitizeMediaReport,
} = require('./sync-core');

const REDIRECT_PORT = 47821;
const REDIRECT_URL = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const PROVIDER_TOKEN_KEY = 'pip-sync-discord-token';
const VERIFY_INTERVAL = 12 * 60 * 60 * 1000;
const ROOM_COLUMNS = 'id,name,video_id,video_title,playing,position,revision,state_updated_at,created_by';

// Small key/value store for the Supabase session, encrypted with Windows DPAPI.
function createFileStorage(file, safeStorage) {
  let values = {};
  try {
    const raw = fs.readFileSync(file);
    const text = safeStorage?.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    values = JSON.parse(text) || {};
  } catch {}
  const write = () => {
    try {
      const text = JSON.stringify(values);
      const data = safeStorage?.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8');
      fs.writeFileSync(`${file}.tmp`, data);
      fs.renameSync(`${file}.tmp`, file);
    } catch (error) { console.error('Synchro : sauvegarde de session impossible :', error.message); }
  };
  return {
    getItem: key => (Object.hasOwn(values, key) ? values[key] : null),
    setItem: (key, value) => { values[key] = String(value); write(); },
    removeItem: key => { delete values[key]; write(); },
  };
}

const PAGE = message => `<!doctype html><meta charset="utf-8"><title>PiP Browser</title>
<body style="font:15px 'Segoe UI',sans-serif;background:#10151e;color:#e8eef8;display:grid;place-items:center;height:90vh">
<p>${message}</p></body>`;

// Loopback redirect for the Discord sign-in opened in the default browser.
function listenForOAuthCode({ port = REDIRECT_PORT, timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolveListening, rejectListening) => {
    let settle;
    const code = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    code.catch(() => {});
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const value = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(PAGE(value ? 'Connexion réussie. Tu peux fermer cet onglet et revenir à PiP Browser.' : 'Connexion annulée ou refusée. Tu peux fermer cet onglet.'));
      finish(value ? null : new Error('Connexion Discord annulée ou refusée.'), value);
    });
    const timer = setTimeout(() => finish(new Error('La connexion Discord a expiré. Réessaie.')), timeoutMs);
    let done = false;
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      if (error) settle.reject(error); else settle.resolve(value);
    }
    server.on('error', error => {
      const failure = error.code === 'EADDRINUSE' ? new Error(`Le port ${port} est déjà utilisé : ferme l'autre connexion en cours puis réessaie.`) : error;
      if (!server.listening) { clearTimeout(timer); done = true; rejectListening(failure); } else finish(failure);
    });
    server.listen(port, '127.0.0.1', () => resolveListening({ code, cancel: () => finish(new Error('Connexion annulée.')) }));
  });
}

async function functionError(error) {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return body.error;
  } catch {}
  return error?.message || 'unknown';
}

function createSyncManager({
  createClient, config = {}, authStorage, settings = { enabled: false, lastRoom: null }, saveSettings = () => {},
  openExternal, fetchImpl = globalThis.fetch, onChange = () => {}, onRoomState = () => {}, now = () => Date.now(),
  listen = listenForOAuthCode,
}) {
  const configured = Boolean(config.supabaseUrl && config.supabaseKey);
  let client = null, roomChannel = null, dbChannel = null, providerToken = authStorage?.getItem(PROVIDER_TOKEN_KEY) || null;
  let serverOffset = 0, verifyTimer = null, pendingSignIn = null, reportTimer = null, generation = 0;
  let state = {
    configured, enabled: configured && settings.enabled === true, status: 'off', message: '',
    user: null, rooms: [], room: null, queue: [], viewers: [], lastRoom: settings.lastRoom || null,
  };
  const emit = () => onChange(publicState());
  const set = patch => { state = { ...state, ...patch }; emit(); };

  function publicState() {
    const room = state.room && {
      id: state.room.id, name: state.room.name, videoId: state.room.video_id, title: state.room.video_title,
      playing: state.room.playing, mine: state.room.created_by === state.user?.id,
    };
    return { ...state, room, queue: state.queue.map(item => ({ ...item, mine: item.added_by === state.user?.id })) };
  }

  async function run(task) {
    try { return await task(); } catch (error) {
      set({ message: cleanText(error?.message || 'La synchronisation a rencontré une erreur.', 200) });
      return undefined;
    }
  }

  function ensureClient() {
    if (!configured) throw new Error('La synchronisation n’est pas configurée dans cette version.');
    if (!client) {
      client = createClient(config.supabaseUrl, config.supabaseKey, {
        auth: { flowType: 'pkce', storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
    }
    return client;
  }

  async function connect() {
    const id = ++generation;
    if (!state.enabled) return;
    set({ status: 'connecting', message: '' });
    const { data } = await ensureClient().auth.getSession();
    if (id !== generation) return;
    if (!data?.session || !providerToken) { set({ status: 'signed-out', user: null }); return; }
    await verify();
  }

  async function verify() {
    set({ status: 'verifying', message: '' });
    const { data, error } = await ensureClient().functions.invoke('verify-guild', { body: { provider_token: providerToken } });
    if (error) {
      const code = await functionError(error);
      if (['discord_token_invalid', 'missing_discord_token', 'invalid_session', 'missing_session'].includes(code)) {
        await forgetSession();
        set({ status: 'signed-out', user: null, message: 'Ta connexion Discord a expiré : reconnecte-toi.' });
      } else if (['not_member', 'missing_role', 'identity_mismatch', 'discord_identity_missing'].includes(code)) {
        await leaveRoom();
        set({ status: 'not-member', user: null, message: code === 'missing_role'
          ? 'Ton compte Discord n’a pas le rôle requis dans la guilde.'
          : 'Ce compte Discord ne fait pas partie du serveur de la guilde.' });
      } else set({ status: 'error', message: 'Vérification de la guilde impossible. Réessaie plus tard.' });
      return false;
    }
    const { data: auth } = await ensureClient().auth.getUser();
    set({ status: 'ready', user: { id: auth?.user?.id, name: cleanText(data?.displayName, 60) || 'Membre' } });
    clearTimeout(verifyTimer);
    verifyTimer = setTimeout(() => { run(verify); }, VERIFY_INTERVAL);
    verifyTimer.unref?.();
    await syncClock();
    await refreshRooms();
    return true;
  }

  async function syncClock() {
    const sent = now();
    const { data, error } = await ensureClient().rpc('server_now');
    if (!error) serverOffset = clockOffset(sent, now(), data);
  }

  async function signIn() {
    ensureClient();
    pendingSignIn?.cancel();
    set({ status: 'signing-in', message: 'Termine la connexion dans ton navigateur.' });
    const listener = await listen();
    pendingSignIn = listener;
    try {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'discord',
        options: { redirectTo: REDIRECT_URL, scopes: 'identify guilds.members.read', skipBrowserRedirect: true },
      });
      if (error || !data?.url) throw new Error('Impossible de démarrer la connexion Discord.');
      await openExternal(data.url);
      const code = await listener.code;
      const { data: exchanged, error: exchangeError } = await client.auth.exchangeCodeForSession(code);
      if (exchangeError || !exchanged?.session?.provider_token) throw new Error('La connexion Discord n’a pas abouti.');
      providerToken = exchanged.session.provider_token;
      authStorage?.setItem(PROVIDER_TOKEN_KEY, providerToken);
      set({ message: '' });
      await verify();
    } catch (error) {
      listener.cancel();
      set({ status: 'signed-out', message: cleanText(error.message, 200) });
    } finally { if (pendingSignIn === listener) pendingSignIn = null; }
  }

  async function forgetSession() {
    await leaveRoom();
    providerToken = null;
    authStorage?.removeItem(PROVIDER_TOKEN_KEY);
    try { await client?.auth.signOut({ scope: 'local' }); } catch {}
  }

  async function signOut() {
    await forgetSession();
    clearTimeout(verifyTimer);
    set({ status: state.enabled ? 'signed-out' : 'off', user: null, rooms: [], message: '' });
  }

  async function setEnabled(enabled) {
    if (!configured) { set({ message: 'La synchronisation n’est pas configurée dans cette version.' }); return; }
    state.enabled = enabled === true;
    saveSettings({ enabled: state.enabled, lastRoom: state.lastRoom });
    if (state.enabled) await connect();
    else {
      generation++;
      pendingSignIn?.cancel();
      await leaveRoom();
      clearTimeout(verifyTimer);
      try { client?.realtime.disconnect(); } catch {}
      set({ status: 'off', user: null, rooms: [], message: '' });
    }
  }

  function requireReady() {
    if (state.status !== 'ready') throw new Error('Connecte-toi d’abord avec Discord.');
    return client;
  }
  function requireRoom() {
    requireReady();
    if (!state.room) throw new Error('Rejoins d’abord un salon.');
    return state.room;
  }

  async function refreshRooms() {
    const { data, error } = await requireReady().from('rooms').select('id,name,video_title,playing,state_updated_at')
      .order('state_updated_at', { ascending: false }).limit(20);
    if (error) throw new Error('Impossible de charger les salons.');
    set({ rooms: data || [] });
  }

  async function createRoom(name) {
    const clean = cleanText(name, 60) || `Salon de ${state.user?.name || 'la guilde'}`;
    const { data, error } = await requireReady().rpc('create_room', { p_name: clean });
    if (error) throw new Error(error.message || 'Impossible de créer le salon.');
    await joinRoom(data.id);
  }

  async function loadRoom(code) {
    const { data, error } = await client.from('rooms').select(ROOM_COLUMNS).eq('id', code).maybeSingle();
    if (error) throw new Error('Impossible de charger le salon.');
    return data;
  }

  async function loadQueue() {
    if (!state.room) return;
    const roomId = state.room.id;
    const { data, error } = await client.from('queue_items').select('id,video_id,title,added_by,added_by_name')
      .eq('room_id', roomId).order('id').limit(100);
    if (!error && state.room?.id === roomId) set({ queue: data || [] });
  }

  async function joinRoom(input) {
    const code = normalizeRoomCode(input);
    if (!code) throw new Error('Le code de salon contient 6 caractères (lettres et chiffres).');
    requireReady();
    await leaveRoom();
    const room = await loadRoom(code);
    if (!room) throw new Error('Salon introuvable.');
    state.lastRoom = code;
    saveSettings({ enabled: state.enabled, lastRoom: code });
    set({ room, queue: [], viewers: [], message: '', lastRoom: code });
    applyRoom();
    await loadQueue();
    dbChannel = client.channel(`db:${code}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${code}` }, payload => receiveRoom(payload.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'queue_items', filter: `room_id=eq.${code}` }, () => { loadQueue(); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'queue_items' }, payload => {
        if (state.queue.some(item => item.id === payload.old?.id)) loadQueue();
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED' && state.room?.id === code) {
          // Catch up on anything missed while (re)connecting.
          const latest = await loadRoom(code).catch(() => null);
          if (latest) receiveRoom(latest);
          loadQueue();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') set({ message: 'Connexion temps réel interrompue, nouvelle tentative…' });
      });
    await client.realtime.setAuth();
    roomChannel = client.channel(`room:${code}`, { config: { private: true, presence: { key: state.user.id } } });
    roomChannel
      .on('presence', { event: 'sync' }, () => {
        const viewers = Object.values(roomChannel?.presenceState() || {}).map(list => cleanText(list?.[0]?.name, 60)).filter(Boolean);
        set({ viewers: [...new Set(viewers)].sort((a, b) => a.localeCompare(b)) });
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') await roomChannel?.track({ name: state.user?.name });
      });
  }

  async function leaveRoom() {
    clearTimeout(reportTimer);
    const channels = [dbChannel, roomChannel].filter(Boolean);
    dbChannel = roomChannel = null;
    for (const channel of channels) { try { await client.removeChannel(channel); } catch {} }
    if (state.room) { state = { ...state, room: null, queue: [], viewers: [] }; onRoomState(null); emit(); }
  }

  function receiveRoom(row) {
    if (!row || !state.room || row.id !== state.room.id || !isNewerRoom(state.room, row)) return;
    set({ room: { ...state.room, ...row } });
    applyRoom();
  }

  function roomTarget() {
    const room = state.room;
    if (!room) return null;
    return { roomId: room.id, videoId: room.video_id, playing: room.playing, position: expectedPosition(room, now(), serverOffset), title: room.video_title };
  }
  function applyRoom() { onRoomState(roomTarget()); }

  async function fetchTitle(videoId) {
    try {
      const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
      if (response.ok) return cleanText((await response.json())?.title, 200) || 'Vidéo YouTube';
    } catch {}
    return 'Vidéo YouTube';
  }

  async function call(name, args) {
    const { data, error } = await requireReady().rpc(name, args);
    if (error) throw new Error(error.message || 'L’action n’a pas pu être synchronisée.');
    return data;
  }

  async function enqueue(input) {
    const room = requireRoom();
    const videoId = parseYoutubeVideo(input);
    if (!videoId) throw new Error('Colle l’adresse d’une vidéo YouTube.');
    await call('enqueue', { p_room: room.id, p_video_id: videoId, p_title: await fetchTitle(videoId) });
    await loadQueue();
    if (!state.room?.video_id) receiveRoom(await call('advance_queue', { p_room: room.id, p_expected: null }));
  }

  async function removeItem(id) {
    requireRoom();
    if (!Number.isSafeInteger(id)) return;
    await call('remove_item', { p_item: id });
    await loadQueue();
  }

  async function playItem(id) {
    requireRoom();
    if (!Number.isSafeInteger(id)) return;
    receiveRoom(await call('play_item', { p_item: id }));
    await loadQueue();
  }

  async function next() {
    const room = requireRoom();
    receiveRoom(await call('advance_queue', { p_room: room.id, p_expected: room.video_id }));
    await loadQueue();
  }

  // Playback reports from the synced page. Remote changes applied by the page
  // itself are filtered there; matching states are filtered again here.
  function handleMedia(input) {
    const report = sanitizeMediaReport(input);
    const room = state.room;
    if (!report || report.ad || !room || state.status !== 'ready' || report.videoId !== room.video_id) return;
    if (report.type === 'ready') { applyRoom(); return; }
    if (report.type === 'ended') { run(next); return; }
    const playing = report.type === 'play' ? true : report.type === 'pause' ? false : report.playing;
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
      const current = state.room;
      if (!current || current.video_id !== report.videoId) return;
      if (current.playing === playing && !needsCorrection(report.time, expectedPosition(current, now(), serverOffset), 1)) return;
      run(async () => receiveRoom(await call('set_playback', {
        p_room: current.id, p_video_id: report.videoId, p_playing: playing, p_position: report.time, p_title: current.video_title,
      })));
    }, 250);
  }

  return {
    get state() { return publicState(); },
    start() { if (state.enabled) run(connect); else emit(); },
    setEnabled: value => run(() => setEnabled(value)),
    signIn: () => run(signIn),
    signOut: () => run(signOut),
    retry: () => run(connect),
    refreshRooms: () => run(refreshRooms),
    createRoom: name => run(() => createRoom(name)),
    joinRoom: code => run(() => joinRoom(code)),
    leaveRoom: () => run(leaveRoom),
    enqueue: url => run(() => enqueue(url)),
    removeItem: id => run(() => removeItem(id)),
    playItem: id => run(() => playItem(id)),
    next: () => run(next),
    handleMedia,
    target: roomTarget,
    async dispose() {
      clearTimeout(verifyTimer); clearTimeout(reportTimer); pendingSignIn?.cancel();
      await leaveRoom().catch(() => {});
      try { client?.realtime.disconnect(); } catch {}
    },
  };
}

module.exports = { createSyncManager, createFileStorage, listenForOAuthCode, REDIRECT_URL, REDIRECT_PORT };
