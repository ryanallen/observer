// Ruth's lab, seen from above like the bay: a still photograph of the room with real depth, shifted a little by the
// pointer and racked into focus where it rests, with the one real thing in it, the box, closed on the worktable. Resting
// on the box opens it; the stone inside glows and the room comes up red around it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const PLATE = { w: 1671, h: 941 };
const BOX_AT = { x: 897 / 1671, y: 478 / 941 };   // where the box stands on the table in the plate (its foot)
const BOX_WIDTH = 52 / 1671;                       // its width in the plate, as a share of the plate's width
const OPEN_ANGLE = .42;                            // how far each lid panel tips out when open, in radians

export function createLab(canvas) {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  let W = 1, H = 1;

  // the box on its own, drawn into a target with its shadow, then laid into the photograph
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(20, 1, .05, 40);
  const pitch = 31 * Math.PI / 180, yaw = .62;
  const key = new THREE.DirectionalLight(0xffc489, 6);       // the desk lamp, up and to the left of the box, toward the viewer
  key.position.set(-.96, 1.8, 1.23); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -.4, right: .4, top: .4, bottom: -.4, near: .1, far: 5 }); key.shadow.bias = -.0004;
  scene.add(key, new THREE.HemisphereLight(0x8a7458, 0x1a120a, 1.1));
  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShadowMaterial({ opacity: .55 }));
  shadowFloor.rotation.x = -Math.PI / 2; shadowFloor.receiveShadow = true; scene.add(shadowFloor);
  const boxTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  // what the box's bronze reflects: a dark room with the desk lamp's warm glow up to the left
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(5, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `varying vec3 d; void main() { d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 d; void main() {
      float lamp = pow(max(dot(d, normalize(vec3(-.5, .65, .55))), 0.0), 6.0);
      float up = smoothstep(-.2, .8, d.y);
      gl_FragColor = vec4(vec3(.05, .035, .022) + vec3(.36, .25, .13) * up + vec3(4.2, 2.6, 1.2) * lamp, 1.0); }`,
  })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, .02).texture; pmrem.dispose();
  envScene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });

  let box = null, gemMat = null, gemLight = null, glowAt = null;
  const hinges = [];
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const texLoader = new THREE.TextureLoader();
  const tex = u => texLoader.loadAsync(u).then(t => { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; });
  const ready = Promise.all([
    tex('models/web/lab_closed_v.webp'), tex('models/web/lab_glow_v.webp'), tex('models/web/lab_depth.jpg'),
    loader.loadAsync('models/web/box_cd.glb'), loader.loadAsync('models/web/stone.glb'),
  ]).then(([closed, glow, depth, gb, gs]) => {
    closed.colorSpace = glow.colorSpace = THREE.SRGBColorSpace;
    Object.assign(u, { closed: { value: closed }, glow: { value: glow }, depth: { value: depth } });
    box = gb.scene;
    box.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.name === 'box_lid_filigree') { o.material.side = THREE.DoubleSide; o.material.alphaTest = o.material.alphaTest || .5; o.material.transparent = false; } }
      const m = /^hinge_(\d)$/.exec(o.name); if (m) hinges.push({ o, base: o.quaternion.clone() });
    });
    // in this room the bronze is seen by the desk lamp alone: less mirror, more of its own warm colour, so it reads as
    // bronze and not a dark block
    const seenMats = new Set();
    box.traverse(o => { if (!o.isMesh || seenMats.has(o.material)) return; const m = o.material; seenMats.add(m);
      m.envMapIntensity = 2.2;
      if (m.name === 'box_bronze' || m.name === 'box_iron') { m.metalness = .55; m.roughness = Math.min(.6, m.roughness + .08); m.color.multiplyScalar(2.6); }
      else if (m.name === 'box_wall_relief' || m.name === 'box_lid_filigree') { m.metalness = .6; m.color.setRGB(1.9, 1.45, 1.0); }
    });
    const seat = box.getObjectByName('gem_seat'); glowAt = box.getObjectByName('gem_glow') || seat || box;
    const g = gs.scene; g.traverse(o => { if (o.isMesh) gemMat = o.material; }); (seat || box).add(g);
    gemLight = new THREE.PointLight(0xff6a32, 0, .6, 2); glowAt.add(gemLight);
    scene.add(box); box.updateMatrixWorld(true);
  });

  // the photograph: closed and glowing plates crossfaded, shifted by depth, racked into focus at the pointer
  const u = {
    closed: { value: null }, glow: { value: null }, depth: { value: null }, boxTex: { value: boxTarget.texture },
    open: { value: 0 }, cover: { value: new THREE.Vector2(1, 1) }, sceneCam: { value: new THREE.Vector2() },
    focusUv: { value: new THREE.Vector2(.5, .5) }, resolution: { value: new THREE.Vector2(1, 1) }, fade: { value: 1 },
    boxAt: { value: new THREE.Vector2(BOX_AT.x, 1 - BOX_AT.y) },
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: u, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform sampler2D closed, glow, depth, boxTex; uniform float open, fade; uniform vec2 cover, sceneCam, focusUv, resolution, boxAt; varying vec2 vUv;
      vec2 plateUv(vec2 s) { vec2 p = (s - .5) * cover + .5; float layer = texture2D(depth, p).r; return p - sceneCam * (.12 + .75 * layer); }
      vec3 room(vec2 s) {
        vec2 p = plateUv(s);
        vec3 c = mix(texture2D(closed, p).rgb, texture2D(glow, p).rgb, open);
        vec4 b = texture2D(boxTex, s);
        return c * (1.0 - b.a) + b.rgb;   // the box's target is premultiplied by its own alpha
      }
      void main() {
        vec3 sharp = room(vUv);
        float here = texture2D(depth, (vUv - .5) * cover + .5).r, pointed = texture2D(depth, (focusUv - .5) * cover + .5).r;
        // the box stands on the table: wherever it covers the picture, it is in focus with the table, not the wall behind
        here = mix(here, texture2D(depth, (boxAt - .5) * cover + .5).r, texture2D(boxTex, vUv).a);
        float blur = max(smoothstep(.045, .30, abs(here - pointed)) * .9, smoothstep(.08, .36, abs(vUv.y - focusUv.y)) * .8);
        vec2 px = vec2(1.0) / resolution * blur * 9.0;
        float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
        vec3 soft = vec3(0.0);
        for (int i = 0; i < 16; i++) {
          float a = float(i) * 2.39996323 + turn, r = sqrt((float(i) + .5) / 16.0);
          soft += room(vUv + px * r * vec2(cos(a), sin(a)));
        }
        gl_FragColor = vec4(mix(sharp, soft / 16.0, blur) * fade, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), photo = new THREE.Scene(); photo.add(quad);

  const st = { open: 0, fade: 1 };
  const look = { x: 0, y: 0 }, view = { x: 0, y: 0 }, focusAt = new THREE.Vector2(BOX_AT.x, BOX_AT.y);
  let time = 0, pointerActive = false, boxPx = { x: 0, y: 0 }, coverX = 1, coverY = 1;

  const resize = () => {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    renderer.setSize(W, H, false);
    const pr = renderer.getPixelRatio(); boxTarget.setSize(Math.round(W * pr), Math.round(H * pr));
    u.resolution.value.set(W, H);
    // the photograph covers the screen: the share of it that shows across and down
    const a = W / H, pa = PLATE.w / PLATE.h;
    coverX = a > pa ? 1 : a / pa; coverY = a > pa ? pa / a : 1; u.cover.value.set(coverX, coverY);
    camera.aspect = a;
    // the box's size on screen matches its size in the photograph
    const boxScreenW = BOX_WIDTH / coverX * W, ppm = boxScreenW / .22;
    const dist = H / (2 * Math.tan(camera.fov * Math.PI / 360) * ppm);
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(0, 0, 0); camera.near = dist * .5; camera.far = dist * 2;
  };
  resize(); addEventListener('resize', resize);

  const render = dt => {
    time += dt;
    // the pointer shifts the view a little as on the moor, and racks the focus to what it rests on
    const idleX = Math.sin(time * .17) * .55, idleY = Math.sin(time * .11 + 1.3) * .35;
    const ease = 1 - Math.exp(-dt * 4);
    view.x += ((pointerActive ? look.x : idleX) - view.x) * ease; view.y += ((pointerActive ? look.y : idleY) - view.y) * ease;
    u.sceneCam.value.set(view.x * .022, -view.y * .014);
    const fx = pointerActive ? (look.x + 1) * .5 : BOX_AT.x, fy = pointerActive ? (1 - look.y) * .5 : 1 - BOX_AT.y;
    focusAt.x += (fx - focusAt.x) * (1 - Math.exp(-dt * 8)); focusAt.y += (fy - focusAt.y) * (1 - Math.exp(-dt * 8));
    u.focusUv.value.copy(focusAt);
    // the box stands where it stood in the photograph and moves with the table under it
    const tableLayer = .55, shift = .12 + .75 * tableLayer;
    const sx = ((BOX_AT.x + u.sceneCam.value.x * shift - .5) / coverX + .5) * W;
    const sy = ((BOX_AT.y - u.sceneCam.value.y * shift - .5) / coverY + .5) * H;
    camera.setViewOffset(W, H, W / 2 - sx, H / 2 - sy, W, H);
    boxPx = { x: sx, y: sy };
    // opening: the panels fold out on their hinges, the stone wakes, the room comes up red
    const o = st.open, glowK = o * (.85 + .1 * Math.sin(time * 1.3) + .05 * Math.sin(time * 3.7 + 1));
    // open as in the approved picture: the panels tipped outward into a crown, not folded flat
    for (const h of hinges) h.o.quaternion.copy(h.base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), o * OPEN_ANGLE));
    // the stone's light is kept low enough that every panel's edge and carving still reads in it
    if (gemMat) gemMat.emissiveIntensity = Math.min(1.2, glowK * 4);
    if (gemLight) gemLight.intensity = glowK * .14;
    u.open.value = THREE.MathUtils.smoothstep(o, 0, 1); u.fade.value = st.fade;
    renderer.setRenderTarget(boxTarget); renderer.setClearColor(0x000000, 0); renderer.clear();
    if (box) renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.render(photo, flat);
  };

  // where the ping sits: on the stone inside the box
  const screen = () => {
    if (!glowAt) return { x: boxPx.x, y: boxPx.y - H * .03 };
    const p = glowAt.getWorldPosition(new THREE.Vector3()).project(camera);
    return { x: (p.x * .5 + .5) * W, y: (-p.y * .5 + .5) * H };
  };
  const setPointer = (x, y) => { pointerActive = true; look.x = x; look.y = y; };

  const dispose = () => {
    removeEventListener('resize', resize);
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); for (const m of [].concat(o.material || [])) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); } });
    for (const k of ['closed', 'glow', 'depth']) if (u[k].value) u[k].value.dispose();
    if (scene.environment) scene.environment.dispose(); boxTarget.dispose(); quad.geometry.dispose(); quad.material.dispose(); renderer.dispose(); renderer.forceContextLoss();
  };
  return { st, render, screen, ready, setPointer, dispose, renderer, get box() { return box; } };
}
