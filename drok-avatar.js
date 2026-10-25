import * as THREE from 'three';
import { GLTFLoader } from './vendor/examples/jsm/loaders/GLTFLoader.js';

// Blender exports Drok as one 24 fps timeline. Split it into reusable UI states.
const ranges = {
  idle: [0, 47], listening: [48, 95], thinking: [96, 143],
  talking: [144, 191], happy: [192, 239], mischievous: [240, 287],
  wave: [288, 335], point: [336, 383], dance: [384, 431],
  joy: [432, 479], nod: [480, 527], shake: [528, 575],
  fistBump: [576, 623], jump: [624, 671]
};

export async function loadDrokAvatar(scene) {
  const gltf = await new GLTFLoader().loadAsync(new URL('./models/Drok_Web_Avatar.glb', import.meta.url).href);
  if (gltf.animations.length !== 1) throw new Error('Drok needs its keyed Blender timeline.');

  const model = gltf.scene;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const spikes = [];
  model.traverse((object) => {
    if (!object.isMesh || !/^Drok[_ ](?:organic[_ ]thorn|crown[_ ]thorn)/.test(object.name)) return;
    object.geometry = object.geometry.clone();
    const position = object.geometry.getAttribute('position');
    const rest = Float32Array.from(position.array);
    const radii = [];
    let rootRadius = Infinity;
    let tipRadius = -Infinity;
    let tip = 0;
    for (let i = 0; i < position.count; i++) {
      const at = i * 3;
      const radius = Math.hypot(rest[at], rest[at + 1] - 1.75, rest[at + 2]);
      radii.push(radius);
      rootRadius = Math.min(rootRadius, radius);
      if (radius > tipRadius) { tipRadius = radius; tip = at; }
    }
    const flex = Float32Array.from(radii, (radius) => {
      const along = THREE.MathUtils.clamp((radius - rootRadius) / Math.max(0.001, tipRadius - rootRadius), 0, 1);
      return along * along * (3 - 2 * along);
    });
    const phase = Math.atan2(rest[tip + 1] - 1.75, rest[tip]);
    object.frustumCulled = false;
    spikes.push({ object, position, rest, flex, phase, displacement: 0 });
  });
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
  const oneShotStates = new Set(['wave', 'point', 'joy', 'nod', 'shake', 'fistBump', 'jump']);
  let activeState = '';
  let activeAction = null;

  function play(name) {
    if (name === activeState) return;
    const next = actions.get(name);
    if (!next) return;
    const once = oneShotStates.has(name);
    next.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.setEffectiveWeight(1).play();
    if (activeAction) activeAction.crossFadeTo(next, 0.42, true);
    activeAction = next;
    activeState = name;
  }
  play('idle');

  const findRigControl = (name) => model.getObjectByName(name.replaceAll(' ', '_')) || model.getObjectByName(name);
  const mouthControl = findRigControl('Drok talk mouth control');
  const smileControl = findRigControl('Drok smile control');
  const smirkControl = findRigControl('Drok smirk control');
  const eyes = ['L', 'R'].map((side) => ({
    blink: findRigControl(`Drok ${side} eye blink`),
    brow: findRigControl(`Drok ${side} eyebrow pose`)
  }));
  const mouthShapes = [
    [0.06, 0.06], [0.94, 1.1], [1.12, 0.6], [0.7, 0.55],
    [0.67, 1.08], [0.52, 0.82], [0.08, 0.08]
  ];
  let mouthWidth = 0;
  let mouthHeight = 0;
  let smileBlend = 1;
  let blinkBlend = 0;
  let browBlend = 0;
  function swaySpikes(now, delta) {
    if (reducedMotion) return;
    const seconds = now / 1000;
    for (const spike of spikes) {
      const { object, position, rest, flex, phase } = spike;
      const target = Math.sin(seconds * 1.15 + phase * 1.3) * 0.052
        + Math.sin(seconds * 0.56 + phase * 0.7) * 0.018;
      spike.displacement = THREE.MathUtils.lerp(spike.displacement, target, 1 - Math.exp(-delta * 7));
      for (let i = 0; i < position.count; i++) {
        const at = i * 3;
        const x = rest[at];
        const y = rest[at + 1];
        const z = rest[at + 2];
        const tangent = Math.hypot(x, y - 1.75) || 1;
        const bend = spike.displacement * flex[i];
        position.setXYZ(i, x - (y - 1.75) / tangent * bend, y + x / tangent * bend,
          z + 0.16 * bend);
      }
      position.needsUpdate = true;
      object.geometry.computeVertexNormals();
    }
  }
  return {
    get activeAnimation() { return activeState; },
    sync(pose, now, delta) {
      const gesture = pose.gesture?.type || null;
      const talking = pose.speechFrame != null;
      const state = gesture === 'think' ? 'thinking'
        : actions.has(gesture) ? gesture
          : pose.walking ? 'listening' : talking ? 'talking' : 'idle';
      play(state);
      mixer.update(delta);
      swaySpikes(now, delta);

      // The cavity keeps its depth while the visible width and height follow
      // vowel cues. Damping hides abrupt text-boundary changes.
      if (mouthControl) {
        const cue = talking ? Math.min(6, Math.max(0, Math.floor(pose.speechFrame / 7))) : 0;
        const target = talking ? mouthShapes[cue] : [0, 0];
        const mouthBlend = 1 - Math.exp(-delta * 14);
        mouthWidth = THREE.MathUtils.lerp(mouthWidth, target[0], mouthBlend);
        mouthHeight = THREE.MathUtils.lerp(mouthHeight, target[1], mouthBlend);
        // The exported face is Y-up: X shapes width, Y shapes the vowel opening.
        mouthControl.scale.set(mouthWidth, mouthHeight, 1);
      }

      const open = Math.max(mouthWidth, mouthHeight);
      const smileTarget = talking ? THREE.MathUtils.clamp(1 - open * 0.57, 0.3, 1) : 1;
      smileBlend = THREE.MathUtils.lerp(smileBlend, smileTarget, 1 - Math.exp(-delta * 10));
      if (smileControl) smileControl.scale.multiplyScalar(smileBlend);
      if (smirkControl) smirkControl.scale.multiplyScalar(smileBlend);

      blinkBlend = THREE.MathUtils.lerp(blinkBlend, pose.blink ? 1 : 0, 1 - Math.exp(-delta * 32));
      const browTarget = gesture === 'think' ? -0.065
        : ['joy', 'happy', 'wave', 'dance'].includes(gesture) ? 0.055
          : talking ? 0.018 : 0;
      browBlend = THREE.MathUtils.lerp(browBlend, browTarget, 1 - Math.exp(-delta * 8));
      eyes.forEach(({ blink, brow }, index) => {
        if (blink) blink.scale.y *= 1 - blinkBlend * 0.88;
        if (brow) brow.rotation.z += (index === 0 ? -1 : 1) * browBlend;
      });

      const elapsed = gesture ? Math.max(0, (now - pose.gesture.started) / 1000) : 0;
      const gazeX = pose.gaze?.x || 0;
      const gazeY = pose.gaze?.y || 0;
      let roll = 0;
      let yaw = gazeX * 0.14;
      let pitch = gazeY * 0.09;
      let bob = 0.012 * Math.sin(now * 0.0016);
      if (pose.walking) { roll += 0.06 * Math.sin(elapsed * 5); bob += 0.035 * Math.sin(now * 0.006); }
      if (gesture === 'think') { roll -= 0.025; pitch += 0.04; }
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
