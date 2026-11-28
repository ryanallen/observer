// Robert Blake's study on College Hill, 1935: a still photograph with real depth, shifted a little by the pointer as on
// the moor (the whole room about 2%, each thing moving with the floor it stands on) and racked into focus where it rests.
import * as THREE from 'three';

const PLATE = { w: 1672, h: 941 };
const SHIFT_BASE = .35, SHIFT_DEPTH = .15;   // all of the room moves with the pointer, near parts a little more

export function createStudy(canvas) {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  let W = 1, H = 1, coverX = 1, coverY = 1;
  const loader = new THREE.TextureLoader();
  const tex = url => loader.loadAsync(url).then(t => { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; });
  const u = {
    plate: { value: null }, depth: { value: null }, shift: { value: null },
    cover: { value: new THREE.Vector2(1, 1) }, sceneCam: { value: new THREE.Vector2() }, focusUv: { value: new THREE.Vector2(.5, .5) },
    resolution: { value: new THREE.Vector2(1, 1) }, amount: { value: 0 },
  };
  const ready = Promise.all([tex('models/web/study_wide.webp'), tex('models/web/study_depth.jpg'), tex('models/web/study_shift.jpg')]).then(([p, d, s]) => {
    p.colorSpace = THREE.SRGBColorSpace; u.plate.value = p; u.depth.value = d; u.shift.value = s;
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: u, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform sampler2D plate, depth, shift; uniform vec2 cover, sceneCam, focusUv, resolution; uniform float amount; varying vec2 vUv;
      // the shift map is flattened, so the desk, chair and glasses move as one with the floor they stand on
      vec3 room(vec2 s) { vec2 p = (s - .5) * cover + .5; float layer = texture2D(shift, p).r;
        return texture2D(plate, p - sceneCam * (${SHIFT_BASE.toFixed(2)} + ${SHIFT_DEPTH.toFixed(2)} * layer)).rgb; }
      void main() {
        vec3 sharp = room(vUv);
        float here = texture2D(depth, (vUv - .5) * cover + .5).r, pointed = texture2D(depth, (focusUv - .5) * cover + .5).r;
        float blur = max(smoothstep(.045, .30, abs(here - pointed)) * .9, smoothstep(.08, .36, abs(vUv.y - focusUv.y)) * .8) * amount;
        vec2 px = vec2(1.0) / resolution * blur * 9.0;
        float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
        vec3 soft = vec3(0.0);
        for (int i = 0; i < 16; i++) { float a = float(i) * 2.39996323 + turn, r = sqrt((float(i) + .5) / 16.0); soft += room(vUv + px * r * vec2(cos(a), sin(a))); }
        gl_FragColor = vec4(mix(sharp, soft / 16.0, blur), 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); scene.add(quad);
  const resize = () => {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    renderer.setSize(W, H, false); u.resolution.value.set(W, H);
    const a = W / H, pa = PLATE.w / PLATE.h;
    coverX = a > pa ? 1 : a / pa; coverY = a > pa ? pa / a : 1; u.cover.value.set(coverX, coverY);
  };
  resize(); addEventListener('resize', resize);

  const look = { x: 0, y: 0 }, view = { x: 0, y: 0 }, focusAt = new THREE.Vector2(.5, .5);
  let time = 0, pointerActive = false, heldFocus = null;
  const render = dt => {
    time += dt;
    const idleX = Math.sin(time * .17) * .55, idleY = Math.sin(time * .11 + 1.3) * .35, ease = 1 - Math.exp(-dt * 4);
    view.x += ((pointerActive ? look.x : idleX) - view.x) * ease; view.y += ((pointerActive ? look.y : idleY) - view.y) * ease;
    u.sceneCam.value.set(view.x * .022, -view.y * .014);
    const fx = heldFocus ? heldFocus.x : pointerActive ? (look.x + 1) * .5 : .5, fy = heldFocus ? heldFocus.y : pointerActive ? (1 - look.y) * .5 : .5;
    focusAt.x += (fx - focusAt.x) * (1 - Math.exp(-dt * 8)); focusAt.y += (fy - focusAt.y) * (1 - Math.exp(-dt * 8));
    u.focusUv.value.copy(focusAt);
    // it comes in sharp, matching the still it takes over from, and the focus settles in over two seconds
    u.amount.value = Math.min(1, time / 2);
    renderer.render(scene, cam);
  };
  const setPointer = (x, y) => { pointerActive = true; look.x = x; look.y = y; };
  // for tests: hold the focus still so frames at different pointer positions differ only by the shift
  const holdFocus = (x, y) => { heldFocus = x == null ? null : { x, y }; };
  const dispose = () => {
    removeEventListener('resize', resize);
    for (const k of ['plate', 'depth', 'shift']) if (u[k].value) u[k].value.dispose();
    quad.geometry.dispose(); quad.material.dispose(); renderer.dispose(); renderer.forceContextLoss();
  };
  return { render, ready, setPointer, holdFocus, dispose, renderer };
}
