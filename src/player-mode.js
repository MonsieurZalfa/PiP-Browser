function findPlayer() {
  const host = location.hostname;
  if (/(^|\.)youtube\.com$/.test(host)) return document.querySelector('#movie_player video')?.closest('#movie_player') || null;
  if (/(^|\.)twitch\.tv$/.test(host)) {
    const video = [...document.querySelectorAll('video')].sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
    return video?.closest('[data-a-target="video-player"], .video-player') || document.querySelector('iframe[src*="player.twitch.tv"]') || null;
  }
  return null;
}

// This function is serialized into the remote page. It has no Electron access.
function setPlayerMode(enable, findPlayer) {
  const key = Symbol.for('pip-browser.video-mode');
  const existing = window[key];
  if (!enable) {
    existing?.stop();
    delete window[key];
    return;
  }
  if (existing) { existing.repair(); return; }
  if (!findPlayer()) throw new Error('Ouvre une vidéo YouTube ou Twitch avant d’activer ce mode.');

  let active = true;
  let saved = null;
  let timer = null;
  const schedule = () => {
    if (!active || timer !== null) return;
    timer = setTimeout(() => { timer = null; repair(); }, 0);
  };
  const resizeObserver = new ResizeObserver(schedule);
  function restore() {
    if (!saved) return;
    const { player, attribute, marker } = saved;
    saved = null;
    player.removeEventListener('toggle', schedule);
    resizeObserver.unobserve(player);
    if (player.matches(':popover-open')) player.hidePopover();
    if (attribute === null) player.removeAttribute('popover');
    else player.setAttribute('popover', attribute);
    if (marker === null) player.removeAttribute('data-pip-browser-player');
    else player.setAttribute('data-pip-browser-player', marker);
  }
  function repair() {
    if (!active) return;
    const player = findPlayer();
    if (!player?.isConnected) return;
    if (saved?.player !== player) {
      restore();
      saved = { player, attribute: player.getAttribute('popover'), marker: player.getAttribute('data-pip-browser-player') };
      player.addEventListener('toggle', schedule);
      resizeObserver.observe(player);
    }
    if (!player.hasAttribute('data-pip-browser-player')) player.setAttribute('data-pip-browser-player', '');
    if (player.getAttribute('popover') !== 'manual') player.setAttribute('popover', 'manual');
    // YouTube reparents/replaces its player at responsive breakpoints. Removing
    // a popover from the DOM closes it even if it is inserted again immediately.
    if (!player.matches(':popover-open')) {
      try { player.showPopover(); } catch { /* It may be detached again this frame. */ }
    }
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['popover', 'hidden'] });
  window.addEventListener('resize', schedule);
  window[key] = {
    repair,
    stop() {
      active = false;
      clearTimeout(timer);
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', schedule);
      restore();
    },
  };
  repair();
}

module.exports = { setPlayerMode, findPlayer };
