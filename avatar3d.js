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

  // A transparent light pool follows Drok without painting a backdrop over the host site.
  const haloCanvas = document.createElement('canvas');
  haloCanvas.width = haloCanvas.height = 256;
  const haloContext = haloCanvas.getContext('2d');
  const haloGradient = haloContext.createRadialGradient(128, 128, 20, 128, 128, 126);
  haloGradient.addColorStop(0, 'rgba(92, 226, 220, 0.43)');
  haloGradient.addColorStop(0.36, 'rgba(65, 195, 222, 0.19)');
  haloGradient.addColorStop(1, 'rgba(65, 195, 222, 0)');
  haloContext.fillStyle = haloGradient;
  haloContext.fillRect(0, 0, 256, 256);
  const haloTexture = new THREE.CanvasTexture(haloCanvas);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0.54
  }));
  halo.position.set(0, 1.65, -1.1);
  halo.scale.set(4.3, 4.3, 1);
  scene.add(halo);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    halo.material.opacity = reducedMotion ? 0.52 : 0.52 + 0.07 * Math.sin(now * 0.0019);
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
