// Ruth's lab as a real room: the whole lab in 3D, seen from above like the bay, a tilt-shift diorama. The pointer moves the
// camera a little (real parallax, about 2% of the frame) and racks the focus to what it rests on. The desk lamp, the
// moonlight through the north windows and the stone's red glow are real lights; the box opens on its hinges and the stone
// lifts to hang above it. In P.4 the camera orbits the hanging stone to Ruth's side, and ends on her photograph until her
// own model is in the room.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const OPEN_ANGLE = .42;
// the diorama camera: from the south-west, high and far, looking down at the worktable with the windows up to the left and
// the photon bench behind; a long lens for the miniature look
const VIEW = { dir: new THREE.Vector3(-Math.sin(.66) * Math.cos(.7), Math.sin(.7), Math.cos(.66) * Math.cos(.7)), target: new THREE.Vector3(.05, .76, .7), width: 8.2, fov: 14 };
// walls and ceiling cut away so the room shows from above
const CUT = /^(wall_south|wall_west|ceiling|skirting_(s|w)|picture_rail_(s|w)|conduit_w)/;
// Ruth's side, her photograph: where the stone hangs in it, how wide it shows (75 mm), where her eye is
const REV = { w: 1672, h: 941, stone: { x: 853, y: 290 }, stoneW: 98, eye: { x: 557, y: 152 } };

export function createLab(canvas, opts = {}) {
  // for tuning: ?view=yaw,pitch,width (degrees, degrees, metres)
  if (opts.view) { const [yw, pt, wd] = opts.view.split(',').map(Number); VIEW.dir.set(Math.sin(yw * Math.PI / 180) * Math.cos(pt * Math.PI / 180), Math.sin(pt * Math.PI / 180), Math.cos(yw * Math.PI / 180) * Math.cos(pt * Math.PI / 180)); if (wd) VIEW.width = wd; }
  const mobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.75;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  let W = 1, H = 1;

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x030304);
  const camera = new THREE.PerspectiveCamera(VIEW.fov, 1, 1, 120);

  // the lights, all made now so their number never changes (a change recompiles every shader); each is only dimmed
  const lampSpot = new THREE.SpotLight(0xffb468, 0, 0, 1.15, .85, 1.6);
  lampSpot.castShadow = true; lampSpot.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048); lampSpot.shadow.bias = -.0005; lampSpot.shadow.normalBias = .02;
  lampSpot.shadow.camera.near = .05; lampSpot.shadow.camera.far = 6;
  const lampGlow = new THREE.PointLight(0xffa860, 0, 7, 1.6);          // the shade's own soft spill round the table
  const moon = new THREE.DirectionalLight(0x9eabc4, 0);              // through the north windows
  moon.position.set(-3, 7, -9);
  const fill = new THREE.HemisphereLight(0x34302c, 0x0e0a07, 0);
  const stoneLight = new THREE.PointLight(0xff6a2c, 0, 0, 1.5);
  scene.add(lampSpot, lampSpot.target, lampGlow, moon, moon.target, fill, stoneLight);

  const st = { lamp: 0, open: 0, lift: 0, flash: 0, pulse: 0, swing: 0, eyeZoom: 0, fade: 1 };
  const nodes = {};
  let box = null, stone = null, gemMat = null, glowAt = null, stoneFrom = new THREE.Vector3(), stoneHang = new THREE.Vector3();
  const hinges = [], emissive = { monitor: null, indicators: [] };
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  // the room; the box and the stone are their own models, set on the table at box_spot (the clay room has them built in)
  const ready = Promise.all([loader.loadAsync(opts.room || 'models/web/lab_room.glb'), loader.loadAsync('models/web/box_cd.glb'), loader.loadAsync('models/web/stone.glb')]).then(([gltf, gb, gs]) => {
    const room = gltf.scene;
    if (!room.getObjectByName('box_cd')) {
      const b = gb.scene; b.name = 'box_cd'; const spot = room.getObjectByName('box_spot');
      room.updateMatrixWorld(true); if (spot) spot.getWorldPosition(b.position);
      room.add(b); b.updateMatrixWorld(true);
      const seat = b.getObjectByName('gem_seat') || b, g = gs.scene; seat.add(g);
      // the box is modelled in millimetres under its root: give the stone (modelled in metres) its real size inside it
      g.scale.setScalar(b.getWorldScale(new THREE.Vector3()).y / seat.getWorldScale(new THREE.Vector3()).y);
    }
    room.traverse(o => {
      if (o.name) nodes[o.name] = o;
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      // the desk lamp's own parts throw no shadow from its bulb (the shade would lay a dark band across the table)
      if (o.isMesh) for (let p = o; p; p = p.parent) if (/^lamp_/.test(p.name)) { o.castShadow = false; break; }
    });
    room.traverse(o => { if (o.name && (CUT.test(o.name) || /^ceiling_light/.test(o.name))) o.visible = false; });
    scene.add(room); room.updateMatrixWorld(true);
    // whatever hangs on the walls that are cut away (a whiteboard, a radiator, a coat rail) goes with them, so nothing floats
    const bb = new THREE.Box3(), c = new THREE.Vector3();
    room.traverse(o => { if (!o.isMesh) return; bb.setFromObject(o).getCenter(c); if (c.x < -3.55 || c.z > 2.55 || c.y > 3.3) o.visible = false; });
    box = nodes.box_cd || null;
    for (let i = 1; i <= 7; i++) { const h = nodes['hinge_' + i]; if (h) hinges.push({ o: h, base: h.quaternion.clone() }); }
    // black plastic reads as plastic, not a mirror that throws the moon back as white discs
    room.traverse(o => { if (o.isMesh && o.material.name === 'lab_black_plastic') { o.material.metalness = 0; o.material.roughness = Math.max(o.material.roughness, .75); } });
    room.traverse(o => { if (o.isMesh && o.material.name === 'box_lid_filigree') { o.material.side = THREE.DoubleSide; o.material.alphaTest = o.material.alphaTest || .5; o.material.transparent = false; } });
    // the stone: lifted out of its seat into the room itself, so it can rise to where it hangs above the box
    const seat = nodes.gem_seat; glowAt = nodes.gem_glow || seat;
    let stoneMesh = null; room.traverse(o => { if (!stoneMesh && o.isMesh && /stone/.test(o.material.name)) stoneMesh = o; });
    if (stoneMesh) {
      gemMat = stoneMesh.material;
      // its glow is a deep red-orange from inside; a model without one is given it
      if (gemMat.emissive && gemMat.emissive.getHex() === 0) gemMat.emissive.setHex(0xff3a14);
      let top = stoneMesh; while (top.parent && top.parent !== seat && top.parent !== box && top.parent !== room) top = top.parent;
      stone = new THREE.Group(); scene.add(stone);
      top.getWorldPosition(stoneFrom); stone.position.copy(stoneFrom); stone.attach(top);
    }
    if (nodes.stone_hang) nodes.stone_hang.getWorldPosition(stoneHang); else stoneHang.copy(stoneFrom).add(new THREE.Vector3(0, .3, 0));
    // the lamp: a spot down from the bulb onto the table, and its soft spill
    const bulb = new THREE.Vector3(); (nodes.lamp_bulb || room).getWorldPosition(bulb);
    lampSpot.position.copy(bulb); lampSpot.target.position.copy(bulb).add(new THREE.Vector3(.3, -1, .1)); lampGlow.position.copy(bulb).add(new THREE.Vector3(0, .05, 0));
    // what the page switches on: the monitor's screen and the eight indicator lights, made to glow on their own
    const glowMat = (o, col) => { if (!o) return null; const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: col, emissiveIntensity: 0, roughness: .4 });
      o.traverse(c => { if (c.isMesh) c.material = m; }); return m; };
    emissive.monitor = glowMat(nodes.monitor_screen, 0x7dffb0);
    for (let i = 1; i <= 8; i++) emissive.indicators.push(glowMat(nodes['indicator_' + i], i % 3 === 0 ? 0x66ff88 : 0xff3b22));
    mergeStatic(room);
  });

  // everything in the room that never moves or changes is merged, one draw per material, so the room costs a few draws
  // instead of hundreds; the box, the stone and the parts the page lights stay apart
  // a copy of a geometry with plain float positions, normals and texture coordinates: the room's model stores them as
  // packed integers, which moving them into place would wreck; texture transforms are baked into the coordinates
  const plain = (geo) => {
    const g = new THREE.BufferGeometry(), src = geo.index ? geo.toNonIndexed() : geo;
    for (const n of ['position', 'normal', 'uv']) {
      const at = src.attributes[n]; if (!at) continue;
      const out = new Float32Array(at.count * at.itemSize);
      for (let i = 0; i < at.count; i++) for (let c = 0; c < at.itemSize; c++) out[i * at.itemSize + c] = at.getComponent(i, c);
      g.setAttribute(n, new THREE.BufferAttribute(out, at.itemSize));
    }
    if (src !== geo) src.dispose();
    return g;
  };
  function mergeStatic(room) {
    const keep = new Set();
    for (const k of ['box_cd', 'monitor_screen', ...Array.from({ length: 8 }, (_, i) => 'indicator_' + (i + 1))]) if (nodes[k]) nodes[k].traverse(o => keep.add(o));
    if (stone) stone.traverse(o => keep.add(o));
    const groups = new Map(), drop = [];
    room.updateMatrixWorld(true);
    room.traverse(o => {
      if (!o.isMesh || keep.has(o) || !o.visible || o.isSkinnedMesh) return;
      let hidden = false; for (let p = o; p; p = p.parent) if (!p.visible) hidden = true; if (hidden) return;
      const g = plain(o.geometry).applyMatrix4(o.matrixWorld);
      const key = o.material.uuid + '|' + o.castShadow + '|' + Object.keys(g.attributes).sort().join();
      if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, list: [] });
      groups.get(key).list.push(g); drop.push(o);
    });
    for (const o of drop) { o.parent.remove(o); o.geometry.dispose(); }
    for (const { mat, cast, list } of groups.values()) {
      const merged = mergeGeometries(list, false); list.forEach(g => g.dispose()); if (!merged) continue;
      const m = new THREE.Mesh(merged, mat); m.castShadow = cast; m.receiveShadow = true; m.matrixAutoUpdate = false; scene.add(m);
    }
    // the box: each panel's parts merged under its own hinge, and the body's under the box, so they still move together
    if (!box) return;
    const anchors = new Set([box, ...hinges.map(h => h.o)]), byAnchor = new Map(), boxDrop = [];
    box.updateMatrixWorld(true);
    box.traverse(o => {
      if (!o.isMesh || (stone && stone.getObjectById(o.id))) return;
      let a = o.parent; while (a && !anchors.has(a)) a = a.parent; if (!a) return;
      const inv = a.matrixWorld.clone().invert(), g = plain(o.geometry).applyMatrix4(inv.multiply(o.matrixWorld));
      const key = a.uuid + '|' + o.material.uuid + '|' + Object.keys(g.attributes).sort().join();
      if (!byAnchor.has(key)) byAnchor.set(key, { a, mat: o.material, list: [] });
      byAnchor.get(key).list.push(g); boxDrop.push(o);
    });
    for (const o of boxDrop) { o.parent.remove(o); o.geometry.dispose(); }
    for (const { a, mat, list } of byAnchor.values()) {
      const merged = mergeGeometries(list, false); list.forEach(g => g.dispose()); if (!merged) continue;
      const m = new THREE.Mesh(merged, mat); m.castShadow = m.receiveShadow = true; a.add(m);
    }
  }

  // ---- the picture: the room, then the focus (sharp where the pointer rests, soft away from it), the glow, then out ----
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 0 : 4 });
  rt.depthTexture = new THREE.DepthTexture(1, 1); rt.depthTexture.type = THREE.UnsignedIntType;
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const focus = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, focusUv: { value: new THREE.Vector2(.5, .5) }, resolution: { value: new THREE.Vector2(1, 1) },
      near: { value: 1 }, far: { value: 100 }, amount: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `#include <packing>
      uniform sampler2D tDiffuse, tDepth; uniform vec2 focusUv, resolution; uniform float near, far, amount; varying vec2 vUv;
      float viewZ(vec2 p) { return -perspectiveDepthToViewZ(texture2D(tDepth, p).x, near, far); }
      void main() {
        float here = viewZ(vUv), pointed = viewZ(focusUv);
        // how far in front of or behind the point in focus, as a share of the distance, plus the miniature's band
        float blur = max(smoothstep(.012, .07, abs(here - pointed) / pointed) * .9, smoothstep(.10, .40, abs(vUv.y - focusUv.y)) * .8) * amount;
        vec2 px = vec2(1.0) / resolution * blur * 9.0;
        float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
        vec3 soft = vec3(0.0);
        for (int i = 0; i < 16; i++) { float a = float(i) * 2.39996323 + turn, r = sqrt((float(i) + .5) / 16.0); soft += texture2D(tDiffuse, vUv + px * r * vec2(cos(a), sin(a))).rgb; }
        gl_FragColor = vec4(mix(texture2D(tDiffuse, vUv).rgb, soft / 16.0, blur), 1.0);
      }`,
  });
  composer.addPass(focus);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .45, .5, .92); composer.addPass(bloom);
  // Ruth's photograph, until her model is in the room: laid over the end of the orbit, the stone on the stone, then pushed
  // in toward her eye
  const plate = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, reverse: { value: null }, mixB: { value: 0 }, cover: { value: new THREE.Vector2(1, 1) }, eyeAt: { value: new THREE.Vector2(.5, .5) },
      eyeZoom: { value: 0 }, shift: { value: new THREE.Vector2() } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse, reverse; uniform float mixB, eyeZoom; uniform vec2 cover, eyeAt, shift; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        if (mixB > 0.0) { vec2 s = eyeAt + (vUv - eyeAt) / (1.0 + 5.0 * eyeZoom * eyeZoom); vec2 p = (s - .5) * cover + .5 - shift;
          c = mix(c, texture2D(reverse, p).rgb, mixB); }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  composer.addPass(plate);
  composer.addPass(new OutputPass());

  let reverseLoad = null;
  const loadReverse = () => reverseLoad || (reverseLoad = new THREE.TextureLoader().loadAsync('models/web/lab_reverse.webp').then(t => {
    t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; plate.uniforms.reverse.value = t;
  }));

  let frameW = VIEW.width, dist = 30, coverX = 1, coverY = 1;
  const resize = () => {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    renderer.setSize(W, H, false); composer.setSize(W, H);
    const pr = renderer.getPixelRatio(); focus.uniforms.resolution.value.set(W, H); bloom.resolution.set(W * pr / 2, H * pr / 2);
    camera.aspect = W / H;
    // the same width of room on any screen; a tall screen sees more floor
    camera.fov = 2 * Math.atan(Math.tan(VIEW.fov * Math.PI / 360) * Math.max(1, 1.4 / camera.aspect)) * 180 / Math.PI;
    frameW = VIEW.width; dist = frameW / 2 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
    const a = W / H, pa = REV.w / REV.h; coverX = a > pa ? 1 : a / pa; coverY = a > pa ? pa / a : 1; plate.uniforms.cover.value.set(coverX, coverY);
  };
  resize(); addEventListener('resize', resize);

  const look = { x: 0, y: 0 }, view = { x: 0, y: 0 }, focusAt = new THREE.Vector2(.5, .5);
  let time = 0, pointerActive = false, heldFocus = null, orbit = null;
  const v3 = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const toScreen = p => { v3.copy(p).project(camera); return { x: (v3.x * .5 + .5) * W, y: (-v3.y * .5 + .5) * H }; };

  const render = dt => {
    time += dt;
    // the pointer shifts the view a little, as on the moor: the camera itself moves, so near things move more than far
    const idleX = Math.sin(time * .17) * .55, idleY = Math.sin(time * .11 + 1.3) * .35, ease = 1 - Math.exp(-dt * 4);
    view.x += ((pointerActive ? look.x : idleX) - view.x) * ease; view.y += ((pointerActive ? look.y : idleY) - view.y) * ease;
    const base = VIEW.target.clone().addScaledVector(VIEW.dir, dist);
    right.crossVectors(VIEW.dir, THREE.Object3D.DEFAULT_UP).normalize().negate(); up.crossVectors(right, VIEW.dir.clone().negate()).normalize();
    const sx = -view.x * .011 * frameW, sy = view.y * .007 * frameW;
    if (st.swing <= 0 || !stone) {
      camera.position.copy(base).addScaledVector(right, sx).addScaledVector(up, sy);
      camera.up.set(0, 1, 0); camera.lookAt(VIEW.target.clone().addScaledVector(right, sx * .35).addScaledVector(up, sy * .35));
      camera.near = dist * .6; camera.far = dist * 1.6; camera.clearViewOffset(); orbit = null; if (box) box.visible = true;
    } else {
      // P.4: a true orbit round the hanging stone to Ruth's side, closing in until the stone is as big as in her photograph
      const T = stone.position;
      if (!orbit) { const v = camera.position.clone().sub(T), d0 = v.length(); orbit = { yaw0: Math.atan2(v.x, v.z), pitch0: Math.asin(v.y / d0), d0, q0: toScreen(T) }; }
      const k = st.swing < .5 ? 2 * st.swing * st.swing : 1 - Math.pow(-2 * st.swing + 2, 2) / 2;
      const ppm1 = (REV.stoneW / REV.w / coverX * W) / .075, d1 = H / (2 * Math.tan(camera.fov * Math.PI / 360) * ppm1);
      const yw = orbit.yaw0 + Math.PI * .92 * k, pt = orbit.pitch0 + (.12 - orbit.pitch0) * k, dd = orbit.d0 + (d1 - orbit.d0) * k;
      camera.position.set(T.x + Math.sin(yw) * Math.cos(pt) * dd, T.y + Math.sin(pt) * dd, T.z + Math.cos(yw) * Math.cos(pt) * dd);
      camera.up.set(0, 1, 0); camera.lookAt(T); camera.near = Math.max(.02, dd * .2); camera.far = dd + 12;
      // the stone moves on screen from where it hung in the diorama to where it hangs in her photograph
      const qb = revToScreen(REV.stone.x, REV.stone.y);
      // as her photograph comes in, it holds its own box: only the real stone stays
      if (box) box.visible = st.swing < .7;
      camera.setViewOffset(W, H, (W / 2 - orbit.q0.x) * (1 - k) + (W / 2 - qb.x) * k, (H / 2 - orbit.q0.y) * (1 - k) + (H / 2 - qb.y) * k, W, H);
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    focus.uniforms.near.value = camera.near; focus.uniforms.far.value = camera.far;
    // the focus racks to where the pointer rests, or to the box when it is left alone
    const boxQ = stone ? toScreen(stone.position) : { x: W / 2, y: H / 2 };
    const fx = heldFocus ? heldFocus.x : pointerActive ? (look.x + 1) * .5 : boxQ.x / W, fy = heldFocus ? heldFocus.y : pointerActive ? (1 - look.y) * .5 : 1 - boxQ.y / H;
    focusAt.x += (fx - focusAt.x) * (1 - Math.exp(-dt * 8)); focusAt.y += (fy - focusAt.y) * (1 - Math.exp(-dt * 8));
    focus.uniforms.focusUv.value.copy(focusAt); focus.uniforms.amount.value = 1 - THREE.MathUtils.smoothstep(st.swing, 0, .3);

    // the box opens; the stone wakes, lifts to hang above it and turns; the room comes up red
    const o = st.open, glowK = o * (.78 + .32 * st.pulse + .04 * Math.sin(time * 1.3)) + st.flash * .9;
    st.flash *= Math.exp(-dt * 9); st.pulse *= Math.exp(-dt * 2.6);
    for (const h of hinges) h.o.quaternion.copy(h.base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), o * OPEN_ANGLE));
    if (stone) {
      const k = THREE.MathUtils.smoothstep(st.lift, 0, 1);
      stone.position.lerpVectors(stoneFrom, stoneHang, k); stone.position.y += k * .008 * Math.sin(time * 1.1);
      stone.rotation.y += dt * .45 * k;
      stoneLight.position.copy(stone.position);
    }
    if (gemMat) gemMat.emissiveIntensity = Math.min(1.2 + 4.5 * st.lift + st.flash * 3, glowK * 6);
    stoneLight.intensity = glowK * (2.5 + 8 * st.lift) * (.85 + .3 * st.pulse);
    // the desk lamp, until it is switched off; then only the moon
    lampSpot.intensity = 7 * (1 - st.lamp); lampGlow.intensity = 1.2 * (1 - st.lamp);
    moon.intensity = .8 + .3 * st.lamp; fill.intensity = 1.4 * (1 - .35 * st.lamp);
    // Ruth's photograph over the end of the orbit
    plate.uniforms.mixB.value = plate.uniforms.reverse.value ? THREE.MathUtils.smoothstep(st.swing, .72, 1) : 0;
    plate.uniforms.eyeZoom.value = st.eyeZoom;
    const e = revToScreen(REV.eye.x, REV.eye.y); plate.uniforms.eyeAt.value.set(e.x / W, 1 - e.y / H);
    canvas.style.opacity = st.fade;
    focus.uniforms.tDepth.value = composer.readBuffer.depthTexture;
    composer.render(dt);
  };

  // the page's helpers, as the plate lab has them
  const stoneScreen = () => stone ? toScreen(v3.copy(stone.position)) : { x: W / 2, y: H / 2 };
  const screen = () => glowAt ? toScreen(glowAt.getWorldPosition(new THREE.Vector3())) : stoneScreen();
  const nodeScreen = name => nodes[name] ? toScreen(nodes[name].getWorldPosition(new THREE.Vector3())) : null;
  const stonePx = () => { if (!stone) return 22; const a = toScreen(stone.position), b = toScreen(stone.position.clone().add(new THREE.Vector3(0, .1, 0))); return Math.abs(a.y - b.y) * .75; };
  const revToScreen = (px, py) => ({ x: ((px / REV.w - .5) / coverX + .5) * W, y: ((py / REV.h - .5) / coverY + .5) * H });
  const eyeScreen = () => revToScreen(REV.eye.x, REV.eye.y);
  const setPointer = (x, y) => { pointerActive = true; look.x = x; look.y = y; };
  const holdFocus = (x, y) => { heldFocus = x == null ? null : { x, y }; };
  // the machine: the page sets how bright the monitor and each indicator are, 0 to 1
  const setMachine = (monitor, indicators = []) => {
    if (emissive.monitor) emissive.monitor.emissiveIntensity = monitor * 2.2;
    emissive.indicators.forEach((m, i) => { if (m) m.emissiveIntensity = (indicators[i] || 0) * 6; });
  };
  const setLights = () => {};
  const dispose = () => {
    removeEventListener('resize', resize);
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); for (const m of [].concat(o.material || [])) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); } });
    if (plate.uniforms.reverse.value) plate.uniforms.reverse.value.dispose();
    rt.dispose(); composer.dispose(); renderer.dispose(); renderer.forceContextLoss();
  };
  return { st, render, ready, screen, stoneScreen, stonePx, nodeScreen, revToScreen, eyeScreen, loadReverse, setPointer, holdFocus, setMachine, setLights, dispose, renderer,
    is3d: true, get box() { return box; }, camera, scene };
}
