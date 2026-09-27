import * as THREE from './assets/vendor/three.module.js';

// This scene visualizes a scalar interface example. It does not run a policy.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = value => value * value * (3 - 2 * value);
const shoulder = new THREE.Vector3(-1, 0.48, 0);
const lengths = [1.04, 1.14];
const target = new THREE.Vector3(0.03, 0.105, 0.10);
const initialView = { yaw: 0.54, elevation: 0.52, distance: 4.90 };
const view = { ...initialView };
const state = { ratio: 6, beta: .5, mode: 'merge', specific: 49 / 24, shared: 1, progress: 1, paused: false, renderer: 'webgl', visible: false };
const scenes = [];
let startTime = 0;
let animationFrame = 0;

function pathPoint(action, progress) {
  const u = smooth(progress);
  return new THREE.Vector3(-0.70 + 0.73 * action * u, 0.46 + 0.30 * (1 - u) + Math.sin(u * Math.PI) * 0.38, 0.10 + 0.45 * (1 - u));
}

// A vertical-plane two-link solution, rotated about the base toward the wrist.
function solveArm(wrist) {
  const delta = wrist.clone().sub(shoulder);
  const radial = Math.hypot(delta.x, delta.z);
  const distance = clamp(Math.hypot(radial, delta.y), 0.001, lengths[0] + lengths[1] - 0.001);
  const direction = Math.atan2(delta.y, radial);
  const elbowOffset = Math.acos(clamp((lengths[0] ** 2 + distance ** 2 - lengths[1] ** 2) / (2 * lengths[0] * distance), -1, 1));
  const lift = direction + elbowOffset;
  const yaw = Math.atan2(delta.z, delta.x);
  const elbow = new THREE.Vector3(shoulder.x + Math.cos(yaw) * lengths[0] * Math.cos(lift), shoulder.y + lengths[0] * Math.sin(lift), shoulder.z + Math.sin(yaw) * lengths[0] * Math.cos(lift));
  return { elbow, wrist, yaw, lift };
}

function mesh(geometry, material, parent, position) {
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  if (position) object.position.copy(position);
  parent.add(object);
  return object;
}

function segment(object, a, b) {
  const delta = b.clone().sub(a);
  object.position.copy(a).add(b).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
}

function createScene(mount, id) {
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${id === 'shared' ? 'Shared' : 'Task-specific'} interface robot-arm illustration. Drag to orbit; arrow keys rotate; Home resets the view.`);
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab;outline-offset:-3px;';
  mount.replaceChildren(canvas);
  mount.style.position = 'relative';
  const hint = document.createElement('div');
  hint.textContent = 'Drag to rotate';
  hint.style.cssText = 'position:absolute;right:16px;bottom:13px;pointer-events:none;font:400 11px/1.4 system-ui,sans-serif;color:#778189;';
  mount.append(hint);
  const label = document.createElement('div');
  label.className = 'robot-target-label';
  label.style.cssText = 'position:absolute;pointer-events:none;transform:translate(-50%,-100%);font:500 11px/1.4 system-ui,sans-serif;color:#4f606c;background:rgba(255,255,255,.9);padding:3px 7px;border:1px solid #dce1e4;border-radius:3px;white-space:nowrap;';
  label.textContent = 'Target';
  mount.append(label);
  const data = { mount, canvas, id, width: 0, height: 0, label, trajectoryAction: -1, lastMode: '', jointPositions: null };
  try {
    const context = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'low-power' });
    if (!context) throw new Error('WebGL is unavailable; using the software projection.');
    const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f7f3ec');
    scene.fog = new THREE.Fog(scene.background, 7, 15);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 40);
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a968a', 3));
    const key = new THREE.DirectionalLight('#fff8e7', 4);
    key.position.set(-2.4, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 15 });
    key.shadow.normalBias = 0.03;
    key.shadow.bias = -0.0001;
    scene.add(key);
    const rim = new THREE.DirectionalLight('#d5e7ff', 2);
    rim.position.set(3, 3, -4);
    scene.add(rim);
    const materials = {
      shell: new THREE.MeshStandardMaterial({ color: '#eeeee4', roughness: 0.36, metalness: 0.24 }),
      dark: new THREE.MeshStandardMaterial({ color: '#29343b', roughness: 0.5, metalness: 0.55 }),
      accent: new THREE.MeshStandardMaterial({ color: id === 'shared' ? '#C94E46' : '#6f91af', roughness: 0.35, metalness: 0.3 }),
      hardware: new THREE.MeshStandardMaterial({ color: '#99aaa7', roughness: 0.25, metalness: 0.8 }),
      target: new THREE.MeshStandardMaterial({ color: '#d6a35a', roughness: 0.45, metalness: 0.06 }),
    };
    mesh(new THREE.BoxGeometry(5.5, 0.14, 4.4), new THREE.MeshStandardMaterial({ color: '#eee5d8', roughness: 0.92 }), scene, new THREE.Vector3(0, -0.09, 0));
    const floor = mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#f7f3ec', roughness: 1 }), scene, new THREE.Vector3(0, -0.17, 0));
    floor.rotation.x = -Math.PI / 2;
    const grid = new THREE.GridHelper(4.4, 22, '#cbd2d6', '#d7dddf');
    grid.position.y = -0.016;
    grid.material.transparent = true;
    grid.material.opacity = 0.52;
    scene.add(grid);
    // Mounting plate, bolt heads, plinth, and base joint.
    mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.055, 48), materials.dark, scene, new THREE.Vector3(-1, 0.028, 0));
    mesh(new THREE.CylinderGeometry(0.255, 0.29, 0.22, 48), materials.shell, scene, new THREE.Vector3(-1, 0.155, 0));
    mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.035, 48), materials.accent, scene, new THREE.Vector3(-1, 0.26, 0));
    mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.16, 40), materials.dark, scene, new THREE.Vector3(-1, 0.345, 0));
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI / 4 + i * Math.PI / 2;
      mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.016, 6), materials.hardware, scene, new THREE.Vector3(-1 + Math.cos(angle) * 0.31, 0.06, Math.sin(angle) * 0.31));
    }
    function link(length, radius) {
      const group = new THREE.Group();
      mesh(new THREE.CapsuleGeometry(radius, length - radius * 2, 6, 20), materials.shell, group);
      mesh(new THREE.BoxGeometry(radius * 0.58, length * 0.48, radius * 0.10), materials.dark, group, new THREE.Vector3(0, 0, radius * 0.965));
      const band = mesh(new THREE.CylinderGeometry(radius * 1.01, radius * 1.01, 0.038, 32), materials.accent, group, new THREE.Vector3(0, length * 0.25, 0));
      band.castShadow = false;
      scene.add(group);
      return group;
    }
    function joint(radius, width) {
      const group = new THREE.Group();
      const drum = mesh(new THREE.CylinderGeometry(radius, radius, width, 40), materials.dark, group);
      drum.rotation.x = Math.PI / 2;
      for (const direction of [-1, 1]) {
        const cap = mesh(new THREE.CylinderGeometry(radius * 0.78, radius * 0.78, 0.025, 40), materials.shell, group, new THREE.Vector3(0, 0, direction * width / 2));
        cap.rotation.x = Math.PI / 2;
        const pin = mesh(new THREE.CylinderGeometry(radius * 0.30, radius * 0.30, 0.03, 24), materials.hardware, group, new THREE.Vector3(0, 0, direction * (width / 2 + 0.015)));
        pin.rotation.x = Math.PI / 2;
      }
      scene.add(group);
      return group;
    }
    const upper = link(lengths[0], 0.13);
    const forearm = link(lengths[1], 0.10);
    const baseJoint = joint(0.19, 0.32);
    const elbowJoint = joint(0.15, 0.265);
    const wristJoint = joint(0.115, 0.20);
    const gripper = new THREE.Group();
    mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.11, 24), materials.dark, gripper, new THREE.Vector3(0, -0.07, 0));
    mesh(new THREE.BoxGeometry(0.16, 0.085, 0.265), materials.shell, gripper, new THREE.Vector3(0, -0.13, 0));
    for (const direction of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.047, 0.19, 0.04), materials.dark, gripper, new THREE.Vector3(0, -0.245, direction * 0.12));
      mesh(new THREE.BoxGeometry(0.065, 0.055, 0.05), materials.hardware, gripper, new THREE.Vector3(0, -0.31, direction * 0.107));
    }
    scene.add(gripper);
    mesh(new THREE.BoxGeometry(0.185, 0.20, 0.185), materials.target, scene, target);
    // A dark seam makes the target read as a physical object at smaller sizes.
    mesh(new THREE.BoxGeometry(0.187, 0.012, 0.187), new THREE.MeshStandardMaterial({ color: '#ab7f42', roughness: 0.7 }), scene, target.clone().add(new THREE.Vector3(0, 0.028, 0)));
    const targetRing = mesh(new THREE.RingGeometry(0.17, 0.185, 64), new THREE.MeshBasicMaterial({ color: '#7d9787', side: THREE.DoubleSide, transparent: true, opacity: 0.7 }), scene, new THREE.Vector3(target.x, 0.006, target.z));
    targetRing.rotation.x = -Math.PI / 2;
    const endpoint = mesh(new THREE.RingGeometry(0.105, 0.13, 48), new THREE.MeshBasicMaterial({ color: '#477992', side: THREE.DoubleSide }), scene);
    endpoint.rotation.x = -Math.PI / 2;
    const tip = mesh(new THREE.SphereGeometry(0.027, 16, 12), new THREE.MeshBasicMaterial({ color: '#477992' }), scene);
    const trajectory = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#6b8fa3', dashSize: 0.045, gapSize: 0.035, transparent: true, opacity: 0.4 }));
    const travelled = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#477992', transparent: true, opacity: 0.9 }));
    const deviation = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#6f91af', dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.9 }));
    scene.add(trajectory, travelled, deviation);
    const reference = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({length:81},(_,i)=>pathPoint(1,i/80).add(new THREE.Vector3(0,-.31,0)))), new THREE.LineDashedMaterial({color:'#8a8d86',dashSize:.025,gapSize:.04,transparent:true,opacity:.6}));
    reference.computeLineDistances();
    scene.add(reference);
    // A target footprint and reference path stay fixed when the mixture changes.
    const targetOutline = new THREE.BoxHelper(scene.children.find(object => object.isMesh && object.geometry.type === 'BoxGeometry' && object.position.equals(target)), '#ae8959');
    scene.add(targetOutline);
    Object.assign(data, { renderer, scene, camera, upper, forearm, baseJoint, elbowJoint, wristJoint, gripper, endpoint, tip, trajectory, travelled, deviation, materials });
  } catch (error) {
    state.fallbackReason = error.message;
    // A fresh canvas can obtain 2D even if WebGL context initialization failed.
    const fallback = canvas.cloneNode();
    canvas.replaceWith(fallback);
    data.canvas = fallback;
    data.context = fallback.getContext('2d');
    state.renderer = 'canvas-fallback';
  }
  attachOrbit(data.canvas);
  new ResizeObserver(() => { resize(data); render(); }).observe(mount);
  return data;
}

function resize(data) {
  const { width, height } = data.mount.getBoundingClientRect();
  if (!width || !height) return;
  data.width = width;
  data.height = height;
  if (data.renderer) {
    data.renderer.setSize(width, height, false);
    data.camera.aspect = width / height;
    data.camera.updateProjectionMatrix();
  } else {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    data.canvas.width = width * dpr;
    data.canvas.height = height * dpr;
    data.context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function cameraPosition() {
  return new THREE.Vector3(Math.sin(view.yaw) * Math.cos(view.elevation) * view.distance, Math.sin(view.elevation) * view.distance + 0.58, Math.cos(view.yaw) * Math.cos(view.elevation) * view.distance);
}

function project(data, point) {
  const camera = data.camera || new THREE.PerspectiveCamera(35, data.width / data.height, 0.1, 40);
  camera.position.copy(cameraPosition());
  camera.lookAt(0, 0.65, 0);
  camera.updateMatrixWorld();
  const projected = point.clone().project(camera);
  return { x: (projected.x * 0.5 + 0.5) * data.width, y: (-projected.y * 0.5 + 0.5) * data.height };
}

function replacePoints(line, points) {
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(points);
}

function renderWebGL(data, pose, output) {
  const { scene, camera, renderer } = data;
  camera.position.copy(cameraPosition());
  camera.lookAt(0, 0.65, 0);
  segment(data.upper, shoulder, pose.elbow);
  segment(data.forearm, pose.elbow, pose.wrist);
  data.baseJoint.position.copy(shoulder);
  data.elbowJoint.position.copy(pose.elbow);
  data.wristJoint.position.copy(pose.wrist);
  [data.baseJoint, data.elbowJoint, data.wristJoint].forEach(joint => { joint.rotation.y = -pose.yaw; });
  data.gripper.position.copy(pose.wrist);
  data.gripper.rotation.y = -pose.yaw;
  data.tip.position.copy(pose.wrist).add(new THREE.Vector3(0, -0.31, 0));
  if (data.trajectoryAction !== output || data.lastMode !== state.mode) {
    const mismatch = output > 1.00001;
    const color = data.id === 'shared' ? '#c94e46' : '#6f91af';
    const points = Array.from({ length: 81 }, (_, i) => pathPoint(output, i / 80).add(new THREE.Vector3(0, -0.31, 0)));
    replacePoints(data.trajectory, points);
    replacePoints(data.travelled, points);
    data.trajectory.computeLineDistances();
    data.trajectory.material.color.set(color);
    data.travelled.material.color.set(color);
    data.endpoint.material.color.set(color);
    data.tip.material.color.set(color);
    const end = pathPoint(output, 1);
    data.endpoint.position.set(end.x, 0.009, end.z);
    replacePoints(data.deviation, [new THREE.Vector3(target.x, 0.018, target.z), new THREE.Vector3(end.x, 0.018, end.z)]);
    data.deviation.computeLineDistances();
    data.deviation.visible = mismatch;
    data.trajectoryAction = output;
    data.lastMode = state.mode;
  }
  data.travelled.geometry.setDrawRange(0, Math.floor(state.progress * 80) + 1);
  renderer.render(scene, camera);
}

// Software projection keeps the interaction usable when a browser disables WebGL.
function renderFallback(data, pose, output) {
  const context = data.context;
  if (!context) return;
  const p = point => project(data, point);
  const path = (points, color, width, dashed = false) => {
    context.beginPath();
    points.forEach((point, i) => { const at = p(point); i ? context.lineTo(at.x, at.y) : context.moveTo(at.x, at.y); });
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineCap = 'round';
    context.setLineDash(dashed ? [4, 5] : []);
    context.stroke();
    context.setLineDash([]);
  };
  context.fillStyle = '#f7f3ec';
  context.fillRect(0, 0, data.width, data.height);
  for (let i = -10; i <= 10; i++) {
    path([new THREE.Vector3(i * 0.2, 0, -2), new THREE.Vector3(i * 0.2, 0, 2)], '#d7dddf', 0.6);
    path([new THREE.Vector3(-2, 0, i * 0.2), new THREE.Vector3(2, 0, i * 0.2)], '#d7dddf', 0.6);
  }
  const scale = data.height / 4.1;
  const base = p(new THREE.Vector3(-1, 0.11, 0));
  context.save();
  context.fillStyle = '#54433417';
  const shadow = p(new THREE.Vector3(-.35,0,.12));
  context.beginPath();context.ellipse(shadow.x,shadow.y,scale*.95,scale*.23,-.15,0,Math.PI*2);context.fill();
  context.restore();
  context.fillStyle = '#2c3e3b';
  context.beginPath(); context.ellipse(base.x, base.y, scale * 0.36, scale * 0.15, 0, 0, Math.PI * 2); context.fill();
  const pedestal = p(new THREE.Vector3(-1,.27,0));
  path([new THREE.Vector3(-1,.12,0),new THREE.Vector3(-1,.3,0)],'#d5d5cb',scale*.42);
  context.fillStyle='#3a4444';context.beginPath();context.ellipse(pedestal.x,pedestal.y,scale*.22,scale*.09,0,0,Math.PI*2);context.fill();
  const corners = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(([x,y,z]) => p(new THREE.Vector3(target.x+x*.095,target.y+y*.10,target.z+z*.095)));
  [[0,1,2,3,'#b78c4e'],[4,5,6,7,'#c89b56'],[1,5,6,2,'#b3884c'],[3,2,6,7,'#e2b976']].forEach(face=>{context.beginPath();face.slice(0,4).forEach((index,i)=>{const point=corners[index];i?context.lineTo(point.x,point.y):context.moveTo(point.x,point.y);});context.closePath();context.fillStyle=face[4];context.fill();});
  const color = data.id === 'shared' ? '#c94e46' : '#6f91af';
  path(Array.from({length:61},(_,i)=>pathPoint(1,i/60).add(new THREE.Vector3(0,-.31,0))), '#97988e', 1, true);
  path(Array.from({length:61},(_,i)=>pathPoint(output,i/60).add(new THREE.Vector3(0,-.31,0))), color, 1.5, true);
  path(Array.from({length:Math.floor(state.progress*60)+1},(_,i)=>pathPoint(output,i/60).add(new THREE.Vector3(0,-.31,0))), color, 2.7);
  const end = pathPoint(output,1);
  if(output>1.00001) path([new THREE.Vector3(target.x,.018,target.z),new THREE.Vector3(end.x,.018,end.z)],color,1.5,true);
  path([new THREE.Vector3(-1,.30,0), shoulder], '#354341', scale * .30);
  for (const [a,b,width] of [[shoulder,pose.elbow,.30],[pose.elbow,pose.wrist,.24]]) {
    const ap=p(a),bp=p(b);
    const dx=bp.x-ap.x,dy=bp.y-ap.y,len=Math.hypot(dx,dy)||1;
    const nx=-dy/len*scale*width/2,ny=dx/len*scale*width/2;
    const gradient=context.createLinearGradient((ap.x+bp.x)/2-nx,(ap.y+bp.y)/2-ny,(ap.x+bp.x)/2+nx,(ap.y+bp.y)/2+ny);
    gradient.addColorStop(0,'#aeb8b0');gradient.addColorStop(.35,'#faf9f1');gradient.addColorStop(.65,'#e7e9df');gradient.addColorStop(1,'#89958e');
    path([a,b],'#46504b',scale*(width+.025));
    path([a,b],gradient,scale*width);
    path([a.clone().lerp(b,.35),a.clone().lerp(b,.65)],'#59645f',scale*width*.23);
  }
  for (const point of [shoulder,pose.elbow,pose.wrist]) {
    const at = p(point); context.fillStyle='#304540';context.beginPath();context.arc(at.x,at.y,scale*.15,0,Math.PI*2);context.fill();context.fillStyle='#c4cec2';context.beginPath();context.arc(at.x,at.y,scale*.095,0,Math.PI*2);context.fill();context.fillStyle=color;context.beginPath();context.arc(at.x,at.y,scale*.055,0,Math.PI*2);context.fill();
  }
  for (const direction of [-1,1]) path([pose.wrist.clone().add(new THREE.Vector3(0,-.10,direction*.12)),pose.wrist.clone().add(new THREE.Vector3(0,-.31,direction*.12))],'#283e38',scale*.05);
}

function render() {
  scenes.forEach(data => {
    if (!data.width || !data.height) return;
    const output = state[data.id];
    const pose = solveArm(pathPoint(output, state.progress));
    data.jointPositions = { shoulder: shoulder.toArray(), elbow: pose.elbow.toArray(), wrist: pose.wrist.toArray() };
    if (data.renderer) renderWebGL(data, pose, output);
    else renderFallback(data, pose, output);
    const at = project(data, target.clone().add(new THREE.Vector3(0, 0.37, 0)));
    data.label.style.left = `${at.x}px`;
    data.label.style.top = `${at.y}px`;
    data.canvas.setAttribute('aria-label', `${data.id === 'shared' ? 'Shared' : 'Task-specific'} interface. Illustrative reach ${output.toFixed(3)}; target 1.000. Motion ${Math.round(state.progress * 100)} percent. Drag or use arrow keys to rotate.`);
  });
  const progress = document.getElementById('lab-progress');
  if (progress) {
    if ('value' in progress) progress.value = state.progress;
    progress.style.setProperty('--progress', `${state.progress * 100}%`);
    progress.setAttribute('aria-valuenow', String(state.progress));
    progress.setAttribute('aria-valuetext', `${Math.round(state.progress * 100)}% of illustrative motion`);
  }
  const percent = document.getElementById('motion-percent');
  if (percent) percent.value = `${Math.round(state.progress*100)}%`;
  const pause = document.getElementById('lab-pause');
  if (pause) {
    pause.setAttribute('aria-pressed', String(state.paused));
    pause.setAttribute('aria-label', state.paused ? 'Resume robot motion' : 'Pause robot motion');
    pause.textContent = state.paused ? 'Resume' : 'Pause';
    pause.disabled = state.progress >= 1;
  }
  const status = document.getElementById('lab-motion-status');
  if (status) status.textContent = state.progress >= 1 ? 'Motion complete' : state.paused ? 'Motion paused' : 'Reaching target';
}

function animate(now) {
  animationFrame = 0;
  if (state.paused || document.hidden || !state.visible) return;
  state.progress = clamp((now - startTime) / 2400, 0, 1);
  render();
  if (state.progress < 1) animationFrame = requestAnimationFrame(animate);
}

function replay() {
  cancelAnimationFrame(animationFrame);
  state.paused = false;
  state.progress = reducedMotion.matches ? 1 : 0;
  startTime = performance.now();
  render();
  if (state.visible && state.progress < 1) animationFrame = requestAnimationFrame(animate);
}

function reset() {
  Object.assign(view, initialView);
  render();
}

function togglePause() {
  if (state.progress >= 1) return;
  state.paused = !state.paused;
  cancelAnimationFrame(animationFrame);
  if (!state.paused && state.visible) {
    startTime = performance.now() - state.progress * 2400;
    animationFrame = requestAnimationFrame(animate);
  }
  render();
}

function attachOrbit(canvas) {
  let pointer = null;
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    view.yaw -= dx * 0.007;
    view.elevation = clamp(view.elevation + dy * 0.006, 0.15, 1.25);
    pointer = { id: pointer.id, x: event.clientX, y: event.clientY };
    render();
  });
  const release = () => { pointer = null; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('keydown', event => {
    const delta = 0.12;
    if (event.key === 'ArrowLeft') view.yaw += delta;
    else if (event.key === 'ArrowRight') view.yaw -= delta;
    else if (event.key === 'ArrowUp') view.elevation = clamp(view.elevation + delta, 0.15, 1.25);
    else if (event.key === 'ArrowDown') view.elevation = clamp(view.elevation - delta, 0.15, 1.25);
    else if (event.key === 'Home') Object.assign(view, initialView);
    else return;
    event.preventDefault();
    render();
  });
}

function update(detail) {
  if (!detail) return;
  const ratio = clamp(Number(detail.ratio) || 1, 1, 8);
  const mode = ['a', 'b', 'merge'].includes(detail.mode) ? detail.mode : 'merge';
  const beta = mode === 'a' ? 0 : mode === 'b' ? 1 : clamp(Number.isFinite(Number(detail.beta)) ? Number(detail.beta) : .5,0,1);
  Object.assign(state, { ratio, beta, mode, specific: (1-beta+beta/ratio)*(1-beta+beta*ratio), shared: 1 });
  if (detail.replay) replay();
  else { cancelAnimationFrame(animationFrame); state.progress=1; state.paused=false; render(); }
}

for (const id of ['specific', 'shared']) {
  const mount = document.getElementById(`plot-${id}`);
  if (mount) scenes.push(createScene(mount, id));
}
window.addEventListener('policyweave:lab-update', event => update(event.detail));
document.getElementById('lab-replay')?.addEventListener('click', replay);
document.getElementById('lab-reset-view')?.addEventListener('click', reset);
document.getElementById('lab-pause')?.addEventListener('click', togglePause);
document.getElementById('lab-progress')?.addEventListener('input', event => {
  cancelAnimationFrame(animationFrame);
  state.progress = clamp(Number(event.target.value),0,1);
  state.paused = true;
  render();
});
window.robotLab = {
  ready: scenes.length === 2,
  get state() { return { ...state, view: { ...view }, joints: Object.fromEntries(scenes.map(scene => [scene.id, scene.jointPositions])) }; },
  replay,
  reset,
  togglePause,
};
update({ ratio: Number(document.getElementById('interface-ratio')?.value || 6), beta: Number(document.getElementById('merge-weight')?.value ?? .5), mode: document.querySelector('[data-lab-mode][aria-pressed="true"]')?.dataset.labMode || 'merge' });

const lab = document.querySelector('.lab-panels');
if (lab && 'IntersectionObserver' in window) {
  new IntersectionObserver(entries => {
    const visible = entries[0].isIntersecting;
    if (visible === state.visible) return;
    state.visible = visible;
    cancelAnimationFrame(animationFrame);
    if (visible && !state.paused && state.progress < 1 && !document.hidden) {
      startTime = performance.now() - state.progress * 2400;
      animationFrame = requestAnimationFrame(animate);
    }
  }, { threshold: 0.08 }).observe(lab);
} else {
  state.visible = true;
  replay();
}
document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(animationFrame);
  if (!document.hidden && state.visible && !state.paused && state.progress < 1) {
    startTime = performance.now() - state.progress * 2400;
    animationFrame = requestAnimationFrame(animate);
  }
});
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) { state.progress = 1; cancelAnimationFrame(animationFrame); render(); } });
