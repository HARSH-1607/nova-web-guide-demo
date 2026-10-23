import * as THREE from 'three';
import { GLTFLoader } from './vendor/examples/jsm/loaders/GLTFLoader.js';

// The downloaded CC0 model supplies the rig, body clips, and three facial morphs.
// Its morphs are expressions rather than phonemes, so speech is an approximation.
export async function loadRobotAvatar(scene) {
  const gltf = await new GLTFLoader().loadAsync(new URL('./models/RobotExpressive.glb', import.meta.url).href);
  const root = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('Robot model has invalid bounds');
  root.scale.setScalar(3.35 / size.y);
  const scaled = new THREE.Box3().setFromObject(root);
  root.position.set(
    -(scaled.min.x + scaled.max.x) / 2,
    0.17 - scaled.min.y,
    -(scaled.min.z + scaled.max.z) / 2
  );
  const restingY = root.position.y;
  const restingScaleY = root.scale.y;
  scene.add(root);

  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map(gltf.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
  const face = root.getObjectByName('Head_4');
  let headBone = null;
  root.traverse((part) => { if (!headBone && part.isBone && part.name === 'Head') headBone = part; });
  const morphs = face?.morphTargetDictionary || {};
  let active = null;
  let activeName = '';
  let lastGesture = null;
  let gazeYaw = 0;
  let gazePitch = 0;
  const appliedGaze = new THREE.Quaternion();
  const inverseGaze = new THREE.Quaternion();
  const gazeEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  function play(name, duration) {
    const next = actions.get(name);
    if (!next || (next === active && name === activeName)) return;
    if (active) active.fadeOut(0.24);
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).fadeIn(0.24).play();
    if (duration) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
      next.timeScale = next.getClip().duration / duration;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    }
    active = next;
    activeName = name;
  }

  play('Idle');
  const expression = (name, target, blend) => {
    const index = morphs[name];
    if (index !== undefined) {
      face.morphTargetInfluences[index] = THREE.MathUtils.lerp(face.morphTargetInfluences[index], target, blend);
    }
  };

  return {
    hasHeadBone: Boolean(headBone),
    get activeAnimation() { return activeName; },
    sync(pose, now, delta) {
      // Remove the previous offset before the mixer applies this frame's rig pose.
      // This also works for clips that do not key the head bone.
      if (headBone) headBone.quaternion.multiply(inverseGaze.copy(appliedGaze).invert());
      const gesture = pose.gesture?.type || null;
      const gestureKey = gesture ? `${gesture}:${pose.gesture.started}` : null;
      if (gestureKey !== lastGesture || (!gesture && (pose.walking ? 'Walking' : 'Idle') !== activeName)) {
        lastGesture = gestureKey;
        const clips = {
          wave: 'Wave', dance: 'Dance', joy: 'Jump', point: 'ThumbsUp',
          nod: 'Yes', shake: 'No', fistBump: 'Punch', jump: 'Jump', think: 'Idle'
        };
        const name = clips[gesture] || (pose.walking ? 'Walking' : 'Idle');
        play(name, gesture && gesture !== 'dance' && gesture !== 'think'
          ? Math.max(0.8, (pose.gesture.duration || 2200) / 1000) : 0);
      }
      mixer.update(delta);
      const attention = pose.walking ? 0.45 : gesture === 'dance' ? 0.55 : 1;
      const gazeBlend = 1 - Math.exp(-delta * 5.5);
      const idleYaw = pose.gaze ? 0 : 0.065 * Math.sin(now * 0.00047);
      const idlePitch = pose.gaze ? 0 : 0.028 * Math.sin(now * 0.00071);
      gazeYaw = THREE.MathUtils.lerp(gazeYaw, ((pose.gaze?.x || 0) * 0.40 + idleYaw + (gesture === 'think' ? 0.16 : 0)) * attention, gazeBlend);
      gazePitch = THREE.MathUtils.lerp(gazePitch, ((pose.gaze?.y || 0) * 0.22 + idlePitch + (gesture === 'think' ? 0.08 : 0)) * attention, gazeBlend);
      if (headBone) {
        appliedGaze.setFromEuler(gazeEuler.set(gazePitch, gazeYaw, 0));
        headBone.quaternion.multiply(appliedGaze);
      }
      const t = now / 1000;
      const cue = pose.speechFrame == null ? 0 : Math.min(6, Math.floor(pose.speechFrame / 7));
      const open = [0, 0.78, 0.34, 0.27, 0.88, 0.58, 0][cue];
      const blend = 1 - Math.exp(-delta * 15);
      expression('Surprised', Math.max(open, gesture === 'joy' || gesture === 'jump' ? 0.32 : 0), blend);
      expression('Sad', gesture === 'think' ? 0.14 : 0, blend);
      expression('Angry', 0, blend);
      // The robot has no blink morph, so gentle breathing and glances keep idle alive.
      root.position.y = THREE.MathUtils.lerp(root.position.y, restingY + 0.009 * Math.sin(t * 1.6), blend);
      root.scale.y = THREE.MathUtils.lerp(root.scale.y, restingScaleY * (1 + 0.004 * Math.sin(t * 1.6)), blend);
      root.rotation.z = THREE.MathUtils.lerp(root.rotation.z, 0.012 * Math.sin(t * 1.1) + (gesture === 'think' ? -0.035 : 0), blend);
      root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, pose.walking ? (pose.direction >= 0 ? 0.18 : -0.18) : 0, blend);
    }
  };
}
