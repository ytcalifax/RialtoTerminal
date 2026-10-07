/**
 * OSM tile painting with a snapshot fallback.
 *
 * Tiles load asynchronously, so the previous tile set is kept as a frozen
 * fallback layer and swapped out only once the new set has enough images.
 * This keeps panning seamless even when the tile CDN is slow or offline.
 */

/**
 * Replace the tile layer's images, managing the fallback snapshot lifecycle.
 * @param {HTMLElement} stage - `.map-stage` container.
 * @param {HTMLElement} tiles - `.map-tiles` layer (not the fallback clone).
 * @param {string[]} html - `<img>` markup for the visible tiles.
 */
function paintMapTiles(stage, tiles, html) {
  // First paint: snapshot the existing tiles as a fallback clone.
  if (tiles.dataset.ready === 'true' || (tiles.dataset.usable === 'true' && !stage.querySelector('.map-tiles-fallback'))) {
    stage.querySelector('.map-tiles-fallback')?.remove();
    const fallback = tiles.cloneNode(true);
    fallback.classList.add('map-tiles-fallback');
    fallback.dataset.ready = 'true';
    stage.insertBefore(fallback, tiles);
  }
  tiles.classList.toggle('loading', !!stage.querySelector('.map-tiles-fallback'));
  tiles.dataset.ready = 'false';
  tiles.dataset.usable = 'false';
  tiles.innerHTML = html.join('');

  const images = [...tiles.querySelectorAll('img')];
  const hideFailed = (img) => {
    if (img.complete && !img.naturalWidth) img.style.display = 'none';
  };
  // "ready" = every tile present; "usable" = at least one — the fallback
  // stays visible whenever the new set is not fully ready.
  const settle = () => {
    images.forEach(hideFailed);
    const ready = images.every((img) => img.complete && img.naturalWidth > 0);
    const usable = images.some((img) => img.complete && img.naturalWidth > 0);
    tiles.dataset.ready = String(ready);
    tiles.dataset.usable = String(usable || !images.length);
    tiles.classList.toggle('loading', !ready && !!stage.querySelector('.map-tiles-fallback'));
    if (ready) stage.querySelector('.map-tiles-fallback')?.remove();
  };

  const pending = images.filter((img) => !img.complete);
  let remaining = pending.length;
  if (!remaining) {
    settle();
    return;
  }
  let settled = false;
  const finish = () => {
    remaining--;
    if (remaining <= 0 && !settled) {
      settled = true;
      settle();
    }
  };
  pending.forEach((img) => {
    img.addEventListener('load', finish, { once: true });
    img.addEventListener('error', () => {
      img.style.display = 'none';
      finish();
    }, { once: true });
    if (img.complete) {
      finish();
    }
  });
}

export { paintMapTiles };
