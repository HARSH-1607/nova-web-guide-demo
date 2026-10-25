import * as THREE from './vendor/three.module.js';
import { loadDrokAvatar } from './drok-avatar.js';

const actor = document.getElementById('avatarActor');
const canvas = document.getElementById('avatar3dCanvas');

try {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 3 / 4, 0.1, 30);
  camera.position.set(0, 1.65, 7.8);
  camera.lookAt(0, 1.57, 0);
  scene.add(new THREE.HemisphereLight(0xd9f4ff, 0x26304d, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.position.set(2.5, 4.5, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x70d9eb, 2.2);
  rim.position.set(-2.5, 3, -3);
  scene.add(rim);

  let modelController = null;
  loadDrokAvatar(scene).then((loaded) => {
    modelController = loaded;
    actor.dataset.model = 'Drok';
    actor.dataset.headTracking = 'body';
  }).catch((error) => {
    console.warn('Drok 3D model could not load; showing its still portrait.', error);
    actor.dataset.model = 'Drok-still';
  });

  let lastTime = performance.now();
  function updateSize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    if (canvas.width !== Math.round(width * renderer.getPixelRatio())
      || canvas.height !== Math.round(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = camera.aspect >= 0.9 ? 6.7 : 7.8;
      camera.updateProjectionMatrix();
    }
  }

  function sync(pose, now) {
    const delta = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    actor.dataset.gesture = pose.gesture?.type || 'idle';
    if (!modelController) return;
    modelController.sync(pose, now, delta);
    actor.dataset.animation = modelController.activeAnimation;
    updateSize();
    renderer.render(scene, camera);
  }

  actor.dataset.renderer = 'three';
  window.Nova3D = { ready: true, sync };
  window.dispatchEvent(new Event('nova3dready'));
} catch (error) {
  console.warn('Drok 3D view unavailable; showing its still portrait.', error);
  actor.dataset.model = 'Drok-still';
  window.dispatchEvent(new Event('nova3dfailed'));
}
