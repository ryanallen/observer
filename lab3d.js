// The lab as a real room: the whole lab in 3D, seen from above like the bay, a tilt-shift diorama. The pointer moves the
// camera a little (real parallax, about 2% of the frame) and racks the focus to what it rests on. The desk lamp, the
// moonlight through the north windows and the stone's red glow are real lights; the box opens on its hinges and the stone
// lifts to hang above it. After the firing the camera moves straight in to the stone (never turning) until its faces fill
// the screen; inside it, the stone's own visions (a shader), which resolve into the church.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let OPEN_ANGLE = .72;
// the church in the stone, at rest: covering the screen a little larger than it (CHURCH_ZOOM), shifted by the pointer at
// most CHURCH_SHIFT of the screen each way, as on the moor
export const CHURCH_ZOOM = 1.05, CHURCH_SHIFT = .02, CHURCH_FOCUS = 0;   // held at the top: the steeple's tip always in frame
// where the church sits: its scale (screen pixels per image pixel) and the image point at the middle of the screen. On a
// wide screen the square picture is cropped top and bottom, held up toward the tower (CHURCH_FOCUS of its height) but
// never past its edge, with room for the shift. index.html draws it the same way
export const churchFrame = (W, H, iw, ih) => {
  const sc = Math.max(W / iw, H / ih) * CHURCH_ZOOM, hh = (H / 2 + CHURCH_SHIFT * H) / sc;
  return { sc, cx: iw / 2, cy: Math.max(hh, Math.min(ih - hh, CHURCH_FOCUS * ih)) };
};   // the panels tipped out into a crown, as wide as in the approved open-box picture
// the diorama camera: from the south-west, high and far, looking down at the worktable with the windows up to the left and
// the photon bench behind; a long lens for the miniature look
const VIEW = { dir: new THREE.Vector3(-Math.sin(.66) * Math.cos(.7), Math.sin(.7), Math.cos(.66) * Math.cos(.7)), target: new THREE.Vector3(.05, .76, .7), width: 8.2, fov: 14 };
export function createLab(canvas, opts = {}) {
  // for tuning: ?view=yaw,pitch,width[,x,y,z] (degrees, degrees, metres, and the point looked at)
  if (opts.view) { const [yw, pt, wd] = opts.view.split(',').map(Number); VIEW.dir.set(Math.sin(yw * Math.PI / 180) * Math.cos(pt * Math.PI / 180), Math.sin(pt * Math.PI / 180), Math.cos(yw * Math.PI / 180) * Math.cos(pt * Math.PI / 180)); if (wd) VIEW.width = wd; const t = opts.view.split(',').map(Number); if (t.length >= 6) VIEW.target.set(t[3], t[4], t[5]); }
  const mobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  // the diorama's cut: everything west of x -3.55 m, south of z 2.55 m and above 3.3 m is not drawn (the near walls, what
  // hangs on them, and the ceiling)
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

  // dive: the move in to the stone, 0 to 1; trip: the visions inside it showing, 0 to 1; church: the church taking over
  const st = { lamp: 0, open: 0, lift: 0, flash: 0, pulse: 0, fade: 1, beam: 0, dive: 0, trip: 0, church: 0 };
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
    room.traverse(o => { if (o.isMesh && /window_glass|window_night/.test(o.material.name)) { o.castShadow = false; if (/window_glass/.test(o.material.name)) o.material.depthWrite = false; } });
    // what shiny things reflect: a dark room with the lamp's warm glow and the cool windows
    scene.environment = envMap(); room.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) o.material.envMapIntensity = .5; });
    room.traverse(o => { if (o.isMesh && o.material.name === 'lab_black_plastic') { o.material.metalness = 0; o.material.roughness = Math.max(o.material.roughness, .75); } });
    room.traverse(o => { if (o.isMesh && o.material.name === 'box_lid_filigree') { o.material.side = THREE.DoubleSide; o.material.alphaTest = o.material.alphaTest || .5; o.material.transparent = false; } });
    // the box as its own model (it shows as itself on the move in to the stone): old dark bronze and iron, not a bright
    // mirror; it takes the stone's red light, and the room's reflections only faintly
    { const seen = new Set(); room.traverse(o => { if (!o.isMesh || !/^box_/.test(o.material.name) || seen.has(o.material)) return; const m = o.material; seen.add(m);
      if (/filigree|relief|bright/.test(m.name)) m.color.multiplyScalar(.32); m.envMapIntensity = .15; m.roughness = Math.max(m.roughness, .5); }); }
    // the papers by the box are old and yellowed, not white: close to the stone they take its red, not burn pale
    room.traverse(o => { if (o.isMesh && /lab_paper|lab_voynich|lab_label|lab_binder/.test(o.material.name) && !o.material.userData.aged) { o.material.color.multiplyScalar(.15); o.material.userData.aged = true; } });
    // the stone: lifted out of its seat into the room itself, so it can rise to where it hangs above the box
    const seat = nodes.gem_seat; glowAt = nodes.gem_glow || seat;
    let stoneMesh = null; room.traverse(o => { if (!stoneMesh && o.isMesh && /stone/.test(o.material.name)) stoneMesh = o; });
    if (stoneMesh) {
      gemMat = stoneMesh.material;
      // its glow is a deep red-orange from inside; a model without one is given it
      if (gemMat.emissive && gemMat.emissive.getHex() === 0) gemMat.emissive.setHex(0xff3a14);
      veinStone(stoneMesh);
      let top = stoneMesh; while (top.parent && top.parent !== seat && top.parent !== box && top.parent !== room) top = top.parent;
      stone = new THREE.Group(); scene.add(stone);
      top.getWorldPosition(stoneFrom); stone.position.copy(stoneFrom); stone.attach(top);
    }
    if (nodes.stone_hang) nodes.stone_hang.getWorldPosition(stoneHang); else stoneHang.copy(stoneFrom);
    // it hangs where the room's stone_hang has it (where the paintings show it); a room without one lifts it clear of
    // the open crown
    if (!nodes.stone_hang) stoneHang.y = Math.max(stoneHang.y, stoneFrom.y + .42);
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

  // the stone: black, red-veined, with many irregular flat facets. Its faces are flat (each catches the light as one plane,
  // with sharp edges between them); its veins are drawn on it, not painted into a texture: open branching cracks running
  // across the faces, as lava shows through cracks in obsidian, forking and tapering, crisp however close the view comes,
  // pulsing slowly and swelling on the heartbeat. Taken in the stone's own space, so they stay on it as it turns
  const veinU = { vTime: { value: 0 }, vPulse: { value: 0 }, vScale: { value: 1 } };
  function veinStone(mesh) {
    const m = mesh.material; mesh.geometry.computeBoundingSphere();
    veinU.vScale.value = 1 / (mesh.geometry.boundingSphere.radius || 1);
    m.map = null; m.emissiveMap = null; m.normalMap = null; m.flatShading = true;
    m.color.setRGB(.012, .009, .009); m.metalness = .2; m.roughness = .1; m.envMapIntensity = 1.1; m.emissive.setHex(0xc81a06);
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, veinU);
      sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vObj = position;');
      sh.fragmentShader = `uniform float vTime, vPulse, vScale; varying vec3 vObj;
        vec3 vh3(vec3 p) { p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453); }
        float vn(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(vh3(i).x, vh3(i + vec3(1, 0, 0)).x, f.x), mix(vh3(i + vec3(0, 1, 0)).x, vh3(i + vec3(1, 1, 0)).x, f.x), f.y),
                     mix(mix(vh3(i + vec3(0, 0, 1)).x, vh3(i + vec3(1, 0, 1)).x, f.x), mix(vh3(i + vec3(0, 1, 1)).x, vh3(i + vec3(1, 1, 1)).x, f.x), f.y), f.z); }
        // the distance to the nearest crack: the borders between cells, each cell a chip of the stone
        float crackDist(vec3 x) {
          vec3 n = floor(x), f = fract(x), mr = vec3(0.0), mg = vec3(0.0); float md = 8.0;
          for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec3 g = vec3(float(i), float(j), float(k)), r = g + vh3(n + g) - f; float d = dot(r, r);
            if (d < md) { md = d; mr = r; mg = g; } }
          md = 8.0;
          for (int k = -2; k <= 2; k++) for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            vec3 g = mg + vec3(float(i), float(j), float(k)), r = g + vh3(n + g) - f;
            if (dot(mr - r, mr - r) > .00001) md = min(md, dot(.5 * (mr + r), normalize(r - mr))); }
          return md;
        }
        // the cracks: a coarse set and a fine set branching off it; each is broken open in places (no closed cells) and
        // thins to nothing where it ends, so they fork and taper
        float cracks(vec3 p0) {
          vec3 p = p0 * 1.7 + (vec3(vn(p0 * 2.3), vn(p0 * 2.3 + 5.1), vn(p0 * 2.3 + 9.7)) - .5) * .35;
          float v = 0.0;
          for (int o = 0; o < 2; o++) {
            float fo = float(o), d = crackDist(p);
            float open = smoothstep(.38 + .12 * fo, .62 + .1 * fo, vn(p * (1.6 + fo) + 3.7 * fo));   // where this set is cracked through
            float w = (.035 - .018 * fo) * open;                                                     // and how wide: tapering to nothing
            float core = 1.0 - smoothstep(w * .45, w, d), glow = exp(-d / max(w * 2.2, 1e-4)) * open;
            v = max(v, (core + .3 * glow) * (1.0 - .45 * fo));
            p = p * 2.6 + vec3(1.7, 4.1, 2.3);
          }
          return v;
        }
      ` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 q = vObj * vScale; float pulse = .7 + .3 * sin(vTime * .9 - vn(q * 2.0) * 6.2831) + .5 * vPulse;
          totalEmissiveRadiance *= cracks(q) * pulse; }`);
    };
    m.needsUpdate = true;
  }

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
      focusUv: { value: new THREE.Vector2(.5, .5) }, band: { value: 1 }, near: { value: 1 }, far: { value: 100 }, amount: { value: 1 }, resolution: { value: new THREE.Vector2(1, 1) },
      tBox: { value: null }, tBoxUv: { value: null }, pAb: { value: null }, pBb: { value: null }, lbA: { value: 0 }, lbB: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `#include <packing>
      uniform sampler2D tBox, tBoxUv, pAb, pBb; uniform float lbA, lbB;
      uniform sampler2D tDiffuse, tDepth, pA, dA, pB, dB; uniform mat4 invProj, camWorld, vpA, vA, vpB, vB; uniform vec2 rA, rB, focusUv, resolution; uniform float wA, wB, near, far, amount, band; varying vec2 vUv;
      float farAway;   // 1 where the live view sees nothing of the room
      float blurAt;   // the miniature's softness here, in pixels on screen, used when sampling the painting
      // how much of a painting lands here: inside its frame, and the surface is the one its camera saw
      vec4 lay(vec3 w, sampler2D p, sampler2D d, mat4 vp, mat4 v, vec2 r) {
        vec4 c = vp * vec4(w, 1.0); if (c.w <= 0.0) return vec4(0.0);
        vec2 uv = c.xy / c.w * .5 + .5; if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
        // the nearest of what its camera saw here and a texel round it, so the room's edges (where the screen and the
        // painting sample the depth a pixel apart) never show a seam
        float z = -(v * vec4(w, 1.0)).z, miss = 1e9; vec2 tx = 1.0 / vec2(textureSize(d, 0));
        for (int j = 0; j < 5; j++) { vec2 o = j == 0 ? vec2(0.0) : j == 1 ? vec2(tx.x, 0.0) : j == 2 ? vec2(-tx.x, 0.0) : j == 3 ? vec2(0.0, tx.y) : vec2(0.0, -tx.y);
          float stored = texture2D(d, uv + o).r; miss = min(miss, abs(z - (r.x + (1.0 - stored) * (r.y - r.x)))); }
        // where the live view sees nothing of the room (through the windows, past the cut) the painting shows as painted
        float ok = farAway > .5 ? 1.0 : 1.0 - smoothstep(.015, .04, miss / z);
        vec2 e = min(uv, 1.0 - uv); ok *= smoothstep(0.0, .004, min(e.x, e.y));   // the framing keeps the view clear of this
        // the painting softened like the rest of the frame: sharp where the pointer rests, soft away from it
        vec2 px = vec2(1.0) / resolution * blurAt; vec3 col = vec3(0.0);
        for (int i = 0; i < 12; i++) { float a = float(i) * 2.39996323, rr = sqrt((float(i) + .5) / 12.0); col += texture2D(p, uv + px * rr * vec2(cos(a), sin(a))).rgb; }
        return vec4(col / 12.0, ok);
      }
      // a painting at a given place in it, softened as the frame is
      vec3 soft(sampler2D p, vec2 uv) {
        vec2 px = vec2(1.0) / resolution * blurAt; vec3 col = vec3(0.0);
        for (int i = 0; i < 12; i++) { float a = float(i) * 2.39996323, rr = sqrt((float(i) + .5) / 12.0); col += texture2D(p, uv + px * rr * vec2(cos(a), sin(a))).rgb; }
        return col / 12.0;
      }
      void main() {
        vec3 base = texture2D(tDiffuse, vUv).rgb; float dz = texture2D(tDepth, vUv).x;
        farAway = dz >= .99999 ? 1.0 : 0.0; if (farAway > .5) dz = .9999;
        float here = -perspectiveDepthToViewZ(dz, near, far), pointed = -perspectiveDepthToViewZ(texture2D(tDepth, focusUv).x, near, far);
        blurAt = max(smoothstep(.012, .07, abs(here - pointed) / pointed) * .9, smoothstep(.07, .34, abs(vUv.y - focusUv.y)) * band) * amount * 6.0 * min(1.0, min(resolution.x, resolution.y) / 800.0);   // gentler than the room's own: the painting is already soft where it should be
        vec4 vpos = invProj * vec4(vUv * 2.0 - 1.0, dz * 2.0 - 1.0, 1.0); vpos /= vpos.w; vec3 w = (camWorld * vpos).xyz;
        vec4 a = wA > 0.0 ? lay(w, pA, dA, vpA, vA, rA) : vec4(0.0), b = wB > 0.0 ? lay(w, pB, dB, vpB, vB, rB) : vec4(0.0);
        // the live box, where a plate has none: the painting gives way to it (its mask softened by a pixel, as the frame is)
        // its edge softened over a pixel round, as the live frame's is, each edge pixel taking the place in the paintings
        // of the box pixels beside it
        float bm = 0.0, lm = 0.0; vec4 bu = vec4(0.0);
        if (lbA + lbB > 0.0) { vec2 bp = 1.0 / resolution;
          for (int j = 0; j < 9; j++) { vec2 o = vec2(float(j - (j / 3) * 3 - 1), float(j / 3 - 1)) * bp; vec4 t = texture2D(tBox, vUv + o); float m = step(.5, t.r); bm += m; bu += m * texture2D(tBoxUv, vUv + o); lm += step(.5, t.g) * (1.0 - m); }
          lm /= 9.0;
          bu /= max(bm, 1.0); bm /= 9.0; }
        float ka = a.a * wA, kb = b.a * wB, k = max(ka, kb);   // (under the box the plate lands too: the box is a few cm off the table, inside the depth test)
        vec3 paint = (a.rgb * ka + b.rgb * kb) / max(ka + kb, 1e-4);
        // this runs after the frame's tone mapping, so the paintings keep their own colours exactly
        vec3 col = mix(base, paint, k);
        // the box wears its own painted pixels: each part carries the look it has in the paintings (closed in the lamp-lit
        // one, open in the open and firing ones), so it opens as a solid thing and lands exactly on the painted box
        float bw = wA * lbA + wB * lbB;
        if (bm > 0.0 && bw > 0.0) { vec4 u = bu;
          vec3 bc = ((lbA > 0.0 ? soft(pAb, u.xy) * wA : vec3(0.0)) + (lbB > 0.0 ? soft(pBb, u.zw) * wB : vec3(0.0))) / bw;
          col = mix(col, bc, min(1.0, bw) * bm); }
        // the live stone, hanging over the paintings: the live frame shows through where it is
        col = mix(col, base, lm);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  proj.enabled = false;
  // the live box's place on screen this frame, white on black: drawn alone (layer 1) in plain white, against the room's depth
  // (red where the box is; green where the live stone is, which the paintings leave out and must not cover either)
  const boxRT = new THREE.WebGLRenderTarget(1, 1), boxMaskMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide }), stoneMaskMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
  const drawBoxMask = () => {
    if (!box.userData.masked) { box.traverse(o => o.layers.enable(1)); if (stone) stone.traverse(o => { if (o.isMesh) o.layers.enable(2); }); box.userData.masked = true; }
    const old = scene.overrideMaterial, bg = scene.background, tm = renderer.toneMapping, cl = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    scene.overrideMaterial = boxMaskMat; scene.background = null; renderer.toneMapping = THREE.NoToneMapping; camera.layers.set(1);
    const sa = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;   // the shadows are the room's, not the mask's
    renderer.setRenderTarget(boxRT); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, camera);
    if (stone && stone.visible) { const ac = renderer.autoClear; renderer.autoClear = false; scene.overrideMaterial = stoneMaskMat; camera.layers.set(2); renderer.render(scene, camera); camera.layers.set(1); renderer.autoClear = ac; }
    scene.overrideMaterial = boxUvMat; renderer.setRenderTarget(boxUvRT); renderer.clear(); renderer.render(scene, camera); renderer.setRenderTarget(null); renderer.shadowMap.autoUpdate = sa;
    camera.layers.set(0); scene.overrideMaterial = old; scene.background = bg; renderer.toneMapping = tm; renderer.setClearColor(cl, ca);
  };
  // where each point of the box is in the paintings of the two slots this frame, from coordinates baked per painting
  const boxUvRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const boxUvMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { selA: { value: 0 }, selB: { value: 0 } },
    vertexShader: `attribute vec2 uvKa, uvKo; uniform float selA, selB; varying vec4 vS;
      vec2 pick(float s) { return s < .5 ? uvKa : uvKo; }
      void main() { vS = vec4(pick(selA), pick(selB)); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec4 vS; void main() { gl_FragColor = vS; }` });
  const SEL = { a: 0, open: 1 };
  // each vertex of the box, posed as in a painting (closed in the lamp-lit one, open in the other), seen by its camera
  const bakeBoxUv = () => {
    if (!box) return;
    const poses = [['uvKa', keys.a, 0], ['uvKo', keys.open, 1]], v = new THREE.Vector3();
    const meshes = []; box.traverse(o => { if (o.isMesh) meshes.push(o); });
    for (const [name, key, o] of poses) {
      for (const h of hinges) h.o.quaternion.copy(h.base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), o * OPEN_ANGLE));
      box.updateMatrixWorld(true);
      for (const m of meshes) {
        const pos = m.geometry.attributes.position, out = new Float32Array(pos.count * 2);
        if (key && key.vp) for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(key.vp); out[i * 2] = v.x * .5 + .5; out[i * 2 + 1] = v.y * .5 + .5; }
        m.geometry.setAttribute(name, new THREE.BufferAttribute(out, 2));
      }
    }
    box.updateMatrixWorld(true);
  };
  // the paintings and the depth each camera saw, made once when they are loaded
  // the key frames: a painting of the room from a known camera for each beat it rests on (a: the lamp on; open: the box
  // open, which the firing holds too). Each is laid back on the room from its own camera; the two that weigh most this
  // frame fill the pass's two slots
  const keys = {};
  // a key frame's camera: its matrices as saved, or (from a Blender render) built from position, quaternion, vertical fov,
  // the frame's size and near/far, all in the room's own coordinates (y up, as the glb has them)
  const keyCamera = cj => {
    const c = new THREE.PerspectiveCamera(cj.fov, cj.width / cj.height, cj.near || .1, cj.far || 100); c.matrixAutoUpdate = false; c.matrixWorldAutoUpdate = false;
    c.position.fromArray(cj.position); c.quaternion.fromArray(cj.quaternion);
    if (cj.matrixWorld) c.matrixWorld.fromArray(cj.matrixWorld); else c.matrixWorld.compose(c.position, c.quaternion, new THREE.Vector3(1, 1, 1));
    c.matrixWorldInverse.copy(c.matrixWorld).invert();
    if (cj.projectionMatrix) c.projectionMatrix.fromArray(cj.projectionMatrix); else { c.updateProjectionMatrix(); cj.projectionMatrix = c.projectionMatrix.toArray(); }
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert(); return c; };
  const loadProjection = async (base = 'models/web/room2/', names = ['a', 'open']) => {
    const tl = new THREE.TextureLoader(), get = u => fetch(u).then(r => r.ok ? r.json() : null).then(j => typeof j === 'string' ? JSON.parse(j) : j).catch(() => null);
    await ready;
    await Promise.all(names.map(async k => {
      const cj = await get(base + k + '_camera.json'); if (!cj) return;
      const key = keys[k] = { cam: keyCamera(cj), cj, tex: null, depth: null, range: cj.depthRange || [cj.near, cj.far] };
      // where the room has a plate without the box (lamp-on, open, firing), the box is the live 3D one, opening on its
      // hinges over the plate; the painting with the box in it is the fallback
      // (asked for only where the camera says its plate exists)
      const plain = cj.nobox ? await tl.loadAsync(base + k + '_nobox.webp').catch(() => null) : null;
      const painted = await tl.loadAsync(base + k + '_paint.webp').catch(() => null);
      key.liveBox = !!(plain && painted); key.tex = key.liveBox ? plain : painted; key.texBox = key.liveBox ? painted : null; if (!key.tex) return;
      if (key.texBox) { key.texBox.minFilter = THREE.LinearFilter; key.texBox.generateMipmaps = false; }
      key.tex.minFilter = THREE.LinearFilter; key.tex.generateMipmaps = false;
      // sent to the GPU now, not on the beat that first shows it (a 2080 px painting is a 40 ms stall)
      renderer.initTexture(key.tex); if (key.texBox) renderer.initTexture(key.texBox);
      key.depth = new THREE.WebGLRenderTarget(cj.width, cj.height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }); keyDepth(key);
      key.vp = new THREE.Matrix4().multiplyMatrices(key.cam.projectionMatrix, key.cam.matrixWorldInverse);
    }));
    // the lamp-on and box-open paintings share a camera and the view rests on the first's framing: keep it inside both
    const sa = keys.a && keys.a.cj.solid, so = keys.open && keys.open.cj.solid;
    if (sa && so && sa.solid.length === so.solid.length) { sa.solid = Array.from(sa.solid, (c, i) => c === '1' && so.solid[i] === '1' ? '1' : '0').join(''); keys.a.win = null; }
    if (Object.values(keys).some(k => k.liveBox)) bakeBoxUv();
    proj.enabled = depthCopy.enabled = Object.values(keys).some(k => k.tex);
  };
  // what a key frame's camera saw, as depth
  function keyDepth(key) {
    depthMat.uniforms.zNear.value = key.range[0]; depthMat.uniforms.zFar.value = key.range[1];
    const old = scene.overrideMaterial, bg = scene.background, tm = renderer.toneMapping, sv = stone && stone.visible;
    // the window glass is see-through in the room, so it is left out of what each camera saw, as in the live depth
    const glass = []; scene.traverse(o => { if (o.isMesh && o.visible && /window_glass/.test(o.material.name)) { glass.push(o); o.visible = false; } });
    scene.overrideMaterial = depthMat; scene.background = new THREE.Color(0); renderer.toneMapping = THREE.NoToneMapping; halo.visible = false; beam.visible = false; if (stone) stone.visible = false;
    photonSprites.forEach(sp => sp.visible = false);   // sprites would print as solid squares in the depth
    const bv = box && box.visible; if (box && key.liveBox) box.visible = false;   // left out, so the live box shows over the plate
    renderer.setRenderTarget(key.depth); renderer.clear(); renderer.render(scene, key.cam); renderer.setRenderTarget(null);
    if (box) box.visible = bv; photonSprites.forEach(sp => sp.visible = true);
    scene.overrideMaterial = old; scene.background = bg; renderer.toneMapping = tm; halo.visible = true; beam.visible = true; if (stone) stone.visible = sv; glass.forEach(o => o.visible = true);
  }
  // a key frame's camera, zoomed so the screen shows only the solid part of its painting (never the black past the room's
  // cut or the painting's edge), at the screen's own shape, with room left for the pointer's shift; the shift slides the
  // view inside that room
  // the pointer's shift, as a share of the window kept solid: the view is that much smaller than the window on each side,
  // and slides at most that far (about 2% of the frame)
  const SHIFT_ROOM = .045;
  const frameKey = (key, sx = 0, sy = 0, win = null) => {
    const cj = key.cj, sol = cj.solid, aS = W / H;
    // a painting with no mask is room all through: framed as a wide one whose whole canvas is its composition
    const core = cj.core || (!sol && [0, 0, cj.width, cj.height]);
    if ((!key.win || key.winAspect !== aS) && core) {
      // a wide painting (room all through, the original composition at "core" inside it): the view holds the whole
      // original where the screen's shape allows, and otherwise the most of it that fits inside the painting with room
      // for the shift, centred on the beat's subject
      const [ox, oy, cw, ch] = core, aP = cj.width / cj.height;
      // (fit 'cover': the core always fills the screen, cropped to its shape, for a painting whose outside is dark)
      let hx = (cj.fit === 'cover' ? Math.min(cw, ch * aS) : Math.max(cw, ch * aS)) / cj.width, hy = hx * aP / aS;
      const E = .985, k = Math.min(1, E / (hx * (1 + SHIFT_ROOM)), E / (hy * (1 + SHIFT_ROOM))); hx *= k; hy *= k;
      const fx = cj.focus ? cj.focus[0] / cj.width * 2 - 1 : (ox + cw / 2) / cj.width * 2 - 1, fy = cj.focus ? 1 - cj.focus[1] / cj.height * 2 : 1 - (oy + ch / 2) / cj.height * 2;
      // the original's own centre where it is all shown, sliding toward the subject as the view closes in
      const ccx = (ox + cw / 2) / cj.width * 2 - 1, ccy = 1 - (oy + ch / 2) / cj.height * 2, t = 1 - Math.min(1, hx * cj.width / cw, hy * cj.height / ch);
      const lx = E - hx * (1 + SHIFT_ROOM), ly = E - hy * (1 + SHIFT_ROOM);
      const cx = Math.max(-lx, Math.min(lx, ccx + (fx - ccx) * t)), cy = Math.max(-ly, Math.min(ly, ccy + (fy - ccy) * t));
      key.win = { cx, cy, hx, hy, mx: hx * SHIFT_ROOM, my: hy * SHIFT_ROOM }; key.winAspect = aS;
    }
    if (!key.win || key.winAspect !== aS) {
      const gw = sol ? sol.w : 64, gh = sol ? sol.h : 36;
      // solid cells, less one cell all round where the room ends (an edge cell can be partly past it)
      const raw = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && (!sol || sol.solid[y * gw + x] === '1');
      const okGrid = new Uint8Array(gw * gh);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        let o = raw(x, y); if (sol) for (let dy = -1; dy <= 1 && o; dy++) for (let dx = -1; dx <= 1 && o; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < gw && Y < gh && !raw(X, Y)) o = false; }
        okGrid[y * gw + x] = o ? 1 : 0;
      }
      // a summed table, so any window's count of bad cells is four lookups
      const bad = new Int32Array((gw + 1) * (gh + 1));
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) bad[(y + 1) * (gw + 1) + x + 1] = (1 - okGrid[y * gw + x]) + bad[y * (gw + 1) + x + 1] + bad[(y + 1) * (gw + 1) + x] - bad[y * (gw + 1) + x];
      const badIn = (x, y, w, h) => bad[(y + h) * (gw + 1) + x + w] - bad[y * (gw + 1) + x + w] - bad[(y + h) * (gw + 1) + x] + bad[y * (gw + 1) + x];
      const aP = cj.width / cj.height, fx = (cj.focus ? cj.focus[0] / cj.width : .5) * gw, fy = (cj.focus ? cj.focus[1] / cj.height : .5) * gh;
      // the largest window of the screen's exact shape that is solid all through, nearest the beat's subject; its cells
      // are counted rounded outward, so the window shown is always inside solid cells
      let best = null;
      for (let wc = gw; wc >= 2 && !best; wc--) {
        const hExact = wc / aS * (gh / gw) * aP, hc = Math.ceil(hExact - 1e-6);
        if (hc > gh) continue;
        let d0 = 1e9;
        for (let y = 0; y + hc <= gh; y++) for (let x = 0; x + wc <= gw; x++) {
          if (badIn(x, y, wc, hc)) continue;
          const d = (x + wc / 2 - fx) ** 2 + (y + hc / 2 - fy) ** 2; if (d < d0) { d0 = d; best = [x + wc / 2, y + hc / 2, wc, hExact]; }
        }
      }
      // no solid window at all (no mask): the whole painting, cover-fitted to the screen
      if (!best) { const wc = Math.min(gw, gh * aS / aP * (gw / gh)); best = [gw / 2, gh / 2, wc, wc / aS * (gh / gw) * aP]; }
      // in the painting's NDC: centre and the window's half size (the screen's shape exactly)
      const cx = best[0] / gw * 2 - 1, cy = 1 - best[1] / gh * 2, hx = best[2] / gw, hy = best[3] / gh;
      key.win = { cx, cy, hx: hx * (1 - SHIFT_ROOM), hy: hy * (1 - SHIFT_ROOM), mx: hx * SHIFT_ROOM, my: hy * SHIFT_ROOM }; key.winAspect = aS;
    }
    // the shift slides the view inside the window, never past it
    const wn = win || key.win, { hx, hy, mx, my } = wn, cx = wn.cx + Math.max(-1, Math.min(1, sx)) * mx, cy = wn.cy + Math.max(-1, Math.min(1, sy)) * my;
    const T = new THREE.Matrix4().set(1 / hx, 0, 0, -cx / hx, 0, 1 / hy, 0, -cy / hy, 0, 0, 1, 0, 0, 0, 0, 1);
    return T.multiply(key.cam.projectionMatrix.clone());
  };
  const setSlot = (slot, key, w) => { const u = proj.uniforms; u['w' + slot].value = key ? w : 0; if (!key) return;
    u['p' + slot].value = key.tex; u['d' + slot].value = key.depth.texture; u['vp' + slot].value.copy(key.vp); u['v' + slot].value.copy(key.cam.matrixWorldInverse); u['r' + slot].value.set(key.range[0], key.range[1]); };
  const focus = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, focusUv: { value: new THREE.Vector2(.5, .5) }, resolution: { value: new THREE.Vector2(1, 1) },
      near: { value: 1 }, far: { value: 100 }, amount: { value: 1 }, band: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `#include <packing>
      uniform sampler2D tDiffuse, tDepth; uniform vec2 focusUv, resolution; uniform float near, far, amount, band; varying vec2 vUv;
      float viewZ(vec2 p) { return -perspectiveDepthToViewZ(texture2D(tDepth, p).x, near, far); }
      void main() {
        float here = viewZ(vUv), pointed = viewZ(focusUv);
        // how far in front of or behind the point in focus, as a share of the distance, plus the miniature's band
        float blur = max(smoothstep(.012, .07, abs(here - pointed) / pointed) * .9, smoothstep(.07, .34, abs(vUv.y - focusUv.y)) * band) * amount;
        vec2 px = vec2(1.0) / resolution * blur * 12.0 * min(1.0, min(resolution.x, resolution.y) / 800.0);   // a small screen shows less room per pixel: less blur
        float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
        vec3 soft = vec3(0.0);
        for (int i = 0; i < 16; i++) { float a = float(i) * 2.39996323 + turn, r = sqrt((float(i) + .5) / 16.0); soft += texture2D(tDiffuse, vUv + px * r * vec2(cos(a), sin(a))).rgb; }
        gl_FragColor = vec4(mix(texture2D(tDiffuse, vUv).rgb, soft / 16.0, blur), 1.0);
      }`,
  });
  composer.addPass(focus);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .35, .4, 1.0); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(proj);
  // inside the stone: its faces, each a flat plane of the crystal bending what is behind it; red veins flowing through it
  // in a slow kaleidoscope of fractal light; then the church coming through the faces, until it is all there is. Drawn on
  // the finished picture, so its colours are the screen's own (the church shows exactly as painted)
  const trip = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, church: { value: null }, plain: { value: null }, time: { value: 0 }, amt: { value: 0 }, churchMix: { value: 0 }, under: { value: 1 },
      pulse: { value: 0 }, res: { value: new THREE.Vector2(1, 1) }, csize: { value: new THREE.Vector2(1, 1) }, cmid: { value: new THREE.Vector2(.5, .5) }, shiftPx: { value: new THREE.Vector2() }, sc: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse, church, plain; uniform float time, amt, churchMix, under, pulse, sc; uniform vec2 res, csize, cmid, shiftPx; varying vec2 vUv;
      mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p) { float a = .5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = rot(.6) * p * 2.03 + 3.1; a *= .5; } return s; }
      // the church as the page shows it at rest: covering the screen, a little larger than it, so the pointer can shift it
      vec2 churchUv(vec2 uv) {
        vec2 px = vec2(uv.x * res.x, (1.0 - uv.y) * res.y), ip = (px - .5 * res - shiftPx) / sc + cmid;
        return clamp(vec2(ip.x / csize.x, 1.0 - ip.y / csize.y), .001, .999);
      }
      // the veins: thin rivers of light in a slowly flowing field (ridges of warped noise)
      float veins(vec2 p, float t) {
        vec2 q = vec2(fbm(p + vec2(0.0, t * .05)), fbm(p + vec2(5.2, 1.3) - vec2(t * .04, 0.0)));
        float n = fbm(p * 1.2 + 1.8 * q + vec2(t * .02, -t * .015));
        return pow(1.0 - abs(2.0 * n - 1.0), 30.0);
      }
      // the well inside the stone: its faces in rings, each ring a smaller copy of the one outside it (log-polar, so the
      // faces keep their shape), the angle folded into mirrored wedges, all falling slowly inward. Returns the frame's
      // colour; n is the face's tilt, for what it bends behind it
      vec3 well(vec2 p, float t, float beat, out vec2 n, out float vein) {
        float r = max(length(p), 1e-4), a = atan(p.y, p.x) + t * .02, seg = 6.2831853 / 7.0;
        a = abs(mod(a, seg) - seg * .5);                          // seven mirrored wedges
        const float M = 21.0;                                     // faces round each ring
        vec2 lp = vec2(log(r), a) * (M / 6.2831853);
        lp.x -= t * .16;                                          // falling in
        lp.y += .18 * sin(lp.x * .9 + t * .13);                   // each ring turning a little against the next
        // diamond faces, so the rings wind in as crossing spirals, as a cut stone's facets do
        vec2 dl = vec2(lp.x + lp.y, lp.x - lp.y) * .7071, id = floor(dl), f = fract(dl) - .5;
        n = vec2(hash(id), hash(id + 4.3)) - .5;
        float shade = hash(id + 9.1);
        // the face: a plane of dark red glass, lit across its slope, with a sheen that slides over the faces slowly
        float slope = .5 + 1.3 * dot(n, f);
        float sheen = pow(max(0.0, sin(lp.x * .7 - lp.y * 1.3 + t * .5 + shade * 2.0)), 10.0);
        vec3 col = vec3(.08, .008, .005) * (.35 + shade) * slope + vec3(.55, .09, .03) * sheen * (.3 + .7 * shade);
        // seen through it, bent by its tilt: the veins, flowing inward with the faces, split a little into colours
        vec2 vp = lp * .8 + n * .45;
        float vr = veins(vp + vec2(.03, 0.0), t), vg = veins(vp, t);
        vein = vg;
        col += (vec3(.95, .07, .02) * vr + vec3(.6, .2, .05) * vg * vg) * beat;
        // its edges catching the light: a thin line, and now and then a glint running along it
        float e = .5 - max(abs(f.x), abs(f.y));
        float glint = pow(max(0.0, sin(lp.x * 1.7 + lp.y * .6 - t * .9 + shade * 6.2831)), 24.0);
        col += vec3(1.0, .3, .1) * smoothstep(.035, .0, e) * (.12 + 1.4 * glint);
        // far in, the faces are too small to see: they give way to the glow at the heart, which swells on the beat
        float far = smoothstep(.05, .012, r);
        col = mix(col, vec3(.5, .06, .02) * beat, far * .7);
        col += vec3(1.0, .35, .1) * exp(-r * 16.0) * .45 * beat;
        return col;
      }
      void main() {
        float t = time, beat = 1.0 + .45 * pulse;
        vec2 p = (vUv - .5) * vec2(res.x / res.y, 1.0);
        vec2 n; float vein;
        vec3 col = well(p, t, beat, n, vein);
        col *= 1.0 - .55 * smoothstep(.45, 1.05, length(p));                                // darker to the rim, as deep glass is
        // the stone close (the frame under it), seen through its own faces as the visions come up
        col = mix(col, col * .6 + texture2D(tDiffuse, vUv + n * .03).rgb, under * .6);
        // the church, coming through the faces: each face shows it from its own angle, the angles closing to nothing,
        // the visions going out of it, until it is the church in the stone
        float cm = smoothstep(0.0, 1.0, churchMix);
        vec3 ch = texture2D(plain, churchUv(vUv + n * .12 * (1.0 - cm))).rgb;
        vec3 seen = mix(col, ch * (.85 + .6 * vein * (1.0 - cm)) + col * .4 * (1.0 - cm), smoothstep(.0, .6, churchMix));
        seen = mix(seen, texture2D(church, churchUv(vUv)).rgb, smoothstep(.55, 1.0, churchMix));
        gl_FragColor = vec4(mix(texture2D(tDiffuse, vUv).rgb, seen, amt), 1.0);
      }`,
  });
  trip.enabled = false; composer.addPass(trip);
  let tripTime = 0;
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
  // the church: two images or canvases, shown at their own colours: the church in the stone, where the visions end, and
  // the church plain, which comes through the faces before it
  const asTex = el => { const t = new THREE.Texture(el); t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; renderer.initTexture(t); return t; };
  const setChurch = (el, plainEl) => {
    const u = trip.uniforms; for (const k of ['church', 'plain']) if (u[k].value) u[k].value.dispose();
    u.church.value = asTex(el); u.plain.value = plainEl ? asTex(plainEl) : u.church.value;
    u.csize.value.set(el.naturalWidth || el.width, el.naturalHeight || el.height);
  };
  // the move in: straight along the line from the painting's camera to the stone, its turn never changing; the view's
  // window slides to bring the stone to the middle. It ends with the stone larger than the screen
  const dive = { d0: 0, at: null, ndc: null };

  let shadowsOnce = false;
  let frameW = VIEW.width, dist = 30, fovBase = VIEW.fov, framedP = null;
  const resize = () => {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    renderer.setSize(W, H, false); composer.setSize(W, H); depthCopyRT.setSize(Math.round(W * renderer.getPixelRatio()), Math.round(H * renderer.getPixelRatio())); boxRT.setSize(Math.round(W * renderer.getPixelRatio()), Math.round(H * renderer.getPixelRatio())); boxUvRT.setSize(Math.round(W * renderer.getPixelRatio()), Math.round(H * renderer.getPixelRatio()));
    const pr = renderer.getPixelRatio(); focus.uniforms.resolution.value.set(W, H); bloom.resolution.set(W * pr / 2, H * pr / 2);
    camera.aspect = W / H;
    // the same width of room on any screen; a tall screen sees more floor
    camera.fov = fovBase = 2 * Math.atan(Math.tan(VIEW.fov * Math.PI / 360) * Math.max(1, 1.4 / camera.aspect)) * 180 / Math.PI;
    frameW = VIEW.width; dist = frameW / 2 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
  };
  resize(); addEventListener('resize', resize);

  const look = { x: 0, y: 0 }, view = { x: 0, y: 0 }, focusAt = new THREE.Vector2(.5, .5);
  let time = 0, pointerActive = false, heldFocus = null;
  const v3 = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const toScreen = p => { v3.copy(p).project(camera); return { x: (v3.x * .5 + .5) * W, y: (-v3.y * .5 + .5) * H }; };

  const render = dt => {
    time += dt;
    // the pointer shifts the view a little, as on the moor: the camera itself moves, so near things move more than far
    const idleX = Math.sin(time * .17) * .55, idleY = Math.sin(time * .11 + 1.3) * .35, ease = 1 - Math.exp(-dt * 4);
    view.x += ((pointerActive ? look.x : idleX) - view.x) * ease; view.y += ((pointerActive ? look.y : idleY) - view.y) * ease;
    churchShift.x = -view.x * CHURCH_SHIFT * W; churchShift.y = -view.y * CHURCH_SHIFT * H;
    // the church over all: once it has the screen, the room is no longer drawn
    if (st.trip >= 1 && tripTime > 4 && trip.uniforms.church.value) {
      tripUniforms(dt); trip.uniforms.tDiffuse.value = black;
      renderer.setRenderTarget(null); trip.fsQuad.render(renderer); return;
    }
    const base = VIEW.target.clone().addScaledVector(VIEW.dir, dist);
    right.crossVectors(VIEW.dir, THREE.Object3D.DEFAULT_UP).normalize().negate(); up.crossVectors(right, VIEW.dir.clone().negate()).normalize();
    const sx = -view.x * .011 * frameW, sy = view.y * .007 * frameW;
    camera.position.copy(base).addScaledVector(right, sx).addScaledVector(up, sy);
    camera.up.set(0, 1, 0); camera.lookAt(VIEW.target.clone().addScaledVector(right, sx * .35).addScaledVector(up, sy * .35));
    camera.fov = fovBase; camera.near = dist * .6; camera.far = dist * 1.6; camera.clearViewOffset(); if (box) box.visible = true;
    // resting on the painting: its own camera, framed to its solid part (the firing holds this framing)
    const ka = keys.a && keys.a.tex ? keys.a : null;
    if (ka) {
      camera.position.copy(ka.cam.position); camera.quaternion.copy(ka.cam.quaternion); camera.near = ka.cj.near; camera.far = ka.cj.far;
      framedP = frameKey(ka, view.x, -view.y);
      if (st.dive > 0 && stone) {
        // the move in to the stone: the same lens and turn, the camera carried along its line to the stone, at a steady
        // rate of growth (the distance falls by the same share each moment); the window slides to put the stone mid-screen
        if (!dive.at) {
          // aimed at the middle of the stone itself (its group's origin is at its foot)
          const bb = new THREE.Box3().setFromObject(stone); dive.at = bb.getCenter(new THREE.Vector3()); dive.h = Math.max(.02, bb.max.y - bb.min.y);
          dive.d0 = ka.cam.position.distanceTo(dive.at);
          dive.ndc = dive.at.clone().applyMatrix4(ka.cam.matrixWorldInverse).applyMatrix4(ka.cam.projectionMatrix);
        }
        const w = ka.win, k = st.dive, tanH = Math.tan(ka.cj.fov * Math.PI / 360) * w.hy;
        // it ends with the stone half as tall again as the screen: inside its faces
        const dEnd = dive.h * .34 / tanH, d = dive.d0 * Math.pow(dEnd / dive.d0, k);
        const dir = dive.at.clone().sub(ka.cam.position).normalize();
        camera.position.copy(dive.at).addScaledVector(dir, -d);
        camera.near = Math.min(ka.cj.near, d * .25); camera.far = d + 30;
        const c = THREE.MathUtils.smoothstep(k, 0, .55);
        framedP = frameKey(ka, view.x, -view.y, { cx: w.cx + (dive.ndc.x - w.cx) * c, cy: w.cy + (dive.ndc.y - w.cy) * c, hx: w.hx, hy: w.hy, mx: w.mx, my: w.my });
        // the painting's lens has its own near and far baked in; this close they are the camera's
        const e = framedP.elements, n = camera.near, f = camera.far; e[10] = -(f + n) / (f - n); e[14] = -2 * f * n / (f - n);
      }
    }
    camera.updateProjectionMatrix();
    if (framedP) { camera.projectionMatrix.copy(framedP); camera.projectionMatrixInverse.copy(framedP).invert(); }
    framedP = null;
    camera.updateMatrixWorld();
    focus.uniforms.near.value = camera.near; focus.uniforms.far.value = camera.far;
    // the focus racks to where the pointer rests, or to the box when it is left alone; on the move in, to the stone
    const boxQ = stone ? toScreen(stone.position) : { x: W / 2, y: H / 2 };
    const onStone = st.dive > 0 && !heldFocus;
    const fx = onStone ? boxQ.x / W : heldFocus ? heldFocus.x : pointerActive ? (look.x + 1) * .5 : boxQ.x / W, fy = onStone ? 1 - boxQ.y / H : heldFocus ? heldFocus.y : pointerActive ? (1 - look.y) * .5 : 1 - boxQ.y / H;
    focusAt.x += (fx - focusAt.x) * (1 - Math.exp(-dt * 8)); focusAt.y += (fy - focusAt.y) * (1 - Math.exp(-dt * 8));
    focus.uniforms.focusUv.value.copy(focusAt); focus.uniforms.amount.value = capture.sharp ? 0 : 1;
    // close on the stone the miniature's band of focus opens out: the stone sharp top to bottom, only depth softens
    focus.uniforms.band.value = proj.uniforms.band.value = 1 - THREE.MathUtils.smoothstep(st.dive, .45, .85);

    // the box opens; the stone wakes, lifts to hang above it and turns; the room comes up red
    const o = st.open, glowK = o * (.78 + .32 * st.pulse + .04 * Math.sin(time * 1.3)) + st.flash * .9;
    st.flash *= Math.exp(-dt * 9); st.pulse *= Math.exp(-dt * 2.6);
    for (const h of hinges) h.o.quaternion.copy(h.base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), o * OPEN_ANGLE));
    if (stone) {
      const k = THREE.MathUtils.smoothstep(st.lift, 0, 1);
      stone.position.lerpVectors(stoneFrom, stoneHang, k); stone.position.y += k * .008 * Math.sin(time * 1.1) * (1 - st.dive);
      stone.rotation.y += dt * .45 * k * (1 - .6 * st.dive);
      stoneLight.position.copy(stone.position);
      if (nodes.laser_exit) {
        const a = nodes.laser_exit.getWorldPosition(new THREE.Vector3()), b = stone.position, d = b.clone().sub(a), len = d.length();
        beam.position.copy(a).addScaledVector(d, .5); beam.scale.set(1, len, 1); beam.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, d.normalize());
        beamMat.opacity = .55 * st.beam;
        photonSprites.forEach((sp, i) => { sp.position.copy(a).lerp(b, [.28, .55, .8][i]); sp.scale.setScalar(.06); sp.material.opacity = st.beam; });
      }
      // the halo sits just behind the stone, as seen from the camera; close in, it gives way to the stone's own faces
      halo.position.copy(stone.position).addScaledVector(camera.position.clone().sub(stone.position).normalize(), -.12);
      halo.scale.setScalar(.36 * (1 + .25 * st.pulse + .35 * st.flash));
      halo.material.opacity = THREE.MathUtils.smoothstep(st.lift, 0, 1) * (.75 + .25 * st.pulse + .4 * st.flash) * (1 - THREE.MathUtils.smoothstep(st.dive, 0, .25));
    }
    if (gemMat) gemMat.emissiveIntensity = Math.min(1.2 + 4.5 * st.lift + st.flash * 3, glowK * 6) * .55;
    veinU.vTime.value = time; veinU.vPulse.value = st.pulse;
    // close in, its light would burn the crown of panels round it white
    stoneLight.intensity = glowK * (14 + 8 * st.lift) * (.85 + .3 * st.pulse) * (1 - .8 * THREE.MathUtils.smoothstep(st.dive, 0, .45));
    // the desk lamp, until it is switched off; then only the moon
    lampSpot.intensity = 14 * (1 - st.lamp); lampGlow.intensity = .25 * (1 - st.lamp);
    if (bulbMat) bulbMat.emissiveIntensity = 3 * (1 - st.lamp);
    moon.intensity = 1.0 + .4 * st.lamp; fill.intensity = .12 * (1 - .35 * st.lamp);
    canvas.style.opacity = st.fade;
    focus.uniforms.tDepth.value = composer.readBuffer.depthTexture;
    // resting on the paintings, nothing shows the live shadows (the paintings carry their own): they are drawn once and
    // kept, and redrawn only on the move in, where the live stone's own light moves across what it is near
    renderer.shadowMap.autoUpdate = !proj.enabled;
    if (proj.enabled && !shadowsOnce) { renderer.shadowMap.needsUpdate = true; shadowsOnce = true; }
    if (proj.enabled) {
      depthCopy.uniforms.tDepth.value = composer.readBuffer.depthTexture; proj.uniforms.tDepth.value = depthCopyRT.texture; proj.uniforms.invProj.value.copy(camera.projectionMatrixInverse); proj.uniforms.camWorld.value.copy(camera.matrixWorld);
      for (const k of ['near', 'far', 'amount']) proj.uniforms[k].value = focus.uniforms[k].value; proj.uniforms.focusUv.value.copy(focus.uniforms.focusUv.value); proj.uniforms.resolution.value.copy(focus.uniforms.resolution.value);
      // which painting each beat rests on: lamp-lit, then the lamp off and the box open (through the firing and the move in)
      const want = [['a', 1 - st.lamp], ['open', st.lamp]].filter(([k, w]) => w > 0 && keys[k] && keys[k].tex).sort((x, y) => y[1] - x[1]);
      setSlot('A', want[0] && keys[want[0][0]], want[0] ? want[0][1] : 0); setSlot('B', want[1] && keys[want[1][0]], want[1] ? want[1][1] : 0);
      // close in, the paintings (made for the far view) would show their pixels and the seams of their depth: the room
      // behind the stone becomes the live room, soft out of focus
      const far = 1 - THREE.MathUtils.smoothstep(st.dive, .02, .22); proj.uniforms.wA.value *= far; proj.uniforms.wB.value *= far;
      const la = want[0] && keys[want[0][0]].liveBox ? 1 : 0, lb = want[1] && keys[want[1][0]].liveBox ? 1 : 0;
      // close in, the box is its own model, not the painting's pixels stretched over it
      const own = 1 - THREE.MathUtils.smoothstep(st.dive, 0, .1);
      proj.uniforms.lbA.value = la * own; proj.uniforms.lbB.value = lb * own;
      if (la) { proj.uniforms.pAb.value = keys[want[0][0]].texBox; boxUvMat.uniforms.selA.value = SEL[want[0][0]]; }
      if (lb) { proj.uniforms.pBb.value = keys[want[1][0]].texBox; boxUvMat.uniforms.selB.value = SEL[want[1][0]]; }
      if ((la || lb) && box && !capture.depth) { drawBoxMask(); proj.uniforms.tBox.value = boxRT.texture; proj.uniforms.tBoxUv.value = boxUvRT.texture; }
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
    } else {
      trip.enabled = st.trip > 0 && !!trip.uniforms.church.value;
      // its shader is made on the first frame of the room, not on the beat it first shows
      if (!tripWarm && proj.enabled && trip.uniforms.church.value) { tripWarm = true; trip.enabled = true; }
      if (trip.enabled) tripUniforms(dt);
      composer.render(dt);
    }
  };
  let tripWarm = false;
  const tripUniforms = dt => {
    if (st.trip > 0) tripTime += dt;
    const u = trip.uniforms, pr = renderer.getPixelRatio();
    u.time.value = tripTime; u.amt.value = st.trip; u.churchMix.value = st.church; u.pulse.value = st.pulse;
    // the room under the visions fades over their first seconds; after that it is no longer drawn
    u.under.value = Math.max(0, 1 - tripTime / 4);
    // in the frame's own pixels (the composer's targets are at the device's pixel ratio)
    const f = churchFrame(W, H, u.csize.value.x, u.csize.value.y);
    u.res.value.set(W * pr, H * pr); u.shiftPx.value.set(churchShift.x * pr, churchShift.y * pr); u.sc.value = f.sc * pr; u.cmid.value.set(f.cx, f.cy);
  };
  // where the church sits, in CSS pixels from the middle of the screen: the page sets it with the pointer, as on the moor
  const churchShift = { x: 0, y: 0 };

  // the page's helpers
  const stoneScreen = () => stone ? toScreen(v3.copy(stone.position)) : { x: W / 2, y: H / 2 };
  const screen = () => glowAt ? toScreen(glowAt.getWorldPosition(new THREE.Vector3())) : stoneScreen();
  const nodeScreen = name => nodes[name] ? toScreen(nodes[name].getWorldPosition(new THREE.Vector3())) : null;
  const stonePx = () => { if (!stone) return 22; const a = toScreen(stone.position), b = toScreen(stone.position.clone().add(new THREE.Vector3(0, .1, 0))); return Math.abs(a.y - b.y) * .75; };
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
    for (const k of ['church', 'plain']) if (trip.uniforms[k].value) trip.uniforms[k].value.dispose(); black.dispose(); trip.dispose();
    haloTex.dispose(); halo.material.dispose(); beam.geometry.dispose(); beamMat.dispose(); photonSprites.forEach(sp => sp.material.dispose()); if (scene.environment) scene.environment.dispose();
    rt.dispose(); depthCopyRT.dispose(); boxRT.dispose(); boxUvRT.dispose(); boxMaskMat.dispose(); stoneMaskMat.dispose(); boxUvMat.dispose(); composer.dispose(); renderer.dispose(); renderer.forceContextLoss();
  };
  // for the projection test: frames with no blur, and the depth seen from the same camera
  const capture = { sharp: false, depth: null, noStone: false };
  // both sides, as the room's own materials are: where the cut opens a wall or the floor, the live view sees their insides
  const depthMat = new THREE.ShaderMaterial({ uniforms: { zNear: { value: 1 }, zFar: { value: 30 } }, clipping: true, side: THREE.DoubleSide,
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
  return { proj, composer, loadProjection, capture, cameraJSON, st, render, ready, screen, stoneScreen, stonePx, nodeScreen, setChurch, churchShift, view, setPointer, holdFocus, setMachine, setLights, dispose, renderer,
    is3d: true, get box() { return box; }, camera, scene, boxRT, setOpenAngle: a => { OPEN_ANGLE = a; if (Object.values(keys).some(k => k.liveBox)) bakeBoxUv(); } };
}
