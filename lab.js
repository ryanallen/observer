// Ruth's lab, seen from above like the bay: a still photograph of the room with real depth, shifted a little by the
// pointer and racked into focus where it rests, with the one real thing in it, the box, closed on the worktable. Resting
// on the box opens it; the stone inside glows and the room comes up red around it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const PLATE = { w: 1671, h: 941 };
const BOX_AT = { x: 897 / 1671, y: 478 / 941 };   // where the box stands on the table in the plate (its foot)
const BOX_WIDTH = 52 / 1671;                       // its width in the plate, as a share of the plate's width
const SHIFT_BASE = .35, SHIFT_DEPTH = .15;           // how much the room shifts with the pointer: all of it, plus a little by depth
const OPEN_ANGLE = .42;
const LIGHTS = 24;
// P.4, the look back: Ruth's side of the room. Where the stone hangs in that photograph (in the air over the crown), how
// wide it shows there (75 mm), and where her eye is
const REV = { w: 1672, h: 941, stone: { x: 853, y: 290 }, stoneW: 98, eye: { x: 557, y: 152 } };

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
  const fill = new THREE.HemisphereLight(0x8a7458, 0x1a120a, 1.1);
  // the stone's own light on the box from above, warm red-orange, so the bronze stays bronze in the dark room
  const stoneLight = new THREE.DirectionalLight(0xff6a30, 0); stoneLight.position.set(.1, 2, .6);
  scene.add(key, fill, stoneLight);
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

  let box = null, gemMat = null, gemLight = null, glowAt = null, boxLayer = .3;
  const hinges = [];
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const texLoader = new THREE.TextureLoader();
  const tex = u => texLoader.loadAsync(u).then(t => { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; });
  let reverseLoad = null;
  const loadReverse = () => reverseLoad || (reverseLoad = Promise.all([tex('models/web/lab_reverse.webp'), tex('models/web/lab_reverse_depth.jpg')]).then(([r, d]) => {
    r.colorSpace = THREE.SRGBColorSpace; u.reverse.value = r; u.revDepth.value = d;
  }));
  const ready = Promise.all([
    tex('models/web/lab_closed_v.webp'), tex('models/web/lab_dark.webp'), tex('models/web/lab_glowdark.webp'), tex('models/web/lab_depth.jpg'), tex('models/web/lab_shift.jpg'),
    loader.loadAsync('models/web/box_cd.glb'), loader.loadAsync('models/web/stone.glb'),
  ]).then(([closed, dark, glowdark, depth, shift, gb, gs]) => {
    closed.colorSpace = dark.colorSpace = glowdark.colorSpace = THREE.SRGBColorSpace;
    Object.assign(u, { closed: { value: closed }, dark: { value: dark }, glowdark: { value: glowdark }, depth: { value: depth }, shift: { value: shift } });
    // the box moves exactly as the tabletop under it: read the shift map there
    const c = document.createElement('canvas'); c.width = shift.image.width; c.height = shift.image.height;
    const x = c.getContext('2d'); x.drawImage(shift.image, 0, 0);
    shiftPx = { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
    boxLayer = layerAt(BOX_AT.x, BOX_AT.y);
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
    // the box is modelled in millimetres under its root: give the stone (modelled in metres) its real size inside it
    box.updateMatrixWorld(true); { const sw = (seat || box).getWorldScale(new THREE.Vector3()).y, rw = box.getWorldScale(new THREE.Vector3()).y; g.scale.setScalar(rw / sw); }
    stone = g; stoneBase = g.position.y; stoneScale = g.scale.x; g.traverse(o => { if (o.isMesh) stoneMeshes.add(o); });
    gemLight = new THREE.PointLight(0xff6a32, 0, .6, 2); glowAt.add(gemLight);
    scene.add(box); box.updateMatrixWorld(true);
  });

  // the photograph: closed and glowing plates crossfaded, shifted by depth, racked into focus at the pointer
  const u = {
    closed: { value: null }, dark: { value: null }, glowdark: { value: null }, depth: { value: null }, shift: { value: null }, boxTex: { value: boxTarget.texture },
    lampOff: { value: 0 },
    // the swing round the stone into Ruth's side, then the push toward her eye
    reverse: { value: null }, revDepth: { value: null }, swing: { value: 0 }, eyeZoom: { value: 0 },
    stoneA: { value: new THREE.Vector2(.5, .5) }, stoneB: { value: new THREE.Vector2(.5, .5) }, eyeAt: { value: new THREE.Vector2(.5, .5) },
    // the stone's soft red halo, drawn into the room behind the box layer so the stone's dark silhouette stands against it
    stoneAt: { value: new THREE.Vector2(.5, .5) }, halo: { value: new THREE.Vector2(0, .06) },
    open: { value: 0 }, cover: { value: new THREE.Vector2(1, 1) }, sceneCam: { value: new THREE.Vector2() },
    focusUv: { value: new THREE.Vector2(.5, .5) }, resolution: { value: new THREE.Vector2(1, 1) }, fade: { value: 1 },
    boxAt: { value: new THREE.Vector2(BOX_AT.x, 1 - BOX_AT.y) },
    // the machine's light on the room: up to 24 soft pools, each at a place in the photograph (u, v, radius) with a colour
    // and strength, multiplied into the plate
    lightPos: { value: Array.from({ length: LIGHTS }, () => new THREE.Vector3(0, 0, .01)) },
    lightCol: { value: Array.from({ length: LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: u, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform sampler2D closed, dark, glowdark, depth, shift, boxTex, reverse, revDepth; uniform float open, fade, lampOff, swing, eyeZoom; uniform vec2 stoneAt, halo, stoneA, stoneB, eyeAt; uniform vec2 cover, sceneCam, focusUv, resolution, boxAt; uniform vec3 lightPos[${LIGHTS}]; uniform vec4 lightCol[${LIGHTS}]; varying vec2 vUv;
      // the shift: the whole room moves about 2%, near parts a little more; the map is flattened so each thing moves as
      // one with the floor it stands on, and nothing slides over anything
      vec2 plateUv(vec2 s) { vec2 p = (s - .5) * cover + .5; float layer = texture2D(shift, p).r; return p - sceneCam * (${SHIFT_BASE.toFixed(2)} + ${SHIFT_DEPTH.toFixed(2)} * layer); }
      vec3 roomA(vec2 s) {
        vec2 p = plateUv(s);
        // the room by the desk lamp, then dark (moonlight only) once it is switched off, then lit by the stone
        vec3 c = mix(mix(texture2D(closed, p).rgb, texture2D(dark, p).rgb, lampOff), texture2D(glowdark, p).rgb, open);
        vec3 lm = vec3(0.0);
        for (int i = 0; i < ${LIGHTS}; i++) {
          vec2 d = (p - lightPos[i].xy) * vec2(1.776, 1.0) / lightPos[i].z;
          lm += lightCol[i].rgb * lightCol[i].a * exp(-dot(d, d) * 2.2);
        }
        c *= 1.0 + lm;
        return c;
      }
      // Ruth's side: the reverse photograph, shifting as a whole with the pointer
      vec3 roomB(vec2 s) { vec2 p = (s - .5) * cover + .5 - sceneCam * ${SHIFT_BASE.toFixed(2)}; return texture2D(reverse, p).rgb; }
      vec3 scene(vec2 s) {
        vec3 c;
        if (swing <= 0.0) c = roomA(s);
        else {
          // the diorama rushes in toward the stone as the view turns, Ruth's side comes out of it, crossing at the middle
          float ea = smoothstep(0.0, .55, swing), eb = 1.0 - smoothstep(.45, 1.0, swing), wB = smoothstep(.4, .6, swing);
          vec2 sb = stoneB + (s - stoneB) / (1.0 + 3.0 * eb);
          sb = eyeAt + (sb - eyeAt) / (1.0 + 5.0 * eyeZoom * eyeZoom);
          vec3 b = roomB(sb);
          c = wB >= 1.0 ? b : mix(roomA(stoneA + (s - stoneA) / (1.0 + 3.0 * ea)), b, wB);
        }
        vec2 hd = (s - stoneAt) * vec2(resolution.x / resolution.y, 1.0) / halo.y;
        float hr = dot(hd, hd);
        c += halo.x * (1.0 - eyeZoom) * (vec3(1.0, .16, .05) * exp(-hr * 1.6) * .55 + vec3(1.0, .32, .1) * exp(-hr * 9.0) * .35);
        vec4 bx = texture2D(boxTex, s) * (1.0 - smoothstep(0.0, .5, eyeZoom));
        return c * (1.0 - bx.a) + bx.rgb;   // the box's target is premultiplied by its own alpha
      }
      void main() {
        // the turn itself: a fast sideways blur, strongest in the middle of the swing
        if (swing > 0.0 && swing < 1.0) {
          float mb = sin(3.14159 * swing) * .07;
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 14; i++) acc += scene(vUv + vec2(mb * (float(i) / 13.0 - .5), 0.0));
          gl_FragColor = vec4(acc / 14.0 * fade, 1.0);
          #include <colorspace_fragment>
          return;
        }
        vec3 sharp = scene(vUv);
        float here, pointed;
        if (swing >= 1.0) { here = texture2D(revDepth, (vUv - .5) * cover + .5).r; pointed = texture2D(revDepth, (focusUv - .5) * cover + .5).r; }
        else {
          here = texture2D(depth, (vUv - .5) * cover + .5).r; pointed = texture2D(depth, (focusUv - .5) * cover + .5).r;
          // the box stands on the table: wherever it covers the picture, it is in focus with the table, not the wall behind
          here = mix(here, texture2D(depth, (boxAt - .5) * cover + .5).r, texture2D(boxTex, vUv).a);
        }
        float blur = max(smoothstep(.045, .30, abs(here - pointed)) * .9, smoothstep(.08, .36, abs(vUv.y - focusUv.y)) * .8) * (1.0 - eyeZoom);
        vec2 px = vec2(1.0) / resolution * blur * 9.0;
        float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
        vec3 soft = vec3(0.0);
        for (int i = 0; i < 16; i++) {
          float a = float(i) * 2.39996323 + turn, r = sqrt((float(i) + .5) / 16.0);
          soft += scene(vUv + px * r * vec2(cos(a), sin(a)));
        }
        gl_FragColor = vec4(mix(sharp, soft / 16.0, blur) * fade, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), photo = new THREE.Scene(); photo.add(quad);

  // lift: the stone rising out of the open box to hang a hand's width above it; flash: a photon striking it
  const st = { lamp: 0, open: 0, lift: 0, flash: 0, pulse: 0, swing: 0, eyeZoom: 0, fade: 1 };
  let stone = null, stoneBase = 0, stoneScale = 1, shiftPx = null, orbit = null;
  const stoneMeshes = new Set();
  const layerAt = (u, v) => { if (!shiftPx) return boxLayer; const x = Math.round(u * (shiftPx.w - 1)), y = Math.round(v * (shiftPx.h - 1)); return shiftPx.data[(y * shiftPx.w + x) * 4] / 255; };
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
    const fx = heldFocus ? heldFocus.x : pointerActive ? (look.x + 1) * .5 : BOX_AT.x, fy = heldFocus ? heldFocus.y : pointerActive ? (1 - look.y) * .5 : 1 - BOX_AT.y;
    focusAt.x += (fx - focusAt.x) * (1 - Math.exp(-dt * 8)); focusAt.y += (fy - focusAt.y) * (1 - Math.exp(-dt * 8));
    u.focusUv.value.copy(focusAt);
    // the box stands where it stood in the photograph and moves with the table under it
    const shift = SHIFT_BASE + SHIFT_DEPTH * boxLayer;
    const sx = ((BOX_AT.x + u.sceneCam.value.x * shift - .5) / coverX + .5) * W;
    const sy = ((BOX_AT.y - u.sceneCam.value.y * shift - .5) / coverY + .5) * H;
    boxPx = { x: sx, y: sy };
    if (st.swing <= 0 || !stone) { camera.setViewOffset(W, H, W / 2 - sx, H / 2 - sy, W, H); orbit = null; }
    else {
      // the camera swings round the stone, held where it hangs, and closes in on Ruth's side
      const T = stone.getWorldPosition(new THREE.Vector3()); T.y += .05;
      if (!orbit) {
        const q = stoneScreen(), v = camera.position.clone().sub(T), d0 = v.length();
        orbit = { yaw0: Math.atan2(v.x, v.z), pitch0: Math.asin(v.y / d0), d0, ox0: W / 2 - q.x, oy0: H / 2 - q.y };
        u.stoneA.value.set(q.x / W, 1 - q.y / H);
      }
      const qb = revToScreen(REV.stone.x, REV.stone.y), ppm1 = (REV.stoneW / REV.w / coverX * W) / .075;
      const d1 = H / (2 * Math.tan(camera.fov * Math.PI / 360) * ppm1);
      const k = st.swing < .5 ? 2 * st.swing * st.swing : 1 - Math.pow(-2 * st.swing + 2, 2) / 2;
      const yw = orbit.yaw0 + Math.PI * .92 * k, pt = orbit.pitch0 + (.12 - orbit.pitch0) * k, dd = orbit.d0 + (d1 - orbit.d0) * k;
      camera.position.set(T.x + Math.sin(yw) * Math.cos(pt) * dd, T.y + Math.sin(pt) * dd, T.z + Math.cos(yw) * Math.cos(pt) * dd);
      camera.lookAt(T); camera.near = dd * .3; camera.far = dd * 6; camera.updateProjectionMatrix();
      camera.setViewOffset(W, H, orbit.ox0 + (W / 2 - qb.x - orbit.ox0) * k, orbit.oy0 + (H / 2 - qb.y - orbit.oy0) * k, W, H);
      u.stoneB.value.set(qb.x / W, 1 - qb.y / H);
      const e = revToScreen(REV.eye.x, REV.eye.y); u.eyeAt.value.set(e.x / W, 1 - e.y / H);
      // past the middle of the turn the box is Ruth's photograph's own; only the real stone stays
      const showBox = st.swing < .5;
      if (box) box.traverse(o => { if (o.isMesh) o.visible = showBox || stoneMeshes.has(o); });
      shadowFloor.visible = showBox;
    }
    // opening: the panels fold out on their hinges, the stone wakes, the room comes up red
    const o = st.open, glowK = o * (.78 + .32 * st.pulse + .04 * Math.sin(time * 1.3)) + st.flash * .9;
    st.flash *= Math.exp(-dt * 9);
    // the stone lifts up out of its band and supports, rises above the crown of panels and hangs there, slowly turning
    if (stone && stone.parent) {
      const ws = stone.parent.getWorldScale(new THREE.Vector3()).y || 1, k = THREE.MathUtils.smoothstep(st.lift, 0, 1);
      stone.position.y = stoneBase + k * (.45 + .008 * Math.sin(time * 1.1)) / ws;   // about the box's own height above the open panels
      // and a little to the left on screen, into clear air between the lamp and the laser housing; it keeps its measured size
      stone.position.x = k * -.105 / ws; stone.position.z = k * .075 / ws;
      stone.rotation.y += dt * .45 * k;
    }
    // open as in the approved picture: the panels tipped outward into a crown, not folded flat
    for (const h of hinges) h.o.quaternion.copy(h.base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), o * OPEN_ANGLE));
    // the stone's light is kept low enough that every panel's edge and carving still reads in it
    // once it has lifted clear of the panels it glows fully, red-orange; inside the box it stays low so the carving reads
    if (gemMat) gemMat.emissiveIntensity = Math.min(1.2 + 4.5 * st.lift + st.flash * 3, glowK * 6);
    if (gemLight) gemLight.intensity = glowK * (.14 + .26 * st.lift);
    // the room's red swells on each heartbeat and eases back
    st.pulse *= Math.exp(-dt * 2.6);
    u.open.value = THREE.MathUtils.smoothstep(o, 0, 1) * (.8 + .2 * st.pulse); u.fade.value = st.fade; u.lampOff.value = st.lamp;
    u.swing.value = st.swing; u.eyeZoom.value = st.eyeZoom;
    if (stone) { const q = stoneScreen(); u.stoneAt.value.set(q.x / W, 1 - q.y / H); }
    const sizeK = Math.max(1, stonePx() / 22);
    u.halo.value.set(THREE.MathUtils.smoothstep(st.lift, 0, 1) * (.75 + .35 * st.pulse + .6 * st.flash), (.055 + .012 * st.pulse + .015 * st.flash) * sizeK);
    if (gemMat) gemMat.envMapIntensity = 1.6 - 1.3 * THREE.MathUtils.smoothstep(st.swing, .4, 1);
    // the desk lamp on the box goes out with the room's, leaving the moon's faint cool light
    key.intensity = 6 * (1 - st.lamp); key.color.setRGB(1, .77 - .1 * st.lamp, .54 - .05 * st.lamp);
    stoneLight.intensity = (2.2 + 1.6 * st.lift) * THREE.MathUtils.smoothstep(st.open, 0, 1) * (.85 + .3 * st.pulse);
    fill.color.setRGB(.54 + .2 * st.open, .45 - .05 * st.open, .35 - .08 * st.open);
    renderer.setRenderTarget(boxTarget); renderer.setClearColor(0x000000, 0); renderer.clear();
    if (box) renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.render(photo, flat);
  };

  // where the ping sits: on the stone inside the box
  // a point in the photograph (its pixels) to where it shows on screen this frame, moved with the plate's shift there
  const plateToScreen = (px, py) => {
    const u0 = px / PLATE.w, v0 = py / PLATE.h, k = SHIFT_BASE + SHIFT_DEPTH * layerAt(u0, v0);
    return { x: ((u0 + u.sceneCam.value.x * k - .5) / coverX + .5) * W, y: ((v0 - u.sceneCam.value.y * k - .5) / coverY + .5) * H };
  };
  const stoneScreen = () => {
    if (!stone) return screen();
    const p = stone.getWorldPosition(new THREE.Vector3()); p.y += .05 * stone.scale.x / stoneScale; p.project(camera);
    return { x: (p.x * .5 + .5) * W, y: (-p.y * .5 + .5) * H };
  };
  const screen = () => {
    if (!glowAt) return { x: boxPx.x, y: boxPx.y - H * .03 };
    const p = glowAt.getWorldPosition(new THREE.Vector3()).project(camera);
    return { x: (p.x * .5 + .5) * W, y: (-p.y * .5 + .5) * H };
  };
  const setPointer = (x, y) => { pointerActive = true; look.x = x; look.y = y; };
  // a point in Ruth's photograph to the screen (it shifts as a whole)
  const revToScreen = (px, py) => ({ x: ((px / REV.w + u.sceneCam.value.x * SHIFT_BASE - .5) / coverX + .5) * W, y: ((py / REV.h - u.sceneCam.value.y * SHIFT_BASE - .5) / coverY + .5) * H });
  const eyeScreen = () => revToScreen(REV.eye.x, REV.eye.y);
  // how many pixels across the stone shows this frame
  const stonePx = () => {
    if (!stone) return 22;
    const a = stone.getWorldPosition(new THREE.Vector3()), b = a.clone(); a.y += .0; b.y += .1;
    a.project(camera); b.project(camera); return Math.abs(a.y - b.y) * .5 * H * .75;
  };
  // the page hands its lights in photograph pixels: [px, py, radius px, r, g, b, strength]
  const setLights = list => {
    for (let i = 0; i < LIGHTS; i++) {
      const L = list[i];
      if (!L) { u.lightCol.value[i].w = 0; continue; }
      u.lightPos.value[i].set(L[0] / PLATE.w, 1 - L[1] / PLATE.h, L[2] / PLATE.h);
      u.lightCol.value[i].set(L[3], L[4], L[5], L[6]);
    }
  };
  // a point on screen back to the photograph's pixels (the shift taken where it lands)
  const screenToPlate = (x, y) => {
    let u0 = (x / W - .5) * coverX + .5, v0 = (y / H - .5) * coverY + .5;
    const k = SHIFT_BASE + SHIFT_DEPTH * layerAt(Math.min(1, Math.max(0, u0)), Math.min(1, Math.max(0, v0)));
    return { x: (u0 - u.sceneCam.value.x * k) * PLATE.w, y: (v0 + u.sceneCam.value.y * k) * PLATE.h };
  };
  // for tests: hold the focus at one place so frames taken at different pointer positions differ only by the shift
  let heldFocus = null; const holdFocus = (x, y) => { heldFocus = x == null ? null : { x, y }; };

  const dispose = () => {
    removeEventListener('resize', resize);
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); for (const m of [].concat(o.material || [])) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); } });
    for (const k of ['closed', 'dark', 'glowdark', 'depth', 'shift', 'reverse', 'revDepth']) if (u[k].value) u[k].value.dispose();
    if (scene.environment) scene.environment.dispose(); boxTarget.dispose(); quad.geometry.dispose(); quad.material.dispose(); renderer.dispose(); renderer.forceContextLoss();
  };
  return { st, render, screen, stoneScreen, stonePx, plateToScreen, screenToPlate, revToScreen, eyeScreen, loadReverse, setLights, ready, setPointer, holdFocus, dispose, renderer, get box() { return box; } };
}
