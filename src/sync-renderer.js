const $ = id => document.getElementById(id);
let current = null;
const command = async (name, value) => {
  try { await window.pipSync.command(name, value); } catch { $('message').textContent = 'La commande a échoué.'; }
};
const button = (label, title, onClick) => {
  const element = document.createElement('button');
  element.textContent = label;
  if (title) element.title = title;
  element.addEventListener('click', onClick);
  return element;
};

$('enabled').addEventListener('change', () => command('enable', $('enabled').checked));
$('sign-in').addEventListener('click', () => command('sign-in'));
$('sign-out').addEventListener('click', () => command('sign-out'));
$('sign-out-member').addEventListener('click', () => command('sign-out'));
$('retry').addEventListener('click', () => command('retry'));
$('refresh-rooms').addEventListener('click', () => command('refresh-rooms'));
$('leave').addEventListener('click', () => command('leave-room'));
$('next').addEventListener('click', () => command('next'));
$('share').addEventListener('click', () => command('share'));
$('resync').addEventListener('click', () => command('resync'));
$('copy-code').addEventListener('click', () => command('copy-code'));
$('join-form').addEventListener('submit', event => { event.preventDefault(); command('join-room', $('join-code').value); $('join-code').value = ''; });
$('create-form').addEventListener('submit', event => { event.preventDefault(); command('create-room', $('room-name').value); $('room-name').value = ''; });
$('queue-form').addEventListener('submit', event => { event.preventDefault(); command('enqueue', $('queue-url').value); $('queue-url').value = ''; });
$('rooms').dataset.empty = 'Aucun salon pour le moment. Crée le premier !';
$('queue').dataset.empty = 'La liste est vide. Ajoute une vidéo ci-dessus.';

function show(section) {
  for (const id of ['off', 'unconfigured', 'signed-out', 'busy', 'not-member', 'lobby', 'room']) $(id).hidden = id !== section;
}

function renderRooms(rooms) {
  $('rooms').replaceChildren(...rooms.map(room => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'grow';
    name.textContent = room.name;
    const playing = document.createElement('span');
    playing.className = 'by';
    playing.textContent = room.video_title ? `${room.playing ? '▶' : '⏸'} ${room.video_title}` : room.id;
    playing.classList.add('grow');
    item.append(name, playing, button('Rejoindre', `Code ${room.id}`, () => command('join-room', room.id)));
    return item;
  }));
}

function renderQueue(queue, canManage) {
  $('queue-count').textContent = queue.length ? `(${queue.length})` : '';
  $('queue').replaceChildren(...queue.map(entry => {
    const item = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'grow';
    title.textContent = entry.title;
    title.title = entry.title;
    const by = document.createElement('span');
    by.className = 'by';
    by.textContent = entry.added_by_name;
    item.append(title, by, button('▶', 'Lire maintenant pour tout le salon', () => command('play-item', entry.id)));
    if (entry.mine || canManage) item.append(button('✕', 'Retirer de la liste', () => command('remove-item', entry.id)));
    return item;
  }));
}

window.pipSync.onState(state => {
  current = state;
  $('enabled').checked = state.enabled;
  $('enabled').disabled = !state.configured;
  $('message').textContent = state.message || '';
  if (!state.configured) return show('unconfigured');
  if (!state.enabled) return show('off');
  if (['connecting', 'verifying', 'signing-in'].includes(state.status)) {
    $('busy-text').textContent = state.status === 'signing-in' ? 'Termine la connexion Discord dans ton navigateur…' : state.status === 'verifying' ? 'Vérification de ton appartenance à la guilde…' : 'Connexion…';
    return show('busy');
  }
  if (state.status === 'signed-out' || state.status === 'off') return show('signed-out');
  if (state.status === 'not-member' || state.status === 'error') return show('not-member');
  $('user-name').textContent = state.user?.name || '';
  if (!state.room) { renderRooms(state.rooms); return show('lobby'); }
  const room = state.room;
  $('room-name-title').textContent = room.name;
  $('room-code').textContent = room.id;
  $('now-title').textContent = room.videoId ? `${room.playing ? '▶' : '⏸'} ${room.title || 'Vidéo YouTube'}` : 'Aucune vidéo : ajoute-en une à la liste.';
  const info = $('window-info');
  info.classList.toggle('warn', !state.window || state.window.outOfSync);
  info.textContent = !state.window
    ? 'Aucune fenêtre synchronisée : clique sur « Synchro » dans une fenêtre PiP.'
    : state.window.outOfSync ? `La fenêtre « ${state.window.title} » affiche une autre page que le salon.` : `Fenêtre synchronisée : ${state.window.title}`;
  // Nothing to add if the window shows the room video or one already queued.
  $('share').disabled = !state.window?.videoId || state.window.videoId === room.videoId
    || state.queue.some(entry => entry.video_id === state.window.videoId);
  $('resync').disabled = !state.window || !room.videoId;
  $('next').disabled = !room.videoId && !state.queue.length;
  renderQueue(state.queue, room.mine);
  $('viewers').textContent = state.viewers.length ? state.viewers.join(', ') : 'Personne pour le moment.';
  show('room');
});
command('ready');
