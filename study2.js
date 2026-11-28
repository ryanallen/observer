// Blake's study, remade from scratch: console 17's clay room (models/web/study2/study.glb) with ONE painting laid on it from
// the camera it was painted over (wide_camera), so the room is solid 3D under one picture. The church in the stone becomes
// the church in the glass of the field glasses' left eyepiece; then one continuous move straight out, the camera's turn
// never changing, from the eyepiece (close_camera) all the way to the whole room as a tilt-shift diorama (wide_camera).
// Close to the glasses they are their own 3D model in a deep macro blur that hides the painting's magnification; out at
// the diorama the pointer is the lens, as on the moor: a small shift and the focus racked to where it rests.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BASE = 'models/web/study2/';
const GLASS_R = .0126;          // the eyepiece's glass, its radius in metres (measured on the close render)
const SHIFT_ROOM = .045;        // the pointer's shift, as a share of the view kept free round it (about 2% of the frame)
// the church as the page holds it (lab3d.js churchFrame): covering the screen a little larger than it, held at the top
const CHURCH_ZOOM = 1.05, CHURCH_SHIFT = .02;

export function createStudy(canvas) {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2));
  let W = 1, H = 1;
  const scene = new THREE.Scene(); renderer.setClearColor(0x000000, 0);   // clear alpha 0: nothing there counts as the room, not the glasses
  const camera = new THREE.PerspectiveCamera(21.2, 16 / 9, .01, 60); camera.matrixAutoUpdate = false;
  // out: the move out of the eyepiece to the diorama, 0 to 1
  const st = { out: 0 };

  // the painting, laid on the room from its camera; where that camera did not see a surface, the clay, dim
  const wideVP = new THREE.Matrix4(), wideDepthRT = new THREE.WebGLRenderTarget(2048, 1152);
  wideDepthRT.depthTexture = new THREE.DepthTexture(2048, 1152); wideDepthRT.depthTexture.type = THREE.UnsignedIntType;
  const paintU = { paint: { value: null }, wideDepth: { value: wideDepthRT.depthTexture }, wideVP: { value: wideVP } };
  const roomMat = new THREE.ShaderMaterial({ uniforms: paintU,
    vertexShader: `varying vec3 vW, vN; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D paint, wideDepth; uniform mat4 wideVP; varying vec3 vW, vN;
      void main() {
        vec4 c = wideVP * vec4(vW, 1.0); vec3 n = c.xyz / c.w; vec2 uv = n.xy * .5 + .5; float z = n.z * .5 + .5;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0) * step(0.0, c.w);
        float seen = inside * step(z, texture2D(wideDepth, uv).r + .0004);
        vec3 clay = vec3(.07, .055, .045) * (.35 + .65 * max(dot(normalize(vN), normalize(vec3(-.5, .8, .3))), 0.0));
        gl_FragColor = vec4(mix(clay, texture2D(paint, uv).rgb, seen), 0.0);   // alpha 0: the room
      }` });
  // the field glasses up close are their own: dark lacquered brass and leather, catching the window's light along their
  // edges; out in the room they wear the painting like everything else
  const glassesU = { near: { value: 1 } };
  const glassesMat = new THREE.ShaderMaterial({ uniforms: { ...paintU, ...glassesU },
    vertexShader: `varying vec3 vW, vN; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D paint, wideDepth; uniform mat4 wideVP; uniform float near; varying vec3 vW, vN;
      void main() {
        vec4 c = wideVP * vec4(vW, 1.0); vec2 uv = c.xy / c.w * .5 + .5;
        vec3 v = normalize(cameraPosition - vW), nn = normalize(vN); if (dot(nn, v) < 0.0) nn = -nn;
        float lit = max(dot(nn, normalize(vec3(-.75, .45, .5))), 0.0), rim = pow(1.0 - max(dot(nn, v), 0.0), 3.0);
        // black leather over brass: dark, with the window's warm light along the edges facing it
        vec3 own = vec3(.05, .04, .032) * (.6 + .8 * lit) + vec3(.75, .52, .3) * pow(lit, 4.0) * .35 + vec3(.6, .42, .26) * rim * .5;
        gl_FragColor = vec4(mix(texture2D(paint, uv).rgb, own, near), 1.0);   // alpha 1: the glasses
      }` });

  let eye = new THREE.Vector3(), eyeL = new THREE.Vector3(), cams = null, glassesNodes = [];
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const json = u => fetch(u).then(r => r.json());
  const tex = u => new THREE.TextureLoader().loadAsync(u).then(t => { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; });
  // the field glasses' own model (17's, textured: brass, leather, the eyecups, the glass), placed in the room already
  const glassesLoad = loader.loadAsync('models/web/study_glasses.glb').catch(() => null);
  const ready = Promise.all([loader.loadAsync(BASE + 'study.glb'), json(BASE + 'wide_camera.json'), json(BASE + 'close_camera.json'), tex(BASE + 'wide_paint.webp'), glassesLoad]).then(([g, wj, cj, paint, gg]) => {
    paintU.paint.value = paint;
    const room = g.scene; room.updateMatrixWorld(true);
    const fg = room.getObjectByName('field_glasses'), ec = room.getObjectByName('eyepiece_center');
    if (ec) ec.getWorldPosition(eye);
    // the room, all of it that never moves, merged into one draw; the glasses kept apart under their own material
    const inGlasses = o => { for (let p = o; p; p = p.parent) if (p === fg) return true; return false; };
    const list = [], drop = [];
    room.traverse(o => {
      if (!o.isMesh) return;
      if (fg && inGlasses(o)) { o.material = glassesMat; glassesNodes.push(o); return; }
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      const out = new THREE.BufferGeometry();
      for (const n of ['position', 'normal']) { const a = geo.attributes[n]; if (!a) continue; const f = new Float32Array(a.count * 3);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < 3; c++) f[i * 3 + c] = a.getComponent(i, c); out.setAttribute(n, new THREE.BufferAttribute(f, 3)); }
      geo.dispose(); if (!out.attributes.normal) out.computeVertexNormals();
      list.push(out.applyMatrix4(o.matrixWorld)); drop.push(o);
    });
    for (const o of drop) { o.parent.remove(o); o.geometry.dispose(); }
    const merged = mergeGeometries(list, false); list.forEach(x => x.dispose());
    const roomMesh = new THREE.Mesh(merged, roomMat); roomMesh.matrixAutoUpdate = false;
    scene.add(roomMesh);
    if (gg) {
      // the textured glasses in place of the clay ones; up close they are themselves, lit by the window and the room;
      // out in the room they wear the painting like everything else
      const tg = gg.scene; scene.add(tg); tg.updateMatrixWorld(true);
      const e2 = tg.getObjectByName('eyepiece_center'); if (e2) e2.getWorldPosition(eye);
      tg.traverse(o => { if (!o.isMesh) return; const m = o.material;
        m.onBeforeCompile = sh => {
          Object.assign(sh.uniforms, { paint: paintU.paint, wideVP: paintU.wideVP, near: glassesU.near });
          sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
          sh.fragmentShader = 'uniform sampler2D paint; uniform mat4 wideVP; uniform float near; varying vec3 vWp;\n' + sh.fragmentShader.replace('#include <colorspace_fragment>', `
            { vec4 c = wideVP * vec4(vWp, 1.0); vec3 pc = texture2D(paint, c.xy / c.w * .5 + .5).rgb; gl_FragColor.rgb = mix(pow(pc, vec3(2.2)), gl_FragColor.rgb, near); gl_FragColor.a = 1.0; }
            #include <colorspace_fragment>`);
        };
        m.needsUpdate = true; });
      // the window's low warm light from the west, and the room's own glow round them
      const sun = new THREE.DirectionalLight(0xffc89a, 2.4); sun.position.copy(eye).add(new THREE.Vector3(-.92, .26, .3).multiplyScalar(5)); sun.target.position.copy(eye);
      scene.add(sun, sun.target, new THREE.HemisphereLight(0x8a6a50, 0x1a120c, .6));
      scene.environment = roomEnv();
    } else if (fg) scene.add(fg);
    if (gg && fg) fg.parent && fg.parent.remove(fg);
    fg && fg.updateMatrixWorld(true);
    // the two cameras: the same turn, the close one at the eyepiece and the wide one out at the diorama
    const cam = j => ({ pos: new THREE.Vector3().fromArray(j.position), q: new THREE.Quaternion().fromArray(j.quaternion), P: new THREE.Matrix4().fromArray(j.projectionMatrix), j });
    cams = { wide: cam(wj), close: cam(cj) };
    const wv = new THREE.Matrix4().compose(cams.wide.pos, cams.wide.q, new THREE.Vector3(1, 1, 1)).invert();
    wideVP.multiplyMatrices(cams.wide.P, wv);
    // what the painting's camera saw, as depth, once
    const dc = new THREE.PerspectiveCamera(); dc.matrixAutoUpdate = false; dc.matrixWorld.compose(cams.wide.pos, cams.wide.q, new THREE.Vector3(1, 1, 1)); dc.matrixWorldInverse.copy(wv);
    dc.projectionMatrix.copy(cams.wide.P); dc.projectionMatrixInverse.copy(cams.wide.P).invert();
    renderer.setRenderTarget(wideDepthRT); renderer.render(scene, dc); renderer.setRenderTarget(null);
    // where the move starts: close enough that the eyepiece's glass covers the whole screen
    eyeL.copy(eye);
    path.R = cams.wide.pos.distanceTo(eye) / cams.close.pos.distanceTo(eye);
    resize();
  });

  // what the glasses' brass and glass reflect: a dim warm room with the bright windows to the west
  function roomEnv() {
    const es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(5, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide,
      vertexShader: `varying vec3 d; void main() { d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 d; void main() {
        float win = pow(max(dot(d, normalize(vec3(-.92, .26, .3))), 0.0), 8.0);
        gl_FragColor = vec4(vec3(.06, .045, .035) + vec3(.25, .17, .1) * smoothstep(-.2, .6, d.y) + vec3(3.0, 1.9, 1.1) * win, 1.0); }` })));
    const pm = new THREE.PMREMGenerator(renderer), t = pm.fromScene(es, .02).texture; pm.dispose();
    es.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    return t;
  }

  // the frame: the room drawn with its depth, then the lens (the focus and the miniature's band) and the glass, in one pass
  const rt = new THREE.WebGLRenderTarget(1, 1); rt.texture.colorSpace = THREE.SRGBColorSpace; rt.depthTexture = new THREE.DepthTexture(1, 1); rt.depthTexture.type = THREE.UnsignedIntType;
  const lensU = { tColor: { value: rt.texture }, tDepth: { value: rt.depthTexture }, church: { value: null }, res: { value: new THREE.Vector2(1, 1) },
    near: { value: .01 }, far: { value: 60 }, focusZ: { value: 1 }, atRoom: { value: 0 }, macro: { value: 0 }, focusUv: { value: new THREE.Vector2(.5, .5) }, band: { value: 0 }, blurPx: { value: 10 },
    eyePx: { value: new THREE.Vector3(0, 0, 1) }, csize: { value: new THREE.Vector2(1, 1) }, csc: { value: 1 }, cmid: { value: new THREE.Vector2() }, cshift: { value: new THREE.Vector2() }, churchA: { value: 1 } };
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: lensU, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `#include <packing>
      uniform sampler2D tColor, tDepth, church; uniform vec2 res, focusUv, csize, cmid, cshift; uniform vec3 eyePx; uniform float near, far, focusZ, atRoom, macro, band, blurPx, csc, churchA; varying vec2 vUv;
      float viewZ(vec2 p) { return -perspectiveDepthToViewZ(texture2D(tDepth, p).x, near, far); }
      void main() {
        float z = viewZ(vUv), fz = mix(focusZ, viewZ(focusUv), atRoom);
        // out of focus by how far in front of or behind the focus, as a share of it (so up close the room is a deep blur),
        // and on the diorama by the miniature's band across the screen
        float blur = max(smoothstep(.02, .5, abs(z - fz) / fz), smoothstep(.07, .34, abs(vUv.y - focusUv.y)) * band);
        // close to the glasses, everything but the glasses is deep in the blur (the painting is far too magnified there)
        blur = max(blur, macro * (1.0 - texture2D(tColor, vUv).a));
        vec2 px = 1.0 / res * blur * blurPx;
        float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
        vec3 soft = vec3(0.0);
        for (int i = 0; i < 32; i++) { float a = float(i) * 2.39996323 + turn, r = sqrt((float(i) + .5) / 32.0); soft += texture2D(tColor, vUv + px * r * vec2(cos(a), sin(a))).rgb; }
        vec3 col = mix(texture2D(tColor, vUv).rgb, soft / 32.0, min(1.0, blur * 1.5));
        // the eyepiece's glass: the church in it, as the page held it, growing smaller with the glass
        vec2 p = vec2(vUv.x * res.x, (1.0 - vUv.y) * res.y);
        float d = length(p - eyePx.xy), inG = 1.0 - smoothstep(eyePx.z - 1.5, eyePx.z + .5, d);
        if (inG > 0.0 && churchA > 0.0) {
          vec2 ip = (p - eyePx.xy - cshift) / csc + cmid;
          vec2 cu = vec2(ip.x / csize.x, 1.0 - ip.y / csize.y);
          vec3 ch = texture2D(church, clamp(cu, .001, .999)).rgb;
          // past the painting's edge the glass is dark, the church's sky going down into it
          vec2 out2 = max(-cu, cu - 1.0) * csize / max(csize.x, csize.y);
          ch *= 1.0 - smoothstep(-.03, .02, max(out2.x, out2.y));
          float rr = d / max(eyePx.z, 1.0);
          ch *= 1.0 - .35 * smoothstep(.75, 1.0, rr);                       // the glass darkening to its rim
          ch += vec3(.9, .85, .8) * .05 * smoothstep(.5, .0, length((p - eyePx.xy) / eyePx.z - vec2(-.35, -.4)));   // a soft reflection
          col = mix(col, ch, inG * churchA);
        }
        gl_FragColor = vec4(col, 1.0);
      }` }));
  const post = new THREE.Scene(); post.add(lens); const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const path = { R: 146, k0: 0 };
  // the view's window into the painting's lens: the screen's shape inside 16:9, with room kept round it for the shift
  const windowFor = () => {
    const aS = W / H, aP = 16 / 9; let hx, hy;
    if (aS < aP) { hy = 1 / (1 + SHIFT_ROOM); hx = hy * aS / aP; } else { hx = 1 / (1 + SHIFT_ROOM); hy = hx * aP / aS; }
    return { hx, hy };
  };
  let church = null; const churchShift0 = new THREE.Vector2();
  const setChurchFrame = () => {
    const iw = church.image.naturalWidth || church.image.width, ih = church.image.naturalHeight || church.image.height;
    const sc = Math.max(W / iw, H / ih) * CHURCH_ZOOM, hh = (H / 2 + CHURCH_SHIFT * H) / sc;
    lensU.csize.value.set(iw, ih); path.cmid0 = Math.max(hh, Math.min(ih - hh, 0)); lensU.cmid.value.set(iw / 2, path.cmid0);
    path.csc = sc;
  };
  const resize = () => {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    renderer.setSize(W, H, false); const pr = renderer.getPixelRatio();
    rt.setSize(Math.round(W * pr), Math.round(H * pr)); lensU.res.value.set(W * pr, H * pr);
    lensU.blurPx.value = 14 * Math.min(W, H) / 800 * pr;
    if (cams) {
      // the move starts where the glass's circle reaches past the screen's corners
      const win = windowFor(), tanH = Math.tan(cams.close.j.fov * Math.PI / 360) * win.hy;
      const dStart = GLASS_R / (tanH * Math.hypot(1, W / H) * 1.02), d1 = cams.close.pos.distanceTo(eye);
      path.k0 = Math.log(dStart / d1) / Math.log(path.R);   // the same rate of growth as the rest of the move
    }
    if (church) setChurchFrame();
  };
  addEventListener('resize', resize); resize();

  // where the camera is along the move: k from k0 (the glass filling the screen) to 1 (the diorama), the distance to the
  // eyepiece growing by the same share each moment
  const posAt = k => {
    const u = (Math.pow(path.R, k) - 1) / (path.R - 1);
    return cams.close.pos.clone().lerp(cams.wide.pos, u);
  };
  const view = { x: 0, y: 0 }, look = { x: 0, y: 0 }, focusAt = new THREE.Vector2(.5, .5);
  let pointerActive = false, time = 0;
  const v3 = new THREE.Vector3();

  // the church in the stone, as the page holds it, and where the pointer had shifted it (px)
  const setChurch = (el, shift = { x: 0, y: 0 }) => {
    if (church) church.dispose();
    church = new THREE.Texture(el); church.colorSpace = THREE.NoColorSpace; church.minFilter = THREE.LinearFilter; church.generateMipmaps = false; church.needsUpdate = true;
    lensU.church.value = church; churchShift0.set(shift.x, shift.y); setChurchFrame();
  };

  const render = dt => {
    if (!cams) return;
    time += dt;
    const idleX = Math.sin(time * .17) * .55, idleY = Math.sin(time * .11 + 1.3) * .35, ease = 1 - Math.exp(-dt * 4);
    view.x += ((pointerActive ? look.x : idleX) - view.x) * ease; view.y += ((pointerActive ? look.y : idleY) - view.y) * ease;
    const k = path.k0 + (1 - path.k0) * st.out, pos = posAt(k);
    // the lens: the painting's own, its near and far set for where the camera is; the window slides from the eyepiece
    // (mid-screen at the start) to the painting's composition, with the pointer's shift inside it
    const d = pos.distanceTo(eye), n = Math.max(.004, d * .3), f = d + 40;
    const P = cams.close.P.clone(), e = P.elements; e[10] = -(f + n) / (f - n); e[14] = -2 * f * n / (f - n);
    camera.matrixWorld.compose(pos, cams.close.q, new THREE.Vector3(1, 1, 1)); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const eyeN = eye.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(P);
    const win = windowFor(), wj = cams.wide.j, foc = wj.focus || [wj.width / 2, wj.height / 2];
    const lx = 1 - win.hx * (1 + SHIFT_ROOM), ly = 1 - win.hy * (1 + SHIFT_ROOM);
    const cEnd = new THREE.Vector2(Math.max(-lx, Math.min(lx, foc[0] / wj.width * 2 - 1)), Math.max(-ly, Math.min(ly, 1 - foc[1] / wj.height * 2)));
    const s = THREE.MathUtils.smoothstep(st.out, .3, 1);
    const cx = eyeN.x + (cEnd.x - eyeN.x) * s + view.x * win.hx * SHIFT_ROOM * s, cy = eyeN.y + (cEnd.y - eyeN.y) * s - view.y * win.hy * SHIFT_ROOM * s;
    const T = new THREE.Matrix4().set(1 / win.hx, 0, 0, -cx / win.hx, 0, 1 / win.hy, 0, -cy / win.hy, 0, 0, 1, 0, 0, 0, 0, 1);
    camera.projectionMatrix.copy(T.multiply(P)); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.near = n; camera.far = f;
    // the glasses are their own model up close, the painting's once they are small in the room
    glassesU.near.value = 1 - THREE.MathUtils.smoothstep(d, .4, 2.5);
    // the glass on screen: its centre and radius in the frame's pixels
    const pr = renderer.getPixelRatio();
    v3.copy(eye).applyMatrix4(camera.matrixWorldInverse); const zc = -v3.z;
    const q = eye.clone().project(camera), ex = (q.x * .5 + .5) * W, ey = (-q.y * .5 + .5) * H;
    const rPx = GLASS_R / (zc * Math.tan(cams.close.j.fov * Math.PI / 360) * win.hy) * H / 2;
    lensU.eyePx.value.set(ex * pr, ey * pr, rPx * pr);
    if (church) {
      if (path.r0 == null || st.out === 0) path.r0 = rPx;
      const g = rPx / path.r0;
      // the church keeps covering the glass as it shrinks: in the first moments of the move it eases from the page's
      // own framing (so the hand-over is exact) to filling the circle
      const cover = 2 * rPx / Math.min(lensU.csize.value.x, lensU.csize.value.y), sc = path.csc * g;
      const tc = THREE.MathUtils.smoothstep(st.out, 0, .08);
      lensU.csc.value = sc * Math.pow(Math.max(1, cover / sc), tc) * pr;
      lensU.cmid.value.y = path.cmid0 + (lensU.csize.value.y / 2 - path.cmid0) * tc; lensU.cshift.value.set(churchShift0.x * g * pr, churchShift0.y * g * pr);
      // a few pixels across, the glass is the painting's own again
      lensU.churchA.value = THREE.MathUtils.smoothstep(rPx, 3, 12);
    }
    // the focus: on the eyepiece while the view comes out of it; on the diorama, where the pointer rests (or the
    // painting's own subject when it is left alone), with the miniature's band
    const atRoom = THREE.MathUtils.smoothstep(st.out, .75, 1);
    const fx = pointerActive ? (look.x + 1) * .5 : ex / W, fy = pointerActive ? (1 - look.y) * .5 : 1 - ey / H;
    focusAt.x += (fx - focusAt.x) * (1 - Math.exp(-dt * 8)); focusAt.y += (fy - focusAt.y) * (1 - Math.exp(-dt * 8));
    lensU.focusUv.value.set(ex / W + (focusAt.x - ex / W) * atRoom, (1 - ey / H) + (focusAt.y - (1 - ey / H)) * atRoom);
    lensU.band.value = atRoom; lensU.near.value = n; lensU.far.value = f;
    lensU.atRoom.value = atRoom; lensU.focusZ.value = zc; lensU.macro.value = 1 - THREE.MathUtils.smoothstep(d, .25, 1.6);
    // up close the blur is a macro lens's: far wider, so the painting behind the glasses is only colour and light
    lensU.blurPx.value = 14 * Math.min(W, H) / 800 * pr * (1 + 4 * (1 - THREE.MathUtils.smoothstep(d, .08, 1.2)));
    renderer.setRenderTarget(rt); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.render(post, flat);
  };

  const setPointer = (x, y) => { pointerActive = true; look.x = x; look.y = y; };
  const dispose = () => {
    removeEventListener('resize', resize);
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); for (const m of [].concat(o.material || [])) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); } });
    if (scene.environment) scene.environment.dispose();
    roomMat.dispose(); glassesMat.dispose(); lens.geometry.dispose(); lens.material.dispose();
    if (paintU.paint.value) paintU.paint.value.dispose(); if (church) church.dispose();
    wideDepthRT.dispose(); rt.dispose(); renderer.dispose(); renderer.forceContextLoss();
  };
  return { st, ready, render, setPointer, setChurch, dispose, renderer, camera, scene, get eye() { return eye; } };
}
