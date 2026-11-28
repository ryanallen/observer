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

const OPEN_ANGLE = .72;   // the panels tipped out into a crown, as wide as in the approved open-box picture
// the diorama camera: from the south-west, high and far, looking down at the worktable with the windows up to the left and
// the photon bench behind; a long lens for the miniature look
const VIEW = { dir: new THREE.Vector3(-Math.sin(.66) * Math.cos(.7), Math.sin(.7), Math.cos(.66) * Math.cos(.7)), target: new THREE.Vector3(.05, .76, .7), width: 8.2, fov: 14 };
// Ruth's side, her photograph: where the stone hangs in it, how wide it shows (75 mm), where her eye is
const REV = { w: 1672, h: 941, stone: { x: 853, y: 290 }, stoneW: 98, eye: { x: 557, y: 152 } };

export function createLab(canvas, opts = {}) {
  // for tuning: ?view=yaw,pitch,width[,x,y,z] (degrees, degrees, metres, and the point looked at)
  if (opts.view) { const [yw, pt, wd] = opts.view.split(',').map(Number); VIEW.dir.set(Math.sin(yw * Math.PI / 180) * Math.cos(pt * Math.PI / 180), Math.sin(pt * Math.PI / 180), Math.cos(yw * Math.PI / 180) * Math.cos(pt * Math.PI / 180)); if (wd) VIEW.width = wd; const t = opts.view.split(',').map(Number); if (t.length >= 6) VIEW.target.set(t[3], t[4], t[5]); }
  const mobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  // the diorama's cut: everything west of x -3.55 m, south of z 2.55 m and above 3.3 m is not drawn (the near walls, what
  // hangs on them, and the ceiling); off while the camera orbits inside the room
  const cut = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 3.55), new THREE.Plane(new THREE.Vector3(0, 0, -1), 2.55), new THREE.Plane(new THREE.Vector3(0, -1, 0), 3.3)];
  renderer.clippingPlanes = cut;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  let W = 1, H = 1;

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x030304);
  const camera = new THREE.PerspectiveCamera(VIEW.fov, 1, 1, 120);

  // the lights, all made now so their number never changes (a change recompiles every shader); each is only dimmed
  const lampSpot = new THREE.SpotLight(0xffb468, 0, 0, .8, .6, 2);
  lampSpot.castShadow = true; lampSpot.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048); lampSpot.shadow.bias = -.0005; lampSpot.shadow.normalBias = .02;
  lampSpot.shadow.camera.near = .05; lampSpot.shadow.camera.far = 6;
  const lampGlow = new THREE.PointLight(0xffa860, 0, 7, 1.6);          // the shade's own soft spill round the table
  // the moon, low through the north windows: cool, and shadowed by the walls, so it lays the windows' shafts on the floor
  const moon = new THREE.DirectionalLight(0x8ea4d6, 0);
  moon.position.set(-2.5, 5.5, -9); moon.target.position.set(0, 0, 1);
  moon.castShadow = true; moon.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048); moon.shadow.bias = -.0006; moon.shadow.normalBias = .03;
  Object.assign(moon.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 25 });
  const fill = new THREE.HemisphereLight(0x34302c, 0x0e0a07, 0);
  const stoneLight = new THREE.PointLight(0xff5a26, 0, 3.6, 2);   // reaches the table, the bench and the floor round them, not the far walls
  scene.add(lampSpot, lampSpot.target, lampGlow, moon, moon.target, fill, stoneLight);
  // the stone keeps its measured size; it reads by a soft red halo in the air behind it, its dark facets against the glow
  const haloTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,120,60,1)'); g.addColorStop(.25, 'rgba(255,60,20,.55)'); g.addColorStop(1, 'rgba(160,20,5,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  halo.renderOrder = -1; scene.add(halo);
  // the laser's beam from its aperture to the stone, with photons on it, in the room itself (for stills of the firing;
  // the page draws its own photons over the live view)
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff3018, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, 1, 6, 1, true), beamMat); scene.add(beam);
  const photonSprites = Array.from({ length: 3 }, () => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xffe0c0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })); scene.add(sp); return sp; });

  const st = { lamp: 0, open: 0, lift: 0, flash: 0, pulse: 0, swing: 0, eyeZoom: 0, fade: 1, beam: 0, wide: 0 };
  const nodes = {};
  let bulbMat = null, box = null, stone = null, gemMat = null, glowAt = null, stoneFrom = new THREE.Vector3(), stoneHang = new THREE.Vector3();
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
      if (o.isMesh && /^(lab_lamp|lamp_bulb_glass)/.test(o.material.name)) o.castShadow = false;
    });
    // the ceiling, the south and west walls and whatever hangs on them are cut away by position (clipping planes set on
    // the renderer), so nothing depends on the model's part names
    scene.add(room); room.updateMatrixWorld(true);
    box = nodes.box_cd || null;
    for (let i = 1; i <= 7; i++) { const h = nodes['hinge_' + i]; if (h) hinges.push({ o: h, base: h.quaternion.clone() }); }
    // the bulb's glass glows only while the lamp is on; off, it is a dark bulb that throws nothing back
    room.traverse(o => { if (o.isMesh && o.material.name === 'lamp_bulb_glass' && !bulbMat) { bulbMat = o.material; bulbMat.color.setRGB(.08, .07, .06); bulbMat.roughness = .35; bulbMat.metalness = 0;
      if ('transmission' in bulbMat) bulbMat.transmission = 0; bulbMat.emissive.setHex(0xffd49a); bulbMat.emissiveMap = null; } });
    // black plastic reads as plastic, not a mirror that throws the moon back as white discs
    // the night outside: shows only through the windows (clipped to the windows' extent, so it never shows over the cut
    // walls), unlit, and the moonlight comes from the side its moon is on
    {
      const glassBox = new THREE.Box3(), outBox = new THREE.Box3(); let outMat = null;
      room.traverse(o => { if (!o.isMesh) return; if (/window_glass/.test(o.material.name)) glassBox.expandByObject(o); if (/window_outside/.test(o.material.name)) { outBox.expandByObject(o); outMat = outMat || o.material; } });
      if (outMat && !glassBox.isEmpty()) {
        renderer.localClippingEnabled = true;
        const basic = new THREE.MeshBasicMaterial({ map: outMat.emissiveMap, side: THREE.DoubleSide, name: 'window_outside',
          clippingPlanes: [new THREE.Plane(new THREE.Vector3(1, 0, 0), -(glassBox.min.x - .05)), new THREE.Plane(new THREE.Vector3(-1, 0, 0), glassBox.max.x + .05),
            new THREE.Plane(new THREE.Vector3(0, 1, 0), -(glassBox.min.y - .05)), new THREE.Plane(new THREE.Vector3(0, -1, 0), glassBox.max.y + .05)] });
        room.traverse(o => { if (o.isMesh && o.material === outMat) { o.material = basic; o.castShadow = o.receiveShadow = false; } });
        // where the moon is in the picture outside, across its width and height
        const img = outMat.emissiveMap && outMat.emissiveMap.image;
        if (img && img.width) {
          const c = document.createElement('canvas'), w = 64, h = Math.max(8, Math.round(64 * img.height / img.width)); c.width = w; c.height = h;
          const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data; let best = -1, bu = .5, bv = .3;
          for (let i = 0; i < w * h; i++) { const l = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]; if (l > best) { best = l; bu = (i % w) / w; bv = Math.floor(i / w) / h; } }
          const mx = outBox.min.x + (outBox.max.x - outBox.min.x) * bu, my = outBox.max.y - (outBox.max.y - outBox.min.y) * bv, mz = (outBox.min.z + outBox.max.z) / 2;
          moon.position.set(mx, my, mz).sub(new THREE.Vector3(0, 0, 0)).multiplyScalar(1).add(new THREE.Vector3(0, 0, 0));
          moon.position.set(mx * 1.6, Math.max(my, 2.5) + 2.5, mz * 2.2); moon.target.position.set(mx * .2, 0, 1);
        }
      }
    }
    // the window glass lets the moonlight through
    room.traverse(o => { if (o.isMesh && /window_glass|window_night/.test(o.material.name)) o.castShadow = false; });
    // what shiny things reflect: a dark room with the lamp's warm glow and the cool windows
    scene.environment = envMap(); room.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) o.material.envMapIntensity = .5; });
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
    if (nodes.stone_hang) nodes.stone_hang.getWorldPosition(stoneHang); else stoneHang.copy(stoneFrom);
    // it rises clear of the open crown and hangs well above it, where it can be seen
    stoneHang.y = Math.max(stoneHang.y, stoneFrom.y + .42);
    // the lamp: a spot down from the bulb onto the table, and its soft spill
    const bulb = new THREE.Vector3(); (nodes.lamp_bulb || room).getWorldPosition(bulb);
    lampSpot.position.copy(bulb); lampSpot.target.position.copy(bulb).add(new THREE.Vector3(.3, -1, .1)); lampGlow.position.copy(bulb).add(new THREE.Vector3(0, .05, 0));
    // what the page switches on: the monitor's screen and the eight indicator lights, made to glow on their own
    const glowMat = (o, col) => { if (!o) return null; const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: col, emissiveIntensity: 0, roughness: .4 });
      o.traverse(c => { if (c.isMesh) c.material = m; }); return m; };
    emissive.monitor = glowMat(nodes.monitor_screen, 0xffffff);
    // the monitor's screen: dim green-grey with a few bright dots, as in the approved picture
    if (emissive.monitor) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 96; const x = c.getContext('2d');
      x.fillStyle = '#0d2219'; x.fillRect(0, 0, 128, 96); x.fillStyle = '#bfffe0';
      for (const [a, b] of [[.22, .3], [.61, .48], [.4, .7], [.78, .25], [.3, .55], [.52, .2]]) { x.beginPath(); x.arc(a * 128, b * 96, 2.2, 0, 7); x.fill(); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; emissive.monitor.emissiveMap = t; emissive.monitor.needsUpdate = true;
    }
    for (let i = 1; i <= 8; i++) emissive.indicators.push(glowMat(nodes['indicator_' + i], i % 3 === 0 ? 0x66ff88 : 0xff3b22));
    mergeStatic(room);
  });

  function envMap() {
    const es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(5, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide,
      vertexShader: `varying vec3 d; void main() { d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 d; void main() {
        float lamp = pow(max(dot(d, normalize(vec3(-.3, .5, .1))), 0.0), 24.0);
        float win = smoothstep(.0, .3, d.y) * smoothstep(-.4, -.9, d.z) * (1.0 - smoothstep(.75, .95, d.y));
        gl_FragColor = vec4(vec3(.012, .01, .009) + vec3(5.0, 3.0, 1.4) * lamp + vec3(.10, .14, .24) * win, 1.0); }` })));
    const pm = new THREE.PMREMGenerator(renderer), t = pm.fromScene(es, .02).texture; pm.dispose();
    es.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    return t;
  }

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
    if (!box || opts.noBoxMerge) return;
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
  // the room's depth, copied as it is drawn, for the projection pass at the very end (a later pass clears the depth buffer)
  const depthCopyRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const depthCopy = new ShaderPass({ uniforms: { tDepth: { value: null } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDepth; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tDepth, vUv).x, 0.0, 0.0, 1.0); }` });
  depthCopy.needsSwap = false; depthCopy.render = function (r) { r.setRenderTarget(depthCopyRT); this.fsQuad.render(r); };
  depthCopy.enabled = false; composer.addPass(depthCopy);
  // the projection test: two paintings, each made over a frame of this room from a known camera, laid back onto the room
  // from that camera (depth-tested, so a painting lands only on what its camera saw); blended by where the camera is
  const proj = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() },
      pA: { value: null }, dA: { value: null }, vpA: { value: new THREE.Matrix4() }, vA: { value: new THREE.Matrix4() }, rA: { value: new THREE.Vector2(1, 30) }, wA: { value: 0 },
      pB: { value: null }, dB: { value: null }, vpB: { value: new THREE.Matrix4() }, vB: { value: new THREE.Matrix4() }, rB: { value: new THREE.Vector2(1, 30) }, wB: { value: 0 },
      focusUv: { value: new THREE.Vector2(.5, .5) }, near: { value: 1 }, far: { value: 100 }, amount: { value: 1 }, resolution: { value: new THREE.Vector2(1, 1) } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `#include <packing>
      uniform sampler2D tDiffuse, tDepth, pA, dA, pB, dB; uniform mat4 invProj, camWorld, vpA, vA, vpB, vB; uniform vec2 rA, rB, focusUv, resolution; uniform float wA, wB, near, far, amount; varying vec2 vUv;
      float blurAt;   // the miniature's softness here, in pixels on screen, used when sampling the painting
      // how much of a painting lands here: inside its frame, and the surface is the one its camera saw
      vec4 lay(vec3 w, sampler2D p, sampler2D d, mat4 vp, mat4 v, vec2 r) {
        vec4 c = vp * vec4(w, 1.0); if (c.w <= 0.0) return vec4(0.0);
        vec2 uv = c.xy / c.w * .5 + .5; if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
        float z = -(v * vec4(w, 1.0)).z, seen = r.x + (1.0 - texture2D(d, uv).r) * (r.y - r.x);
        float ok = 1.0 - smoothstep(.015, .04, abs(z - seen) / z);
        vec2 e = min(uv, 1.0 - uv); ok *= smoothstep(0.0, .03, min(e.x, e.y));
        // the painting softened like the rest of the frame: sharp where the pointer rests, soft away from it
        vec2 px = vec2(1.0) / resolution * blurAt; vec3 col = vec3(0.0);
        for (int i = 0; i < 12; i++) { float a = float(i) * 2.39996323, rr = sqrt((float(i) + .5) / 12.0); col += texture2D(p, uv + px * rr * vec2(cos(a), sin(a))).rgb; }
        return vec4(col / 12.0, ok);
      }
      void main() {
        vec3 base = texture2D(tDiffuse, vUv).rgb; float dz = texture2D(tDepth, vUv).x;
        if (dz >= 1.0) { gl_FragColor = vec4(base, 1.0); return; }
        float here = -perspectiveDepthToViewZ(dz, near, far), pointed = -perspectiveDepthToViewZ(texture2D(tDepth, focusUv).x, near, far);
        blurAt = max(smoothstep(.012, .07, abs(here - pointed) / pointed) * .9, smoothstep(.07, .34, abs(vUv.y - focusUv.y))) * amount * 12.0;
        vec4 vpos = invProj * vec4(vUv * 2.0 - 1.0, dz * 2.0 - 1.0, 1.0); vpos /= vpos.w; vec3 w = (camWorld * vpos).xyz;
        vec4 a = wA > 0.0 ? lay(w, pA, dA, vpA, vA, rA) : vec4(0.0), b = wB > 0.0 ? lay(w, pB, dB, vpB, vB, rB) : vec4(0.0);
        float ka = a.a * wA, kb = b.a * wB, k = max(ka, kb);
        vec3 paint = (a.rgb * ka + b.rgb * kb) / max(ka + kb, 1e-4);
        // this runs after the frame's tone mapping, so the paintings keep their own colours exactly
        gl_FragColor = vec4(mix(base, paint, k), 1.0);
      }`,
  });
  proj.enabled = false;
  // the paintings and the depth each camera saw, made once when they are loaded
  // the key frames: a painting of the room from a known camera for each beat it rests on (lab: the lamp on; open: the box
  // open; c: the firing, seen from far out; b: the end of the swing). Each is laid back on the room from its own camera;
  // the two that weigh most this frame fill the pass's two slots
  const keys = {};
  const keyCamera = cj => { const c = new THREE.PerspectiveCamera(); c.matrixAutoUpdate = false; c.matrixWorldAutoUpdate = false; c.matrixWorld.fromArray(cj.matrixWorld);
    c.matrixWorldInverse.copy(c.matrixWorld).invert(); c.projectionMatrix.fromArray(cj.projectionMatrix); c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    c.position.fromArray(cj.position); c.quaternion.fromArray(cj.quaternion); c.fov = cj.fov; return c; };
  const loadProjection = async (base = 'models/web/proj/', names = ['a', 'open', 'c', 'b']) => {
    const tl = new THREE.TextureLoader(), get = u => fetch(u).then(r => r.ok ? r.json() : null).then(j => typeof j === 'string' ? JSON.parse(j) : j).catch(() => null);
    await ready;
    await Promise.all(names.map(async k => {
      const cj = await get(base + k + '_camera.json'); if (!cj) return;
      const key = keys[k] = { cam: keyCamera(cj), cj, tex: null, depth: null, range: cj.depthRange || [cj.near, cj.far] };
      key.tex = await tl.loadAsync(base + k + '_paint.webp').catch(() => null); if (!key.tex) return;
      key.tex.minFilter = THREE.LinearFilter; key.tex.generateMipmaps = false;
      const rtD = new THREE.WebGLRenderTarget(cj.width, cj.height);
      depthMat.uniforms.zNear.value = key.range[0]; depthMat.uniforms.zFar.value = key.range[1];
      const old = scene.overrideMaterial, bg = scene.background, tm = renderer.toneMapping, sv = stone && stone.visible;
      scene.overrideMaterial = depthMat; scene.background = new THREE.Color(0); renderer.toneMapping = THREE.NoToneMapping; halo.visible = false; beam.visible = false; if (stone) stone.visible = false;
      renderer.setRenderTarget(rtD); renderer.clear(); renderer.render(scene, key.cam); renderer.setRenderTarget(null);
      scene.overrideMaterial = old; scene.background = bg; renderer.toneMapping = tm; halo.visible = true; beam.visible = true; if (stone) stone.visible = sv;
      key.depth = rtD; key.vp = new THREE.Matrix4().multiplyMatrices(key.cam.projectionMatrix, key.cam.matrixWorldInverse);
    }));
    proj.enabled = depthCopy.enabled = Object.values(keys).some(k => k.tex);
  };
  const setSlot = (slot, key, w) => { const u = proj.uniforms; u['w' + slot].value = key ? w : 0; if (!key) return;
    u['p' + slot].value = key.tex; u['d' + slot].value = key.depth.texture; u['vp' + slot].value.copy(key.vp); u['v' + slot].value.copy(key.cam.matrixWorldInverse); u['r' + slot].value.set(key.range[0], key.range[1]); };
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
        float blur = max(smoothstep(.012, .07, abs(here - pointed) / pointed) * .9, smoothstep(.07, .34, abs(vUv.y - focusUv.y))) * amount;
        vec2 px = vec2(1.0) / resolution * blur * 12.0;
        float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
        vec3 soft = vec3(0.0);
        for (int i = 0; i < 16; i++) { float a = float(i) * 2.39996323 + turn, r = sqrt((float(i) + .5) / 16.0); soft += texture2D(tDiffuse, vUv + px * r * vec2(cos(a), sin(a))).rgb; }
        gl_FragColor = vec4(mix(texture2D(tDiffuse, vUv).rgb, soft / 16.0, blur), 1.0);
      }`,
  });
  composer.addPass(focus);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .35, .4, 1.0); composer.addPass(bloom);
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
  // over her photograph, the real stone and its halo still hang where her photograph has them
  const fg = new THREE.Scene(), fgPass = new RenderPass(fg, camera); fgPass.clear = false; fgPass.clearDepth = true; composer.addPass(fgPass);
  composer.addPass(new OutputPass());
  composer.addPass(proj);
  // the turn itself: a fast sideways blur, strongest in the middle of the swing, as the plate lab has it
  const turnBlur = new ShaderPass({ uniforms: { tDiffuse: { value: null }, amt: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float amt; varying vec2 vUv; void main() {
      vec3 acc = vec3(0.0); for (int i = 0; i < 14; i++) acc += texture2D(tDiffuse, vUv + vec2(amt * (float(i) / 13.0 - .5), 0.0)).rgb;
      gl_FragColor = vec4(acc / 14.0, 1.0); }` });
  turnBlur.enabled = false; composer.addPass(turnBlur);

  // Ruth: her own model, loaded just before the swing, standing at the worktable across from where the orbit ends, leaning
  // on it in her 'lean' pose. Until that pose is in her model, the orbit ends on her photograph instead
  const ruthRim = { value: 0 };
  let reverseLoad = null, ruth = null, ruthHead = null, ruthMixer = null;
  const loadPlate = () => new THREE.TextureLoader().loadAsync('models/web/lab_reverse.webp').then(t => {
    t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; plate.uniforms.reverse.value = t;
  });
  const loadReverse = () => reverseLoad || (reverseLoad = loader.loadAsync('models/web/ruth.glb').then(g => {
    const lean = g.animations.find(a => /lean/i.test(a.name));
    if (!opts.ruth3d) return loadPlate();   // her model stands in only when asked for (&ruth=3d), until she passes
    ruth = g.scene; ruth.visible = false;
    // a cool rim round her edges, as from a window behind her: only on her, so nothing else in the room is lit by it
    ruth.traverse(o => { if (!o.isMesh) return; o.material.onBeforeCompile = sh => { sh.uniforms.ruthRim = ruthRim;
      sh.fragmentShader = `uniform float ruthRim;
` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
 float fres = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0); totalEmissiveRadiance += vec3(.25, .4, .9) * fres * ruthRim * .3;`); };
      o.material.needsUpdate = true; });
    ruth.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } if (!ruthHead && /head|spine\.?006/i.test(o.name)) ruthHead = o; });
    // her real height, 1.70 m, whatever units the model is in
    const bb = new THREE.Box3().setFromObject(ruth), h = bb.max.y - bb.min.y || 1; ruth.scale.multiplyScalar(1.7 / h);
    if (lean) { ruthMixer = new THREE.AnimationMixer(ruth); const a = ruthMixer.clipAction(lean); a.play(); a.paused = true; a.time = lean.duration; ruthMixer.update(0); }
    scene.add(ruth);
  }).catch(() => loadPlate()));
  // where she stands: her model is made for its place in this room, root on the floor at (0, 0.09) unturned; its lean
  // puts her hands on the worktable and turns her to the stone
  const placeRuth = () => {
    if (!ruth) return;
    ruth.position.set(0, 0, .09); ruth.rotation.set(0, 0, 0); ruth.updateMatrixWorld(true);
  };

  let frameW = VIEW.width, dist = 30, coverX = 1, coverY = 1, fovBase = VIEW.fov;
  const resize = () => {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    renderer.setSize(W, H, false); composer.setSize(W, H); depthCopyRT.setSize(Math.round(W * renderer.getPixelRatio()), Math.round(H * renderer.getPixelRatio()));
    const pr = renderer.getPixelRatio(); focus.uniforms.resolution.value.set(W, H); bloom.resolution.set(W * pr / 2, H * pr / 2);
    camera.aspect = W / H;
    // the same width of room on any screen; a tall screen sees more floor
    camera.fov = fovBase = 2 * Math.atan(Math.tan(VIEW.fov * Math.PI / 360) * Math.max(1, 1.4 / camera.aspect)) * 180 / Math.PI;
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
      camera.fov = fovBase; camera.near = dist * .6; camera.far = dist * 1.6; camera.clearViewOffset(); orbit = null; if (box) box.visible = true;
      // for the firing the view draws back to the whole lab, frame C's camera
      if (st.wide > 0 && keys.c) { const k = st.wide * st.wide * (3 - 2 * st.wide), c = keys.c.cam;
        camera.position.lerp(c.position, k); camera.quaternion.slerp(c.quaternion, k); camera.fov += (keys.c.cj.fov - camera.fov) * k;
        camera.near += (keys.c.cj.near - camera.near) * k; camera.far += (keys.c.cj.far - camera.far) * k; }
    } else {
      // P.4: a true orbit round the hanging stone to Ruth's side, closing in until the stone is as big as in her photograph
      const T = stone.position;
      if (!orbit) { const v = camera.position.clone().sub(T), d0 = v.length(); orbit = { yaw0: Math.atan2(v.x, v.z), pitch0: Math.asin(v.y / d0), d0, q0: toScreen(T) }; placeRuth();
        // it turns the same way round each time; with Ruth it ends on the far side of the stone from her, looking at her face
        orbit.turn = Math.PI * .92;
        if (ruth) { const yEnd = Math.atan2(T.x - ruth.position.x, T.z - ruth.position.z); orbit.turn = ((yEnd - orbit.yaw0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); } }
      if (ruth) ruth.visible = st.swing > .3;
      const k = st.swing < .5 ? 2 * st.swing * st.swing : 1 - Math.pow(-2 * st.swing + 2, 2) / 2;
      // with Ruth in the room the lens widens through the turn, as her photograph was taken, so she shows from the waist up
      if (ruth) camera.fov = fovBase + (50 - fovBase) * k;
      const ppm1 = (REV.stoneW / REV.w / coverX * W) / .075, d1 = H / (2 * Math.tan(camera.fov * Math.PI / 360) * ppm1) * (ruth ? 1.6 : 1);   // with Ruth, back far enough for a mid-shot behind the crown
      // it closes in on the stone in the first part of the turn, so the camera stays inside the room as it goes round
      const kd = THREE.MathUtils.smoothstep(st.swing, 0, .4), dd = orbit.d0 * Math.pow(d1 / orbit.d0, kd);
      const yw = orbit.yaw0 + orbit.turn * k, pt = orbit.pitch0 + ((ruth ? -.02 : .12) - orbit.pitch0) * k;   // with Ruth, level with the stone, as her photograph looks
      camera.position.set(T.x + Math.sin(yw) * Math.cos(pt) * dd, T.y + Math.sin(pt) * dd, T.z + Math.cos(yw) * Math.cos(pt) * dd);
      camera.up.set(0, 1, 0); camera.lookAt(T);
      // with Ruth in the room, the push toward her eye is the camera itself moving in
      if (ruth && st.eyeZoom > 0) { const e = ruthEye(), z = st.eyeZoom * st.eyeZoom * .9; camera.position.lerp(e, z * .95); camera.lookAt(v3.copy(T).lerp(e, Math.min(1, z * 1.6))); } camera.near = Math.max(.02, dd * .2); camera.far = dd + 12;
      // the stone moves on screen from where it hung in the diorama to where it hangs in her photograph
      const qb = revToScreen(REV.stone.x, REV.stone.y);
      // as her photograph comes in, it holds its own box: only the real stone stays
      if (box) box.visible = ruth || capture.sharp ? true : st.swing < .7;
      camera.setViewOffset(W, H, (W / 2 - orbit.q0.x) * (1 - k) + (W / 2 - qb.x) * k, (H / 2 - orbit.q0.y) * (1 - k) + (H / 2 - qb.y) * k, W, H);
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    focus.uniforms.near.value = camera.near; focus.uniforms.far.value = camera.far;
    // the focus racks to where the pointer rests, or to the box when it is left alone
    const boxQ = stone ? toScreen(stone.position) : { x: W / 2, y: H / 2 };
    const fx = heldFocus ? heldFocus.x : pointerActive ? (look.x + 1) * .5 : boxQ.x / W, fy = heldFocus ? heldFocus.y : pointerActive ? (1 - look.y) * .5 : 1 - boxQ.y / H;
    focusAt.x += (fx - focusAt.x) * (1 - Math.exp(-dt * 8)); focusAt.y += (fy - focusAt.y) * (1 - Math.exp(-dt * 8));
    focus.uniforms.focusUv.value.copy(focusAt); focus.uniforms.amount.value = capture.sharp ? 0 : 1 - THREE.MathUtils.smoothstep(st.swing, 0, .3);

    // the box opens; the stone wakes, lifts to hang above it and turns; the room comes up red
    const o = st.open, glowK = o * (.78 + .32 * st.pulse + .04 * Math.sin(time * 1.3)) + st.flash * .9;
    st.flash *= Math.exp(-dt * 9); st.pulse *= Math.exp(-dt * 2.6);
    for (const h of hinges) h.o.quaternion.copy(h.base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), o * OPEN_ANGLE));
    if (stone) {
      const k = THREE.MathUtils.smoothstep(st.lift, 0, 1);
      stone.position.lerpVectors(stoneFrom, stoneHang, k); stone.position.y += k * .008 * Math.sin(time * 1.1);
      stone.rotation.y += dt * .45 * k;
      stoneLight.position.copy(stone.position);
      if (nodes.laser_exit) {
        const a = nodes.laser_exit.getWorldPosition(new THREE.Vector3()), b = stone.position, d = b.clone().sub(a), len = d.length();
        beam.position.copy(a).addScaledVector(d, .5); beam.scale.set(1, len, 1); beam.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, d.normalize());
        beamMat.opacity = .55 * st.beam;
        photonSprites.forEach((sp, i) => { sp.position.copy(a).lerp(b, [.28, .55, .8][i]); sp.scale.setScalar(.06); sp.material.opacity = st.beam; });
      }
      // the halo sits just behind the stone, as seen from the camera
      halo.position.copy(stone.position).addScaledVector(camera.position.clone().sub(stone.position).normalize(), -.12);
      halo.scale.setScalar(.36 * (1 + .25 * st.pulse + .35 * st.flash));
      halo.material.opacity = THREE.MathUtils.smoothstep(st.lift, 0, 1) * (.75 + .25 * st.pulse + .4 * st.flash);
      // past the middle of the turn they are drawn over the photograph that comes in
      const over = st.swing > .5 && !ruth ? fg : scene; if (stone.parent !== over) { over.add(stone); over.add(halo); }
    }
    if (gemMat) gemMat.emissiveIntensity = Math.min(1.2 + 4.5 * st.lift + st.flash * 3, glowK * 6);
    stoneLight.intensity = glowK * (14 + 8 * st.lift) * (.85 + .3 * st.pulse) * (ruth ? 1 - .7 * THREE.MathUtils.smoothstep(st.swing, .4, 1) : 1);   // close to Ruth's face it would burn her out
    // the desk lamp, until it is switched off; then only the moon
    lampSpot.intensity = 14 * (1 - st.lamp); lampGlow.intensity = .25 * (1 - st.lamp);
    if (bulbMat) bulbMat.emissiveIntensity = 3 * (1 - st.lamp);
    ruthRim.value = ruth ? THREE.MathUtils.smoothstep(st.swing, .5, 1) : 0;
    moon.intensity = 1.0 + .4 * st.lamp; fill.intensity = .12 * (1 - .35 * st.lamp);
    // Ruth's photograph over the end of the orbit
    plate.uniforms.mixB.value = plate.uniforms.reverse.value ? THREE.MathUtils.smoothstep(st.swing, .72, 1) : 0;
    plate.uniforms.eyeZoom.value = st.eyeZoom;
    const e = revToScreen(REV.eye.x, REV.eye.y); plate.uniforms.eyeAt.value.set(e.x / W, 1 - e.y / H);
    canvas.style.opacity = st.fade;
    focus.uniforms.tDepth.value = composer.readBuffer.depthTexture;
    turnBlur.uniforms.amt.value = Math.sin(Math.PI * Math.min(1, st.swing)) * .07; turnBlur.enabled = st.swing > .02 && st.swing < .98;
    if (proj.enabled) {
      depthCopy.uniforms.tDepth.value = composer.readBuffer.depthTexture; proj.uniforms.tDepth.value = depthCopyRT.texture; proj.uniforms.invProj.value.copy(camera.projectionMatrixInverse); proj.uniforms.camWorld.value.copy(camera.matrixWorld);
      for (const k of ['near', 'far', 'amount']) proj.uniforms[k].value = focus.uniforms[k].value; proj.uniforms.focusUv.value.copy(focus.uniforms.focusUv.value); proj.uniforms.resolution.value.copy(focus.uniforms.resolution.value);
      // which painting each beat rests on
      const sw = THREE.MathUtils.smoothstep(st.swing, .35, .95), before = 1 - THREE.MathUtils.smoothstep(st.swing, .15, .75), wide = THREE.MathUtils.smoothstep(st.wide, .6, 1);
      const want = [['a', (1 - st.lamp) * (1 - wide) * before], ['open', st.lamp * (1 - wide) * before], ['c', wide * before], [ruth && keys.b2 ? 'b2' : 'b', sw]]
        .filter(([k, w]) => w > 0 && keys[k] && keys[k].tex).sort((x, y) => y[1] - x[1]);
      setSlot('A', want[0] && keys[want[0][0]], want[0] ? want[0][1] : 0); setSlot('B', want[1] && keys[want[1][0]], want[1] ? want[1][1] : 0);
    }
    // for paintings of the room alone: the stone, its halo, the beam and photons left out (they are drawn live over them)
    if (stone) stone.visible = !capture.noStone; halo.visible = !capture.noStone && halo.visible; if (capture.noStone) { beamMat.opacity = 0; photonSprites.forEach(sp => sp.material.opacity = 0); }
    if (capture.depth) {
      // for painting over: each pixel's distance from the camera, white near to black far, between the near and far set
      const old = scene.overrideMaterial, bg = scene.background, tm = renderer.toneMapping;
      depthMat.uniforms.zNear.value = capture.depth[0]; depthMat.uniforms.zFar.value = capture.depth[1];
      scene.overrideMaterial = depthMat; scene.background = new THREE.Color(0); renderer.toneMapping = THREE.NoToneMapping; halo.visible = false;
      renderer.setRenderTarget(null); renderer.render(scene, camera);
      scene.overrideMaterial = old; scene.background = bg; renderer.toneMapping = tm; halo.visible = true;
    } else composer.render(dt);
  };

  // the page's helpers, as the plate lab has them
  const stoneScreen = () => stone ? toScreen(v3.copy(stone.position)) : { x: W / 2, y: H / 2 };
  const screen = () => glowAt ? toScreen(glowAt.getWorldPosition(new THREE.Vector3())) : stoneScreen();
  const nodeScreen = name => nodes[name] ? toScreen(nodes[name].getWorldPosition(new THREE.Vector3())) : null;
  const stonePx = () => { if (!stone) return 22; const a = toScreen(stone.position), b = toScreen(stone.position.clone().add(new THREE.Vector3(0, .1, 0))); return Math.abs(a.y - b.y) * .75; };
  const revToScreen = (px, py) => ({ x: ((px / REV.w - .5) / coverX + .5) * W, y: ((py / REV.h - .5) / coverY + .5) * H });
  // her eye: on her model, a little in front of the head bone; on her photograph, where it is in the picture
  const ruthEye = () => { const e = (ruthHead || ruth).getWorldPosition(new THREE.Vector3()); e.y += .06; const toStone = stone ? stone.position.clone().sub(e).setY(0).normalize() : new THREE.Vector3(0, 0, -1); return e.add(toStone.multiplyScalar(.1)); };
  const eyeScreen = () => ruth && ruth.visible ? toScreen(ruthEye()) : revToScreen(REV.eye.x, REV.eye.y);
  const setPointer = (x, y) => { pointerActive = true; look.x = x; look.y = y; };
  const holdFocus = (x, y) => { heldFocus = x == null ? null : { x, y }; };
  // the machine: the page sets how bright the monitor and each indicator are, 0 to 1
  const setMachine = (monitor, indicators = []) => {
    if (emissive.monitor) emissive.monitor.emissiveIntensity = Math.min(1, monitor) * .9;   // a dim screen, as in the approved picture
    emissive.indicators.forEach((m, i) => { if (m) m.emissiveIntensity = (indicators[i] || 0) * 6; });
  };
  const setLights = () => {};
  const dispose = () => {
    removeEventListener('resize', resize);
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); for (const m of [].concat(o.material || [])) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); } });
    if (plate.uniforms.reverse.value) plate.uniforms.reverse.value.dispose();
    haloTex.dispose(); halo.material.dispose(); beam.geometry.dispose(); beamMat.dispose(); photonSprites.forEach(sp => sp.material.dispose()); if (scene.environment) scene.environment.dispose();
    rt.dispose(); depthCopyRT.dispose(); composer.dispose(); renderer.dispose(); renderer.forceContextLoss();
  };
  // for the projection test: frames with no blur, and the depth seen from the same camera
  const capture = { sharp: false, depth: null, noStone: false };
  const depthMat = new THREE.ShaderMaterial({ uniforms: { zNear: { value: 1 }, zFar: { value: 30 } }, clipping: true,
    vertexShader: `#include <common>
      #include <skinning_pars_vertex>
      #include <clipping_planes_pars_vertex>
      varying float vz; void main() {
      #include <skinbase_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0); vz = -mvPosition.z; gl_Position = projectionMatrix * mvPosition;
      #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform float zNear, zFar; varying float vz; void main() {
      #include <clipping_planes_fragment>
      gl_FragColor = vec4(vec3(1.0 - clamp((vz - zNear) / (zFar - zNear), 0.0, 1.0)), 1.0); }` });
  const cameraJSON = () => ({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far,
    view: camera.view && camera.view.enabled ? { fullWidth: camera.view.fullWidth, fullHeight: camera.view.fullHeight, offsetX: camera.view.offsetX, offsetY: camera.view.offsetY, width: camera.view.width, height: camera.view.height } : null,
    projectionMatrix: camera.projectionMatrix.toArray(), matrixWorld: camera.matrixWorld.toArray(), width: W, height: H });
  return { proj, composer, loadProjection, capture, cameraJSON, st, render, ready, screen, stoneScreen, stonePx, nodeScreen, revToScreen, eyeScreen, loadReverse, setPointer, holdFocus, setMachine, setLights, dispose, renderer,
    is3d: true, get box() { return box; }, camera, scene };
}
