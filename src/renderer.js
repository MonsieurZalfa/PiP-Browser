const $ = id => document.getElementById(id);
const command = async (name, value) => {
  try {
    const result = await window.pip.command(name, value);
    if (result?.error) $('address').setCustomValidity(result.error);
    else $('address').setCustomValidity('');
    $('address').reportValidity();
  } catch { $('status').textContent = 'La commande a échoué. Réessaie depuis le menu près de l’horloge.'; }
};
$('address-form').addEventListener('submit', event => { event.preventDefault(); command('navigate', $('address').value); });
$('address').addEventListener('input', () => $('address').setCustomValidity(''));
for (const name of ['back', 'reload', 'new', 'close', 'video', 'compact', 'game', 'smaller', 'larger', 'reset-size', 'updates']) {
  $(name).addEventListener('click', () => command(name));
}
for (const handle of document.querySelectorAll('[data-edge]')) {
  let dragging = false;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    handle.setPointerCapture(event.pointerId);
    command('resize-start', { edge: handle.dataset.edge, x: event.screenX, y: event.screenY });
  });
  handle.addEventListener('pointermove', event => {
    if (dragging) command('resize-move', { x: event.screenX, y: event.screenY });
  });
  const stop = () => { if (dragging) { dragging = false; command('resize-end'); } };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
}
const dragZone = document.querySelector('.drag-zone');
let moving = false;
dragZone.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault();
  moving = true;
  dragZone.setPointerCapture(event.pointerId);
  command('move-start', { x: event.screenX, y: event.screenY });
});
dragZone.addEventListener('pointermove', event => {
  if (moving) command('move-move', { x: event.screenX, y: event.screenY });
});
const stopMoving = () => { if (moving) { moving = false; command('move-end'); } };
dragZone.addEventListener('pointerup', stopMoving);
dragZone.addEventListener('pointercancel', stopMoving);
dragZone.addEventListener('lostpointercapture', stopMoving);
$('opacity').addEventListener('input', () => {
  $('opacity-value').textContent = `${$('opacity').value} %`;
  command('opacity', Number($('opacity').value) / 100);
});
window.pip.onState(state => {
  document.documentElement.classList.toggle('compact', state.compact);
  document.documentElement.classList.toggle('minimal-frame', state.compact || state.videoOnly);
  if (document.activeElement !== $('address')) $('address').value = state.url;
  $('opacity').value = Math.round(state.opacity * 100);
  $('opacity-value').textContent = `${Math.round(state.opacity * 100)} %`;
  $('back').disabled = !state.canGoBack;
  $('video').setAttribute('aria-pressed', String(state.videoOnly));
  $('video').disabled = !state.youtube;
  for (const name of ['new', 'game', 'compact']) {
    const descriptions = { new: 'Nouvelle fenêtre', game: 'Laisser les clics traverser', compact: 'Masquer les commandes' };
    $(name).title = `${descriptions[name]} · ${state.shortcuts[name] || 'menu PiP près de l’horloge'}`;
    if (name === 'compact') $(name).title += ' · Double clic droit dans la page';
  }
  const updates = state.updates;
  $('updates').disabled = !updates?.enabled || ['checking', 'downloading'].includes(updates?.status);
  $('updates').textContent = updates?.status === 'downloaded' ? '↻' : '↑';
  $('updates').title = !updates?.enabled ? 'Mises à jour disponibles dans l’application installée' : updates.status === 'downloaded' ? 'Redémarrer pour installer la version ' + updates.version : updates.status === 'downloading' ? 'Téléchargement : ' + updates.progress + ' %' : 'Vérifier les mises à jour';
  document.title = state.title ? `${state.title} — PiP Browser` : 'PiP Browser';
});
command('ready');
