(() => {
  'use strict';

  const scenes = [...document.querySelectorAll('.cinematic-scene')];
  const hud = document.getElementById('sceneHud');
  const title = document.getElementById('sceneHudTitle');
  const count = document.getElementById('sceneHudCount');
  const progress = document.getElementById('sceneHudProgress');
  const navLabel = document.getElementById('sceneNavLabel');
  const previous = document.querySelector('[data-scene-nav="previous"]');
  const next = document.querySelector('[data-scene-nav="next"]');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let activeIndex = 0;
  let scheduled = false;

  function activate(index) {
    const safe = Math.max(0, Math.min(scenes.length - 1, index));
    const scene = scenes[safe];
    if (!scene) return;
    activeIndex = safe;
    document.body.dataset.scene = scene.dataset.scene;
    title.textContent = scene.dataset.sceneTitle;
    count.textContent = `${scene.dataset.sceneNumber} / ${String(scenes.length).padStart(2, '0')}`;
    progress.style.width = `${(safe + 1) / scenes.length * 100}%`;
    navLabel.textContent = `${scene.dataset.sceneNumber} / ${scene.dataset.sceneTitle}`;
    previous.disabled = safe === 0;
    next.disabled = safe === scenes.length - 1;
    scene.classList.add('scene-visible');
  }

  function updateFromViewport() {
    scheduled = false;
    if (document.body.classList.contains('intro-active')) return;
    const focalY = window.innerHeight * 0.43;
    let bestIndex = 0;
    let bestDistance = Infinity;
    scenes.forEach((scene, index) => {
      const rect = scene.getBoundingClientRect();
      const distance = rect.top <= focalY && rect.bottom >= focalY
        ? 0 : Math.min(Math.abs(rect.top - focalY), Math.abs(rect.bottom - focalY));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
      if (rect.top < window.innerHeight * 0.9 && rect.bottom > window.innerHeight * 0.1) {
        scene.classList.add('scene-visible');
      }
    });
    activate(bestIndex);
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(updateFromViewport);
  }

  for (const button of [previous, next]) {
    button.addEventListener('click', () => {
      const direction = button.dataset.sceneNav === 'next' ? 1 : -1;
      const destination = scenes[activeIndex + direction];
      if (destination) window.dispatchEvent(new CustomEvent('nova:scene-request', { detail: { element: destination } }));
    });
  }

  window.addEventListener('nova:reveal', () => {
    hud.hidden = false;
    scheduleUpdate();
  });
  window.addEventListener('nova:guide-target', (event) => {
    const scene = event.detail?.element?.closest('.cinematic-scene');
    const index = scenes.indexOf(scene);
    if (index >= 0) activate(index);
  });
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });
  reduceMotion.addEventListener?.('change', scheduleUpdate);
  activate(0);
  if (!document.body.classList.contains('intro-active')) {
    hud.hidden = false;
    scheduleUpdate();
  }
})();
