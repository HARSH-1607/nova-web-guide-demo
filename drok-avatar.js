import * as THREE from 'three';
import { GLTFLoader } from './vendor/examples/jsm/loaders/GLTFLoader.js';

// Blender exports Drok as one 24 fps timeline. Split it into reusable UI states.
const ranges = {
  idle: [0, 47], listening: [48, 95], thinking: [96, 143],
  talking: [144, 191], happy: [192, 239], mischievous: [240, 287]
};

export async function loadDrokAvatar(scene) {
  const gltf = await new GLTFLoader().loadAsync(new URL('./models/Drok_Web_Avatar.glb', import.meta.url).href);
  if (gltf.animations.length !== 1) throw new Error('Drok needs its six-state Blender timeline.');

  const model = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('Drok model has invalid bounds.');
  model.scale.setScalar(3.25 / size.y);
  const scaled = new THREE.Box3().setFromObject(model);
  model.position.set(
    -(scaled.min.x + scaled.max.x) / 2,
    0.17 - scaled.min.y,
    -(scaled.min.z + scaled.max.z) / 2
  );

  const pivot = new THREE.Group();
  pivot.position.y = 1.65;
  const offset = new THREE.Group();
  offset.position.y = -1.65;
  offset.add(model);
  pivot.add(offset);
  scene.add(pivot);

  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map(Object.entries(ranges).map(([name, [first, last]]) => {
    const clip = THREE.AnimationUtils.subclip(gltf.animations[0], name, first, last, 24);
    return [name, mixer.clipAction(clip)];
  }));
  let activeState = '';
  let activeAction = null;

  function play(name) {
    if (name === activeState) return;
    const next = actions.get(name);
    if (!next) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
    if (activeAction) activeAction.crossFadeTo(next, 0.22, false);
    activeAction = next;
    activeState = name;
  }
  play('idle');

  const mouthControl = model.getObjectByName('Drok talk mouth control');
  return {
    get activeAnimation() { return activeState; },
    sync(pose, now, delta) {
      const gesture = pose.gesture?.type || null;
      const talking = pose.speechFrame != null;
      const state = gesture === 'think' ? 'thinking'
        : gesture === 'point' || pose.walking ? 'listening'
          : gesture === 'shake' || gesture === 'fistBump' ? 'mischievous'
            : gesture ? 'happy' : talking ? 'talking' : 'idle';
      play(state);
      mixer.update(delta);

      // Blender's mouth control is keyed in the talking clip, but the same
      // control can animate speech while another gesture is playing.
      if (talking && mouthControl) {
        const cue = Math.min(6, Math.floor(pose.speechFrame / 7));
        mouthControl.scale.setScalar([0.06, 0.82, 0.42, 0.32, 1, 0.62, 0.04][cue]);
      }

      const elapsed = gesture ? Math.max(0, (now - pose.gesture.started) / 1000) : 0;
      const gazeX = pose.gaze?.x || 0;
      const gazeY = pose.gaze?.y || 0;
      let roll = 0;
      let yaw = gazeX * 0.14;
      let pitch = gazeY * 0.09;
      let bob = 0.012 * Math.sin(now * 0.0016);
      if (pose.walking) { roll += 0.06 * Math.sin(elapsed * 5); bob += 0.035 * Math.sin(now * 0.006); }
      if (gesture === 'wave') roll += 0.07 * Math.sin(elapsed * 6);
      if (gesture === 'dance') { roll += 0.15 * Math.sin(elapsed * 5); yaw += 0.22 * Math.sin(elapsed * 3); bob += 0.10 * Math.abs(Math.sin(elapsed * 5)); }
      if (gesture === 'nod') pitch += 0.12 * Math.sin(elapsed * 7);
      if (gesture === 'shake') yaw += 0.18 * Math.sin(elapsed * 6);
      if (gesture === 'think') { roll -= 0.05; pitch += 0.08; }
      if (gesture === 'fistBump') pitch += 0.10 * Math.sin(elapsed * 8);
      if (gesture === 'jump' || gesture === 'joy') bob += 0.12 * Math.abs(Math.sin(elapsed * 6));
      if (gesture === 'point') roll += 0.05;
      const blend = 1 - Math.exp(-delta * 9);
      pivot.rotation.set(
        THREE.MathUtils.lerp(pivot.rotation.x, pitch, blend),
        THREE.MathUtils.lerp(pivot.rotation.y, yaw, blend),
        THREE.MathUtils.lerp(pivot.rotation.z, roll, blend)
      );
      pivot.position.y = THREE.MathUtils.lerp(pivot.position.y, 1.65 + bob, blend);
    }
  };
}
