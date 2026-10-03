import * as THREE from './vendor/three.module.js';
import { loadRobotAvatar } from './robot-avatar.js';

const actor = document.getElementById('avatarActor');
const canvas = document.getElementById('avatar3dCanvas');

try {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 3 / 4, 0.1, 30);
  // Leave generous room for the Wave, Jump, and Dance clips at the canvas edges.
  camera.position.set(0, 1.65, 7.8);
  camera.lookAt(0, 1.57, 0);
  scene.add(new THREE.HemisphereLight(0xd9f4ff, 0x26304d, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.position.set(2.5, 4.5, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x70d9eb, 2.2);
  rim.position.set(-2.5, 3, -3);
  scene.add(rim);

  const material = (color, roughness = 0.82, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const skin = material(0xe3a985);
  const blush = material(0xd88c78);
  const hair = material(0x24213d);
  const hairLight = material(0x494563);
  const jacket = material(0x37999b);
  const jacketShade = material(0x287d84);
  const innerShirt = material(0xe3f1ed);
  const trousers = material(0x34435e);
  const shoes = material(0x242a3d);
  const eyeWhite = material(0xf9faf8);
  const iris = material(0x497b81);
  const pupil = material(0x1b2635);
  const lip = material(0x974b58);
  const mouthDark = material(0x401e2d);

  const sphereGeometry = new THREE.SphereGeometry(1, 20, 14);
  function sphere(parent, name, shade, x, y, z, sx, sy, sz) {
    const mesh = new THREE.Mesh(sphereGeometry, shade);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  }
  function capsule(parent, name, shade, x, y, z, radius, length) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 4, 10), shade);
    mesh.name = name;
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  const character = new THREE.Group();
  character.name = 'Nova3D';
  character.position.y = 0.17;
  scene.add(character);
  let robot = null;
  loadRobotAvatar(scene).then((loaded) => {
    robot = loaded;
    character.visible = false;
    actor.dataset.model = 'RobotExpressive';
    actor.dataset.headTracking = loaded.hasHeadBone ? 'rig' : 'unavailable';
  }).catch((error) => {
    console.warn('Rigged robot could not load; retaining the procedural avatar.', error);
    actor.dataset.model = 'procedural-fallback';
  });
  const body = new THREE.Group();
  character.add(body);

  sphere(body, 'hips', trousers, 0, 0.87, 0, 0.39, 0.22, 0.27);
  sphere(body, 'jacket', jacket, 0, 1.47, 0, 0.45, 0.62, 0.30);
  sphere(body, 'shirt', innerShirt, 0, 1.71, 0.28, 0.23, 0.29, 0.035);
  sphere(body, 'collar', jacketShade, 0, 1.92, 0.08, 0.43, 0.12, 0.30);
  capsule(body, 'neck', skin, 0, 2.02, 0, 0.15, 0.33);
  sphere(body, 'lapel left', jacketShade, -0.19, 1.66, 0.29, 0.12, 0.30, 0.035).rotation.z = -0.45;
  sphere(body, 'lapel right', jacketShade, 0.19, 1.66, 0.29, 0.12, 0.30, 0.035).rotation.z = 0.45;

  const head = new THREE.Group();
  head.position.set(0, 2.07, 0);
  body.add(head);
  sphere(head, 'hair back', hair, 0, 0.37, -0.12, 0.61, 0.75, 0.50);
  sphere(head, 'face', skin, 0, 0.36, 0.10, 0.52, 0.63, 0.46);
  sphere(head, 'left ear', skin, -0.53, 0.32, 0.07, 0.12, 0.19, 0.10);
  sphere(head, 'right ear', skin, 0.53, 0.32, 0.07, 0.12, 0.19, 0.10);
  sphere(head, 'left hair lock', hair, -0.51, 0.12, 0.03, 0.18, 0.52, 0.31);
  sphere(head, 'right hair lock', hair, 0.51, 0.12, 0.03, 0.18, 0.52, 0.31);
  sphere(head, 'hair fringe', hair, -0.19, 0.83, 0.35, 0.42, 0.20, 0.22).rotation.z = -0.13;
  sphere(head, 'hair highlight', hairLight, -0.35, 0.67, 0.43, 0.12, 0.24, 0.07).rotation.z = -0.35;
  sphere(head, 'nose', skin, 0, 0.26, 0.56, 0.075, 0.09, 0.09);
  sphere(head, 'left cheek', blush, -0.36, 0.20, 0.44, 0.12, 0.05, 0.015);
  sphere(head, 'right cheek', blush, 0.36, 0.20, 0.44, 0.12, 0.05, 0.015);

  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.21, 0.47, 0.51);
    head.add(eye);
    sphere(eye, 'eye white', eyeWhite, 0, 0, 0, 0.115, 0.13, 0.045);
    sphere(eye, 'iris', iris, side * 0.012, -0.005, 0.042, 0.064, 0.075, 0.022);
    sphere(eye, 'pupil', pupil, side * 0.012, -0.005, 0.063, 0.036, 0.048, 0.012);
    sphere(eye, 'catchlight', eyeWhite, side * 0.012 - 0.018, 0.023, 0.076, 0.018, 0.023, 0.008);
    sphere(head, 'eyebrow', hair, side * 0.21, 0.66, 0.50, 0.14, 0.025, 0.026).rotation.z = side * 0.1;
    eyes.push(eye);
  }

  const mouth = new THREE.Group();
  mouth.position.set(0, 0.05, 0.54);
  mouth.scale.set(0.12, 0.025, 1);
  head.add(mouth);
  const mouthCavity = sphere(mouth, 'mouth cavity', mouthDark, 0, 0, 0, 1, 1, 0.015);
  const lipOutline = new THREE.Mesh(new THREE.TorusGeometry(1, 0.10, 6, 24), lip);
  lipOutline.position.z = 0.016;
  mouth.add(lipOutline);
  const teeth = sphere(mouth, 'teeth', eyeWhite, 0, 0.33, 0.023, 0.66, 0.15, 0.007);

  const arms = [];
  const elbows = [];
  const legs = [];
  const knees = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.48, 1.88, 0);
    body.add(arm);
    capsule(arm, 'sleeve', jacket, 0, -0.29, 0, 0.155, 0.61);
    const elbow = new THREE.Group();
    elbow.position.y = -0.57;
    arm.add(elbow);
    capsule(elbow, 'forearm', jacketShade, 0, -0.22, 0, 0.13, 0.46);
    sphere(elbow, 'hand', skin, 0, -0.48, 0, 0.14, 0.16, 0.11);
    arms.push(arm);
    elbows.push(elbow);

    const leg = new THREE.Group();
    leg.position.set(side * 0.20, 0.81, 0);
    body.add(leg);
    capsule(leg, 'trouser upper', trousers, 0, -0.24, 0, 0.16, 0.54);
    const knee = new THREE.Group();
    knee.position.y = -0.48;
    leg.add(knee);
    capsule(knee, 'trouser lower', trousers, 0, -0.22, 0, 0.135, 0.47);
    sphere(knee, 'shoe', shoes, 0, -0.48, 0.10, 0.18, 0.10, 0.27);
    legs.push(leg);
    knees.push(knee);
  }

  let lastTime = performance.now();
  function updateSize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    if (canvas.width !== Math.round(width * renderer.getPixelRatio())
      || canvas.height !== Math.round(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }
  const smooth = (value, target, blend) => THREE.MathUtils.lerp(value, target, blend);
  function sync(pose, now) {
    const delta = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    const blend = 1 - Math.exp(-delta * 10);
    const t = now / 1000;
    if (robot) {
      robot.sync(pose, now, delta);
      updateSize();
      renderer.render(scene, camera);
      return;
    }
    const walking = pose.walking;
    const gesture = pose.gesture?.type;
    const gestureTime = pose.gesture ? (now - pose.gesture.started) / 1000 : 0;
    const walkPhase = (now - pose.walkStarted) * Math.PI * 2 / 2100;
    const swing = walking ? Math.sin(walkPhase) : 0;
    let leftArm = 0.08 - swing * 0.40;
    let rightArm = -0.08 + swing * 0.40;
    let leftElbow = 0;
    let rightElbow = 0;
    let leftLeg = swing * 0.46;
    let rightLeg = -swing * 0.46;
    let leftKnee = walking ? Math.max(0, -swing) * 0.35 : 0;
    let rightKnee = walking ? Math.max(0, swing) * 0.35 : 0;
    let sway = 0.018 * Math.sin(t * 1.2);
    let bob = walking ? Math.abs(swing) * 0.035 : 0.018 * Math.sin(t * 1.8);

    if (gesture === 'point') {
      rightArm = 1.12;
      rightElbow = -0.18;
      sway = 0.06;
    } else if (gesture === 'wave') {
      rightArm = 2.45 + 0.13 * Math.sin(gestureTime * 5);
      rightElbow = -0.35 + 0.35 * Math.sin(gestureTime * 6);
      sway = 0.035 * Math.sin(gestureTime * 4);
    } else if (gesture === 'dance') {
      leftArm = -1.5 - 0.38 * Math.sin(gestureTime * 4);
      rightArm = 1.5 + 0.38 * Math.sin(gestureTime * 4 + 1.2);
      leftElbow = -0.22;
      rightElbow = 0.22;
      leftLeg = 0.28 * Math.sin(gestureTime * 4);
      rightLeg = -leftLeg;
      leftKnee = rightKnee = 0.16;
      sway = 0.10 * Math.sin(gestureTime * 4);
      bob = 0.07 * Math.sin(gestureTime * 8);
    } else if (gesture === 'joy') {
      leftArm = -2.22;
      rightArm = 2.22;
      leftElbow = -0.22;
      rightElbow = 0.22;
      bob = 0.08 * Math.sin(gestureTime * 7);
    }

    arms[0].rotation.z = smooth(arms[0].rotation.z, leftArm, blend);
    arms[1].rotation.z = smooth(arms[1].rotation.z, rightArm, blend);
    elbows[0].rotation.z = smooth(elbows[0].rotation.z, leftElbow, blend);
    elbows[1].rotation.z = smooth(elbows[1].rotation.z, rightElbow, blend);
    legs[0].rotation.x = smooth(legs[0].rotation.x, leftLeg, blend);
    legs[1].rotation.x = smooth(legs[1].rotation.x, rightLeg, blend);
    knees[0].rotation.x = smooth(knees[0].rotation.x, leftKnee, blend);
    knees[1].rotation.x = smooth(knees[1].rotation.x, rightKnee, blend);
    body.rotation.z = smooth(body.rotation.z, sway, blend);
    body.position.y = smooth(body.position.y, bob, blend);
    body.scale.y = smooth(body.scale.y, 1 + 0.012 * Math.sin(t * 1.6), blend);
    head.rotation.z = smooth(head.rotation.z, -sway * 0.6 + 0.025 * Math.sin(t * 0.9), blend);
    head.rotation.x = smooth(head.rotation.x, 0.025 * Math.sin(t * 1.3) + (pose.gaze?.y || 0) * 0.16, blend);
    head.rotation.y = smooth(head.rotation.y, (pose.gaze?.x || 0) * 0.27, blend);
    character.rotation.y = smooth(character.rotation.y, walking ? (pose.direction >= 0 ? 0.23 : -0.23) : 0.08, blend);

    const mouthShapes = [
      [0.12, 0.025], [0.16, 0.19], [0.25, 0.075], [0.18, 0.09],
      [0.115, 0.17], [0.09, 0.115], [0.12, 0.020]
    ];
    const cue = pose.speechFrame == null ? 0 : Math.min(6, Math.floor(pose.speechFrame / 7));
    const [targetWidth, targetHeight] = mouthShapes[cue];
    const variation = pose.speechFrame == null ? 1 : 0.94 + 0.06 * Math.sin(t * 15);
    mouth.scale.x = smooth(mouth.scale.x, targetWidth, blend * 1.5);
    mouth.scale.y = smooth(mouth.scale.y, targetHeight * variation, blend * 1.5);
    teeth.visible = cue === 1 || cue === 4;
    eyes.forEach((eye) => { eye.scale.y = smooth(eye.scale.y, pose.blink ? 0.08 : 1, blend * 1.5); });

    updateSize();
    renderer.render(scene, camera);
  }

  actor.dataset.renderer = 'three';
  window.Nova3D = { ready: true, sync };
  window.dispatchEvent(new Event('nova3dready'));
} catch (error) {
  console.warn('Three.js avatar unavailable; keeping the sprite fallback.', error);
  window.dispatchEvent(new Event('nova3dfailed'));
}
