// The bay before the lamp goes down: a survey boat at rest on black water at night, seen from above at an angle, its
// A-frame holding the lamp (the point) on its cable just over the water. The pointer turns the view; the dive lowers
// the lamp through the surface and the camera follows it down until there is nothing but the lamp in the dark, then the
// silt floor and the box come up into its light.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const SEABED = -44;          // the deepest channel, in metres
const HANG = 2.3;            // the cable's length while the lamp waits over the water
const LAMP_COLOR = new THREE.Color(1.0, 0.78, 0.54);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// The GPU surface and floating objects use the same four travelling swells.
const SWELL = [
  { dir: [0.82, 0.57], length: 28, amp: .25, steep: .32 },
  { dir: [-.50, 0.866], length: 17, amp: .13, steep: .25 },
  { dir: [0.20, -.98], length: 45, amp: .12, steep: .28 },
  { dir: [.94, -.34], length: 10, amp: .065, steep: .18 },
].map(w => { const k = 2 * Math.PI / w.length; return { ...w, k, speed: Math.sqrt(9.81 * k) }; });
const waveHeight = (x, z, time) => SWELL.reduce((h, w) => h + w.amp * Math.sin(w.k * (w.dir[0] * x + w.dir[1] * z) - w.speed * time), 0);

// a normal map that tiles, from a sum of waves with whole-number frequencies across the tile
function waterNormals(n = 256) {
  const h = new Float32Array(n * n), waves = [];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 48; i++) {
    const f = 1 + Math.floor(rnd() * (i < 12 ? 4 : 14)), a = rnd() * Math.PI * 2;
    waves.push({ kx: Math.round(Math.cos(a) * f), ky: Math.round(Math.sin(a) * f), amp: 1 / Math.pow(f, 1.25), ph: rnd() * Math.PI * 2 });
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let s = 0; for (const w of waves) s += w.amp * Math.sin((w.kx * x + w.ky * y) / n * Math.PI * 2 + w.ph);
    h[y * n + x] = s;
  }
  const data = new Uint8Array(n * n * 4), k = 0.9;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = h[y * n + (x + 1) % n] - h[y * n + (x + n - 1) % n], dy = h[((y + 1) % n) * n + x] - h[((y + n - 1) % n) * n + x];
    const v = new THREE.Vector3(-dx * k, -dy * k, 1).normalize(), i = (y * n + x) * 4;
    data[i] = (v.x * .5 + .5) * 255; data[i + 1] = (v.y * .5 + .5) * 255; data[i + 2] = (v.z * .5 + .5) * 255; data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, n); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

// the water: a mirror of the scene above it, broken up by small waves, with the moon's path and each lamp's glitter on
// it; seen from below, a dark ceiling with the lamp's light on it
function makeWater(renderer, scene, sky, res) {
  const rt = new THREE.WebGLRenderTarget(Math.round(res * 16 / 9), res, { type: THREE.HalfFloatType });
  const textureMatrix = new THREE.Matrix4(), mirrorCam = new THREE.PerspectiveCamera();
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    mirrorSampler: { value: null }, normalSampler: { value: waterNormals() }, time: { value: 0 }, textureMatrix: { value: textureMatrix },
    eye: { value: new THREE.Vector3() }, waterColor: { value: new THREE.Color(0x010305) },
    moonDir: { value: new THREE.Vector3() }, moonColor: { value: new THREE.Color(0.88, 0.91, 0.96) }, moonDive: { value: 0 },
    lampPos: { value: new THREE.Vector3() }, lampPow: { value: 1 }, screenSize: { value: new THREE.Vector2(1, 1) },
    cabinScreen: { value: new THREE.Vector2() }, lampScreen: { value: new THREE.Vector2() },
    swell: { value: SWELL.map(w => new THREE.Vector4(w.dir[0], w.dir[1], w.k, w.amp)) },
    swellMotion: { value: SWELL.map(w => new THREE.Vector2(w.speed, w.steep)) },
  }]);
  uniforms.mirrorSampler.value = rt.texture;
  uniforms.textureMatrix.value = textureMatrix;
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      uniform mat4 textureMatrix; uniform float time;
      uniform vec4 swell[4]; uniform vec2 swellMotion[4];
      varying vec4 mirrorCoord; varying vec3 wp, swellNormal;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vec2 baseXZ = w.xz;
        vec3 tx = vec3(1.0, 0.0, 0.0), tz = vec3(0.0, 0.0, 1.0);
        for (int i = 0; i < 4; i++) {
          vec4 s = swell[i]; vec2 m = swellMotion[i];
          float phase = s.z * dot(s.xy, baseXZ) - m.x * time;
          float sn = sin(phase), cs = cos(phase), slope = s.w * s.z;
          w.xz += s.xy * (m.y * s.w * cs);
          w.y += s.w * sn;
          tx += vec3(-m.y * slope * s.x * s.x * sn, slope * s.x * cs, -m.y * slope * s.x * s.y * sn);
          tz += vec3(-m.y * slope * s.x * s.y * sn, slope * s.y * cs, -m.y * slope * s.y * s.y * sn);
        }
        swellNormal = normalize(cross(tz, tx));
        wp = w.xyz; mirrorCoord = textureMatrix * w;
        vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D mirrorSampler, normalSampler; uniform float time, lampPow, moonDive; uniform vec2 screenSize, cabinScreen, lampScreen; uniform vec3 eye, waterColor, moonDir, moonColor, lampPos;
      uniform vec4 swell[4]; uniform vec2 swellMotion[4];
      varying vec4 mirrorCoord; varying vec3 wp, swellNormal;
      #include <common>
      #include <fog_pars_fragment>
      vec3 waveNormal(vec2 p) {
        vec2 a = p / 41.0 + vec2(time / 83.0, time / 131.0), b = p / 19.0 - vec2(time / -71.0, time / 97.0);
        vec2 c = p / 7.3 + vec2(time / 37.0, -time / 43.0), d = p / 3.1 - vec2(time / 19.0, time / 23.0);
        vec3 n = texture2D(normalSampler, a).xyz * 0.9 + texture2D(normalSampler, b).xyz * 0.8
               + texture2D(normalSampler, c).xyz * 0.55 + texture2D(normalSampler, d).xyz * 0.35;
        n = n / 2.6 * 2.0 - 1.0;
        return normalize(vec3(n.x, n.z * 6.0, n.y));
      }
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec3 fine = waveNormal(wp.xz);
        vec3 n = normalize(swellNormal + vec3(fine.x * .42, 0.0, fine.z * .42));
        vec3 toEye = eye - wp; float dist = length(toEye); vec3 v = toEye / dist;
        vec3 lampGlow = vec3(1.0, 0.93, 0.8) * lampPow;
        if (eye.y >= 0.0) {
          // Broad moving swells carry fine, broken crests across the whole bay.
          float ripple = vnoise(wp.xz * vec2(0.9, 2.6) + vec2(0.0, time * 0.8)) - 0.5;
          vec2 uv = mirrorCoord.xy / mirrorCoord.w;
          float cross = vnoise(wp.xz * vec2(4.0, 1.5) + vec2(time * 0.3, 0.0)) - 0.5;
          vec2 distort = vec2(n.x * 0.3, n.z * 1.4 + ripple * 0.5) * (0.001 + 1.0 / dist) * 4.0;
          distort.x += cross * 0.012;
          vec3 refl = texture2D(mirrorSampler, uv + distort).rgb;
          vec2 screenUv = gl_FragCoord.xy / screenSize;
          float longPhase = swell[0].z * dot(swell[0].xy, wp.xz) - swellMotion[0].x * time;
          float longCrest = pow(max(sin(longPhase), 0.0), 5.0);
          float wavelets = pow(max(dot(v, reflect(-moonDir, n)), 0.0), 35.0);
          float crestNoise = smoothstep(.34, .68, vnoise(wp.xz * vec2(2.7, 6.1) + vec2(time * .16, -time * .24)));
          vec3 col = waterColor + vec3(.006, .007, .008) * longCrest
                   + vec3(.006, .0075, .009) * wavelets * crestNoise;
          // The cabin and cable lamp each carry a long, fading column through the moving swell.
          vec3 bright = max(refl - vec3(.07), 0.0) * .22;
          bright += max(texture2D(mirrorSampler, uv + distort + vec2(0.0, .025)).rgb - vec3(.10), 0.0) * .24;
          bright += max(texture2D(mirrorSampler, uv + distort + vec2(0.0, .06)).rgb - vec3(.13), 0.0) * .16;
          bright += max(texture2D(mirrorSampler, uv + distort + vec2(0.0, .11)).rgb - vec3(.17), 0.0) * .08;
          bright += max(texture2D(mirrorSampler, uv + distort + vec2(0.0, .17)).rgb - vec3(.14), 0.0) * .10;
          bright += max(texture2D(mirrorSampler, uv + distort + vec2(0.0, .24)).rgb - vec3(.14), 0.0) * .10;
          bright += max(texture2D(mirrorSampler, uv + distort + vec2(0.0, .32)).rgb - vec3(.14), 0.0) * .08;
          bright += max(texture2D(mirrorSampler, uv + distort + vec2(0.0, .40)).rgb - vec3(.14), 0.0) * .05;
          float warmth = dot(bright, vec3(.48, .42, .10));
          warmth /= 1.0 + warmth * 3.0;
          float reflectionReach = min(1.0, screenSize.x / screenSize.y * .55);
          float tallScreen = 1.0 - reflectionReach;
          float broken = smoothstep(.44, .70, vnoise(wp.xz * vec2(5.7, 9.5) + vec2(0.0, time * .5)));
          float cabinLane = exp(-pow((screenUv.x - cabinScreen.x - .06) / .024, 2.0));
          float lampLane = exp(-pow((screenUv.x - lampScreen.x) / .020, 2.0));
          float cabinFall = pow(smoothstep(cabinScreen.y - .37 * reflectionReach, cabinScreen.y - .04 * reflectionReach, screenUv.y), .72)
                          * (1.0 - smoothstep(cabinScreen.y - .02, cabinScreen.y + .03, screenUv.y));
          float lampFall = pow(smoothstep(lampScreen.y - .34 * reflectionReach, lampScreen.y - .04 * reflectionReach, screenUv.y), .72)
                         * (1.0 - smoothstep(lampScreen.y - .02, lampScreen.y + .03, screenUv.y));
          float columns = max(cabinLane * cabinFall, lampLane * lampFall);
          vec2 dashAt = screenUv * vec2(140.0, 280.0) + vec2(fine.x * 1.3 + ripple, time * .5);
          float dashes = smoothstep(.48, .76, vnoise(dashAt)) * columns;
          col += vec3(1.0, .60, .30) * (warmth * columns * 3.8 * (.06 + .94 * broken) * (1.0 - .45 * tallScreen) + dashes * .24);
          // Moonlight breaks into irregular soft flecks along moving crests.
          float upper = smoothstep(.16, .52, screenUv.y);
          float width = mix(.025, .070, smoothstep(.30, 1.0, screenUv.y));
          float centre = mix(.50, .54, smoothstep(.30, 1.0, screenUv.y));
          float lane = exp(-pow((screenUv.x - centre) / width, 2.0));
          vec2 fp = mat2(.8, -.6, .6, .8) * wp.xz * vec2(6.0, 3.8);
          float facets = vnoise(fp + vec2(time * .9, -time * .6))
                       * vnoise(fp * 2.3 - vec2(time * 1.3, time * .4));
          float spec = pow(max(dot(v, reflect(-moonDir, fine)), 0.0), 780.0);
          vec3 moonNear = normalize(vec3(moonDir.x, moonDir.y + .08, moonDir.z));
          spec += pow(max(dot(v, reflect(-moonNear, fine)), 0.0), 780.0) * .38;
          vec3 moonWideA = normalize(vec3(moonDir.x - .14, moonDir.y + .18, moonDir.z));
          vec3 moonWideB = normalize(vec3(moonDir.x + .12, moonDir.y - .18, moonDir.z));
          spec += pow(max(dot(v, reflect(-moonWideA, fine)), 0.0), 780.0) * .34;
          spec += pow(max(dot(v, reflect(-moonWideB, fine)), 0.0), 780.0) * .34;
          vec3 moonHigh = normalize(vec3(moonDir.x - .18, moonDir.y + .44, moonDir.z));
          vec3 moonLow = normalize(vec3(moonDir.x + .15, moonDir.y - .30, moonDir.z));
          spec += pow(max(dot(v, reflect(-moonHigh, fine)), 0.0), 780.0) * .30;
          spec += pow(max(dot(v, reflect(-moonLow, fine)), 0.0), 780.0) * .30;
          float topThin = smoothstep(.68, .95, screenUv.y);
          float moonCrest = mix(longCrest, .35, tallScreen);
          float fleck = spec * smoothstep(.23 + .27 * topThin + .22 * moonDive,
                                         .48 + .27 * topThin + .18 * moonDive, facets) * (.30 + .70 * moonCrest);
          float crestGlint = .3 + .7 * smoothstep(-.15, .27, wp.y);
          float topLight = .35 + 4.0 * smoothstep(.58, .80, screenUv.y)
                         - 1.0 * smoothstep(.90, 1.0, screenUv.y);
          col += moonColor * lane * upper * fleck * crestGlint * topLight * .35 * (1.0 - .55 * moonDive);
          float farFlecks = smoothstep(.18, .70, screenUv.y)
                           * smoothstep(.34 + .12 * topThin + .16 * moonDive,
                                        .58 + .12 * topThin + .15 * moonDive, facets) * (.25 + .75 * moonCrest);
          col += moonColor * lane * farFlecks * 1.2 * (1.0 - .55 * moonDive);
          float submergedLamp = 1.0 - step(-0.1, lampPos.y);
          float shallowLamp = submergedLamp * exp(-max(-lampPos.y, 0.0) * .16);
          float underTransmission = shallowLamp * exp(-dot(wp.xz - lampPos.xz, wp.xz - lampPos.xz) / 1.2);
          col += vec3(0.12, 0.07, 0.03) * underTransmission;
          gl_FragColor = vec4(col, 1.0 - underTransmission * 0.9);
        } else {
          // from below: the window to the sky straight up, the rest a dark mirror; the lamp's light on the underside
          vec3 nd = vec3(-n.x, n.y, -n.z);
          float up = dot(-v, nd);
          float win = smoothstep(0.62, 0.72, up);
          vec3 col = waterColor * 0.18 + vec3(0.07, 0.10, 0.12) * win;
          float hd = length(wp.xz - lampPos.xz), below = max(-lampPos.y, 0.0);
          col += lampGlow * 0.5 * exp(-hd * hd / (6.0 + below * 4.0)) / (1.0 + below * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(512, 512, 256, 256), mat);
  water.rotation.x = -Math.PI / 2;
  const camPos = new THREE.Vector3(), look = new THREE.Vector3(), tgt = new THREE.Vector3(), rot = new THREE.Matrix4();
  water.onBeforeRender = (r, s, camera) => {
    camPos.setFromMatrixPosition(camera.matrixWorld); uniforms.eye.value.copy(camPos);
    if (camPos.y <= 0) return;
    const view = camPos.clone(); view.y = -view.y;
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos); tgt.copy(look); tgt.y = -tgt.y;
    mirrorCam.position.copy(view); mirrorCam.up.set(0, 1, 0).applyMatrix4(rot);
    mirrorCam.lookAt(tgt); mirrorCam.far = camera.far; mirrorCam.updateMatrixWorld();
    mirrorCam.projectionMatrix.copy(camera.projectionMatrix);
    textureMatrix.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
    textureMatrix.multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);
    const cur = r.getRenderTarget(); water.visible = false;
    const hidden = s.children.filter(o => o === sky || o.isPoints || o.position.y < -40);
    hidden.forEach(o => { o.userData.mirrorWasVisible = o.visible; o.visible = false; });
    r.setRenderTarget(rt); r.state.buffers.depth.setMask(true); r.clear(); r.render(s, mirrorCam);
    hidden.forEach(o => { o.visible = o.userData.mirrorWasVisible; });
    water.visible = true; r.setRenderTarget(cur);
  };
  return { water, uniforms, target: rt };
}

// the sky the water mirrors: black overhead, a little haze low down, the moon behind the scene and its halo in thin cloud
function makeSky(moonDir) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { moonDir: { value: moonDir } },
    vertexShader: `varying vec3 d; void main() { d = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 moonDir; varying vec3 d;
      float hash(vec3 p) { p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        float h = max(d.y, 0.0);
        vec3 col = mix(vec3(0.030, 0.040, 0.055), vec3(0.004, 0.006, 0.010), pow(h, 0.45));
        float m = max(dot(d, moonDir), 0.0);
        col += vec3(0.55, 0.62, 0.75) * pow(m, 2400.0) * 1.5;     // the disc
        col += vec3(0.20, 0.24, 0.32) * pow(m, 60.0) * 0.12;        // its halo in the haze
        col += vec3(0.05, 0.06, 0.08) * pow(m, 8.0) * 0.08;
        vec3 sp = floor(d * 420.0); float st = step(0.9965, hash(sp)) * smoothstep(0.05, 0.4, h);
        col += vec3(0.6, 0.65, 0.8) * st * 0.35;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), mat);
}

// a stand-in boat, used until (or if) the modelled one does not load: hull, wheelhouse, A-frame and its sheave
function standInBoat() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: .6 }), dark = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: .7 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xc8641e, roughness: .5, metalness: .3 });
  const shape = new THREE.Shape(); shape.moveTo(-2.1, 6.6); shape.lineTo(2.1, 6.6); shape.lineTo(2.2, -2); shape.quadraticCurveTo(1.8, -6, 0, -7.6); shape.quadraticCurveTo(-1.8, -6, -2.2, -2); shape.closePath();
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: false }), white);
  hull.rotation.x = Math.PI / 2; hull.position.y = 1.4; g.add(hull);
  const house = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 4.4), white); house.position.set(0, 2.5, -2.2); g.add(house);
  const win = new THREE.Mesh(new THREE.BoxGeometry(3.42, .6, 4.42), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb060, emissiveIntensity: 2 }));
  win.name = 'window_lit'; win.position.set(0, 3.0, -2.2); g.add(win);
  for (const x of [-1.8, 1.8]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.09, .12, 4.6), orange); leg.position.set(x, 3.4, 6.9); leg.rotation.x = .35; g.add(leg); }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, 3.8), orange); beam.rotation.z = Math.PI / 2; beam.position.set(0, 5.55, 7.7); g.add(beam);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, 1.2, 20), dark); drum.rotation.z = Math.PI / 2; drum.position.set(0, 1.9, 4.2); g.add(drum);
  const sheave = new THREE.Object3D(); sheave.name = 'sheave'; sheave.position.set(0, 5.35, 7.95); g.add(sheave);
  return g;
}

export function createBay(canvas) {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !mobile; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const fogAbove = new THREE.Color(0x05080b), fogBelow = new THREE.Color(0x0a2629), black = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(fogAbove.clone(), .0035);
  scene.background = fogAbove.clone();
  const camera = new THREE.PerspectiveCamera(16, 1, .1, 9000);

  // moonlight from behind the scene, so its path on the water runs toward us
  const moonDir = new THREE.Vector3(-0.62, 0.42, -0.66).normalize();
  const sky = makeSky(moonDir); scene.add(sky);
  const moon = new THREE.DirectionalLight(0x9fb2d6, .35); moon.position.copy(moonDir).multiplyScalar(100); scene.add(moon);
  const skyFill = new THREE.HemisphereLight(0x34485f, 0x07121a, 1.15); scene.add(skyFill);
  const fill = new THREE.DirectionalLight(0x74869d, .1); fill.position.set(50, 40, 30); scene.add(fill);

  const { water, uniforms: wu, target: waterTarget } = makeWater(renderer, scene, sky, mobile ? 384 : 768);
  wu.moonDir.value.copy(moonDir); scene.add(water);

  // the lamp: a warm globe on the cable, and its light
  const lamp = new THREE.Group();
  const cage = new THREE.MeshStandardMaterial({ color: 0x303739, roughness: .62, metalness: .75 });
  const topCap = new THREE.Mesh(new THREE.CylinderGeometry(.09, .10, .06, 20), cage); topCap.position.y = .20; lamp.add(topCap);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(.18, 32, 24), new THREE.ShaderMaterial({
    uniforms: { core: { value: new THREE.Color().setRGB(1.6, .75, .18) }, rim: { value: new THREE.Color().setRGB(1.2, .32, .03) } },
    vertexShader: `varying vec3 n, v; void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); n = normalize(normalMatrix * normal); v = normalize(-p.xyz); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `uniform vec3 core, rim; varying vec3 n, v; void main() {
      float face = max(dot(normalize(n), normalize(v)), 0.0);
      float centre = face * face;
      vec3 col = mix(rim, core, centre) * (1.0 + .12 * centre * centre);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  })); lamp.add(globe);
  const lampLight = new THREE.PointLight(LAMP_COLOR, 30, 0, 2); lamp.add(lampLight);
  const spot = new THREE.SpotLight(LAMP_COLOR, 0, 0, .75, 1.0, 1.6); spot.position.y = -.25; lamp.add(spot); lamp.add(spot.target); spot.target.position.set(0, -10, 0);
  lamp.scale.setScalar(1.7);
  scene.add(lamp);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1, 6), new THREE.MeshStandardMaterial({ color: 0x9b8e7a, roughness: .55, metalness: .25 }));
  scene.add(cable);

  // under the water: the lamp's cone and the snow drifting through it
  const coneMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { amt: { value: 0 } },
    vertexShader: `varying float vY; varying vec3 vN, vV; void main() { vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float amt; varying float vY; varying vec3 vN, vV;
      void main() { float edge = pow(abs(dot(vN, vV)), 1.6); float a = pow(vY, 2.2) * edge * amt * 0.22; gl_FragColor = vec4(vec3(0.75, 0.85, 0.8) * a, a); }`,
  });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(.08, 5.5, 16, 40, 1, true), coneMat);
  cone.geometry.translate(0, -8, 0); scene.add(cone);

  const SNOW = mobile ? 1400 : 3200, sp = new Float32Array(SNOW * 3), ss = new Float32Array(SNOW);
  for (let i = 0; i < SNOW; i++) { sp[i * 3] = (Math.random() - .5) * 26; sp[i * 3 + 1] = SEABED + Math.random() * (-SEABED); sp[i * 3 + 2] = (Math.random() - .5) * 26; ss[i] = Math.random(); }
  const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3)); snowGeo.setAttribute('seed', new THREE.BufferAttribute(ss, 1));
  const snowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { lampPos: { value: new THREE.Vector3() }, time: { value: 0 }, amt: { value: 0 }, px: { value: 1 } },
    vertexShader: `uniform vec3 lampPos; uniform float time, px; attribute float seed; varying float lit;
      void main() {
        vec3 p = position; p.y = mod(p.y + time * (0.05 + seed * 0.08) - ${SEABED.toFixed(1)}, ${(-SEABED).toFixed(1)}) + ${SEABED.toFixed(1)};
        p.x += sin(time * 0.2 + seed * 40.0) * 0.4; p.z += cos(time * 0.17 + seed * 30.0) * 0.4;
        vec3 d = p - lampPos; float below = clamp(-d.y / 12.0, 0.0, 1.0);
        float r = length(d.xz) / (0.6 + below * 5.0);
        lit = exp(-dot(d, d) * 0.06) + exp(-r * r * 1.2) * smoothstep(-16.0, -0.5, d.y) * (1.0 - step(0.5, d.y)) * 0.7;
        lit *= step(p.y, -0.2);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = min(px * (0.5 + seed * 1.1) * 6.0 / -mv.z, 5.0);
      }`,
    fragmentShader: `uniform float amt; varying float lit;
      void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(c)) * lit * amt; gl_FragColor = vec4(vec3(0.82, 0.9, 0.86) * a, a); }`,
  });
  const snow = new THREE.Points(snowGeo, snowMat); snow.frustumCulled = false; scene.add(snow);

  // the floor of the channel: silt in long soft ripples, dark until the lamp reaches it
  const floorGeo = new THREE.PlaneGeometry(80, 80, 160, 160); floorGeo.rotateX(-Math.PI / 2);
  const floorY = (x, z) => Math.sin(x * .9 + Math.sin(z * .3) * 1.4) * .06 + Math.sin(x * .21 + z * .13) * .35 + Math.sin(z * .37) * .2;
  { const p = floorGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, floorY(p.getX(i), p.getZ(i))); floorGeo.computeVertexNormals(); }
  // silt: soft noise in a few octaves that tiles, its colour and its small relief
  const [siltTex, siltNrm] = (() => {
    const n = 256, h = new Float32Array(n * n);
    const lat = (o, f) => { const a = new Float32Array(f * f); for (let i = 0; i < a.length; i++) a[i] = Math.random(); return a; };
    for (const [f, amp] of [[4, .5], [8, .25], [16, .14], [32, .08], [64, .05]]) {
      const L = lat(0, f);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const fx = x / n * f, fy = y / n * f, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), g = (i, j) => L[((iy + j) % f) * f + (ix + i) % f];
        h[y * n + x] += amp * ((g(0, 0) * (1 - sx) + g(1, 0) * sx) * (1 - sy) + (g(0, 1) * (1 - sx) + g(1, 1) * sx) * sy);
      }
    }
    const mk = fn => { const c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d'), im = x.createImageData(n, n);
      for (let i = 0; i < n * n; i++) fn(i, im.data); x.putImageData(im, 0, 0);
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); return t; };
    const col = mk((i, d) => { const v = h[i]; const k = 70 + v * 90 + Math.random() * 10; d[i * 4] = k; d[i * 4 + 1] = k * .96; d[i * 4 + 2] = k * .8; d[i * 4 + 3] = 255; });
    col.colorSpace = THREE.SRGBColorSpace;
    const nrm = mk((i, d) => { const x = i % n, y = (i / n) | 0, dx = h[y * n + (x + 1) % n] - h[y * n + (x + n - 1) % n], dy = h[((y + 1) % n) * n + x] - h[((y + n - 1) % n) * n + x];
      const v = new THREE.Vector3(-dx * 6, -dy * 6, 1).normalize(); d[i * 4] = (v.x * .5 + .5) * 255; d[i * 4 + 1] = (v.y * .5 + .5) * 255; d[i * 4 + 2] = (v.z * .5 + .5) * 255; d[i * 4 + 3] = 255; });
    return [col, nrm];
  })();
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: 0x8a826a, map: siltTex, normalMap: siltNrm, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 1 }));
  floor.position.y = SEABED; floor.receiveShadow = true; scene.add(floor);
  const props = new THREE.Group(); props.position.y = SEABED; scene.add(props);

  // the boat; its lights; it rides the swell, and the lamp hangs from its sheave
  const boat = new THREE.Group(); scene.add(boat);
  let hull = standInBoat(); boat.add(hull);
  let sheave = hull.getObjectByName('sheave');
  const lit = new THREE.Group(); boat.add(lit);
  const flood = new THREE.SpotLight(0xffdfad, 12, 22, .7, .55, 1.6); flood.position.set(-1.6, 5.8, 6.8); flood.target.position.set(0, 0, 9);
  flood.castShadow = !mobile; flood.shadow.mapSize.set(1024, 1024); flood.shadow.bias = -.0004; lit.add(flood, flood.target);
  const deck = new THREE.PointLight(0xffc98a, 12, 9, 2); deck.position.set(0, 3.6, 2.4); lit.add(deck);
  const cabin = new THREE.PointLight(0xffce9a, 18, 12, 2); cabin.position.set(-3.0, 4.2, -2.2); lit.add(cabin);
  const sideSpill = new THREE.PointLight(0xc7c6c0, 3, 18, 2); sideSpill.position.set(3.5, 1.6, 0); lit.add(sideSpill);
  const fitBoat = () => {
    // set the boat so its sheave hangs over the lamp's resting place, the origin
    boat.position.set(0, 0, 0); boat.rotation.set(0, 0, 0); boat.scale.setScalar(1); boat.updateMatrixWorld(true);
    const s = sheave.getWorldPosition(new THREE.Vector3());
    boat.userData.base = new THREE.Vector3(-s.x, 0, -s.z);
  };
  boat.rotation.y = 0; fitBoat();
  const heading = 1.95;                 // the bow away up the screen to the left
  boat.rotation.order = 'YXZ';
  const headingSin = Math.sin(heading), headingCos = Math.cos(heading);
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const glow = (m, c, k) => { m.emissive = new THREE.Color(c); m.emissiveIntensity = k; };
  const dress = root => {
    root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const n = (o.material.name || '') + ' ' + o.name;
      if (/nav_red/.test(n)) glow(o.material, 0xff4d28, 1.6);
      else if (/nav_green/.test(n)) glow(o.material, 0x1aff5a, 8);
      else if (/mast_white|buoy_light|flood_lamp/.test(n)) glow(o.material, 0xffdfaf, 1.35);
      if (o.material.name === 'warm worklamp') glow(o.material, 0xffc985, 1.5);
      if (o.material.name === 'window_lit') glow(o.material, 0xffd9a3, 2.2);
      if (/survey hull/.test(o.material.name)) glow(o.material, 0x18324a, .32);
      if (o.material.name === 'non slip aft deck') o.material = new THREE.MeshStandardMaterial({ color: 0x171b1e, roughness: .65 });
    });
  };
  const ready = Promise.allSettled([
    loader.loadAsync('models/web/boat.glb').then(gl => {
      const s = gl.scene.getObjectByName('sheave'); if (!s) return;
      boat.remove(hull); hull = gl.scene; dress(hull); boat.add(hull); sheave = s; fitBoat();
      // the work light comes from the model's own flood lamp, aimed down past the stern at the water under the lamp
      const fl = hull.getObjectByName('flood_lamp'); hull.updateMatrixWorld(true);
      if (fl) { const p = boat.worldToLocal(fl.getWorldPosition(new THREE.Vector3())); flood.position.copy(p).add(new THREE.Vector3(0, .25, -.3)); const t = boat.worldToLocal(s.getWorldPosition(new THREE.Vector3())); flood.target.position.set(t.x, 0, t.z + 1.5); }
    }),
    loader.loadAsync('models/web/buoy.glb').then(gl => { const b = gl.scene; dress(b); b.position.set(-34, 0, 22); b.userData.bob = 1; scene.add(b); buoy = b; }),
    loader.loadAsync('models/web/box.glb').then(gl => { box = gl.scene; dress(box); box.position.set(.35, SEABED + floorY(.35, .45) - .1, .45); box.rotation.set(.08, .7, -.05); box.scale.setScalar(1.6); box.visible = false; scene.add(box); }),
    loader.loadAsync('models/web/seabed.glb').then(gl => {
      dress(gl.scene); gl.scene.traverse(o => { if (o.isMesh) o.material.color.multiplyScalar(.5); });   // 44 m down, the rust has no colour left to speak of
      gl.scene.position.set(-3.2, 0, 1.2); gl.scene.rotation.y = 2.2; props.add(gl.scene); props.updateMatrixWorld(true);
      // each prop settles into the silt where it lies
      for (const o of [...gl.scene.children]) { const w = o.getWorldPosition(new THREE.Vector3()); o.position.y += floorY(w.x, w.z) - .04; }
    }),
  ]);
  let buoy = null, box = null;
  const buoyLight = new THREE.PointLight(0xff3020, 0, 14, 2); buoyLight.position.set(-34, 3.4, 22); scene.add(buoyLight);

  // ---- post: bloom on the lights, a little grain and a vignette ----
  const colorTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  });
  const composer = new EffectComposer(renderer, colorTarget);
  composer.renderTarget2.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  composer.addPass(new RenderPass(scene, camera));
  const focus = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, tDepth: { value: null },
      focusUv: { value: new THREE.Vector2(.5, .4) }, resolution: { value: new THREE.Vector2(1, 1) },
      nearClip: { value: camera.near }, farClip: { value: camera.far }, amount: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse, tDepth; uniform vec2 focusUv, resolution;
      uniform float nearClip, farClip, amount; varying vec2 vUv;
      float linearDepth(float z) { return nearClip * farClip / (farClip - z * (farClip - nearClip)); }
      void main() {
        vec3 sharp = texture2D(tDiffuse, vUv).rgb;
        float here = linearDepth(texture2D(tDepth, vUv).r);
        float pointed = linearDepth(texture2D(tDepth, focusUv).r);
        float byDepth = smoothstep(.13, .95, abs(log2(max(here, 1.0) / max(pointed, 1.0))));
        float byHeight = smoothstep(.07, .34, abs(vUv.y - focusUv.y));
        float blur = amount * max(byDepth * .9, byHeight * .85);
        vec2 px = vec2(1.0) / resolution * blur * 6.0;
        float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
        vec3 soft = vec3(0.0);
        for (int i = 0; i < 24; i++) {
          float a = float(i) * 2.39996323 + turn;
          float r = sqrt((float(i) + .5) / 24.0);
          soft += texture2D(tDiffuse, vUv + px * r * vec2(cos(a), sin(a))).rgb;
        }
        soft /= 24.0;
        gl_FragColor = vec4(mix(sharp, soft, blur), 1.0);
      }`,
  });
  const renderFocus = focus.render.bind(focus);
  focus.render = (r, write, read, dt, mask) => {
    focus.uniforms.tDepth.value = read.depthTexture;
    renderFocus(r, write, read, dt, mask);
  };
  composer.addPass(focus);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .22, .25, .91); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grain = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 }, dark: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time, dark; varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
      void main() { vec3 c = texture2D(tDiffuse, vUv).rgb; vec2 q = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(q * vec2(1.1, 1.0)));
        c *= mix(0.55, 1.0, v); c += (h(vUv * 1000.0) - 0.5) * 0.028 * (1.0 - dark * 0.6); gl_FragColor = vec4(max(c, 0.0), 1.0); }`,
  });
  composer.addPass(grain);

  // ---- view: a narrow lens from above at an angle; the pointer turns it, the dive brings it down after the lamp ----
  const look = { x: 0, y: 0, sx: 0, sy: 0 };
  const focusAt = new THREE.Vector2(.5, .4);
  let pointerActive = false;
  addEventListener('pointermove', e => { if (e.pointerType === 'mouse') pointerActive = true; });
  document.addEventListener('mouseleave', () => { pointerActive = false; });
  const st = { dive: 0, floor: 0, fade: 0 };
  const tgt = new THREE.Vector3(0, HANG, 0), lampPos = new THREE.Vector3(), viewAim = new THREE.Vector3(), parallax = new THREE.Vector3();
  const cableEnd = new THREE.Vector3(), cableAxis = new THREE.Vector3(), boatCenter = new THREE.Vector3(), reflectionAnchor = new THREE.Vector3();
  let W = 1, H = 1, time = 0;
  const resize = () => {
    const dpr = Math.min(mobile ? 1.5 : 2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight; renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
    wu.screenSize.value.set(W * dpr, H * dpr);
    focus.uniforms.resolution.value.set(W * dpr, H * dpr);
    composer.setPixelRatio(dpr); composer.setSize(W, H); bloom.resolution.set(W / 2, H / 2);
    waterTarget.setSize(Math.round((mobile ? 384 : 768) * W / H), mobile ? 384 : 768);
    camera.aspect = W / H; camera.updateProjectionMatrix(); snowMat.uniforms.px.value = H * dpr / 18;
  };
  resize(); addEventListener('resize', resize);

  const render = dt => {
    time += dt;
    const d = st.dive, fl = st.floor;
    // The hull samples the same surface at bow, stern, port and starboard.
    const boatScale = mix(1.14, 1, smooth(.55, .70, d));
    boat.scale.setScalar(boatScale);
    const lightBoost = boatScale * boatScale;
    flood.intensity = 12 * lightBoost;
    deck.intensity = 12 * lightBoost;
    cabin.intensity = 18 * lightBoost;
    sideSpill.intensity = 3 * lightBoost;
    const base = boat.userData.base;
    boatCenter.copy(base).multiplyScalar(boatScale).applyAxisAngle(THREE.Object3D.DEFAULT_UP, heading);
    const hullWave = (x, z) => waveHeight(boatCenter.x + headingCos * x + headingSin * z,
      boatCenter.z - headingSin * x + headingCos * z, time);
    const bow = hullWave(0, -5.5), stern = hullWave(0, 5.5);
    const port = hullWave(-1.8, 0), starboard = hullWave(1.8, 0);
    boat.position.set(boatCenter.x, (bow + stern + port + starboard) * .25, boatCenter.z);
    boat.rotation.set(-Math.atan2(stern - bow, 11), heading, Math.atan2(starboard - port, 3.6));
    boat.updateMatrixWorld(true);
    const top = sheave.getWorldPosition(new THREE.Vector3());
    // the cable pays out
    const e = d < .5 ? 4 * d * d * d : 1 - Math.pow(-2 * d + 2, 3) / 2;
    const ly = mix(mix(top.y - HANG, SEABED + 9, e), SEABED + 2.2, smooth(0, 1, fl));
    const sway = 1 - smooth(0, .65, d) * .6;
    const swingLength = Math.min(5, Math.max(0, top.y - ly)) * .25;
    lampPos.set(top.x + (Math.sin(time * .9) * .06 + boat.rotation.z * swingLength) * sway,
      ly, top.z + (Math.cos(time * .7) * .05 + boat.rotation.x * swingLength) * sway);
    lamp.position.copy(lampPos);
    lamp.scale.setScalar(1.7);
    cableEnd.set(lampPos.x, lampPos.y + .3, lampPos.z);
    cableAxis.copy(top).sub(cableEnd);
    cable.position.copy(top).add(cableEnd).multiplyScalar(.5);
    cable.scale.y = cableAxis.length();
    cable.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, cableAxis.normalize());
    cone.position.copy(lampPos);
    // how far under: the water closes over, the light dies away, then comes back when the floor is near
    const under = smooth(.4, -1.2, lampPos.y);
    const deep = smooth(-4, -30, lampPos.y) * (1 - smooth(0, .55, fl));   // nothing left but the lamp
    const camUnder = camera.position.y < 0 ? 1 : 0;
    lampLight.intensity = mix(20, 6, under) * (1 - deep * .75);
    lampLight.distance = 0;
    spot.intensity = under * mix(160, 60, deep) * (1 - smooth(.2, 1, fl) * .9);
    coneMat.uniforms.amt.value = under * (1 - deep * .55);
    snowMat.uniforms.amt.value = under * camUnder * (1 - deep * .4);
    snowMat.uniforms.lampPos.value.copy(lampPos); snowMat.uniforms.time.value = time;
    wu.lampPos.value.copy(lampPos); wu.lampPow.value = 1 - deep; wu.time.value = time; wu.moonDive.value = smooth(0, .045, d);
    if (buoy) {
      const x = buoy.position.x, z = buoy.position.z;
      buoy.position.y = waveHeight(x, z, time);
      buoy.rotation.order = 'YXZ';
      buoy.rotation.x = -Math.atan2(waveHeight(x, z + 1, time) - waveHeight(x, z - 1, time), 2);
      buoy.rotation.z = Math.atan2(waveHeight(x + 1, z, time) - waveHeight(x - 1, z, time), 2);
      buoyLight.position.y = buoy.position.y + 3.4;
    }
    buoyLight.intensity = (time % 4 < .5 ? 12 : 0) * (1 - camUnder);
    if (buoy) buoy.traverse(o => { if (o.isMesh && /buoy_light/.test(o.name + (o.material.name || ''))) o.material.emissiveIntensity = time % 4 < .5 ? 10 : .2; });
    if (box) box.visible = fl > .05;

    // the camera
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const idleX = still ? 0 : Math.sin(time * .17) * .35;
    const idleY = still ? 0 : Math.sin(time * .11 + 1.3) * .25;
    const wantedX = pointerActive ? look.x : idleX, wantedY = pointerActive ? look.y : idleY;
    const pointerEase = 1 - Math.exp(-dt * 4);
    look.sx += (wantedX - look.sx) * pointerEase;
    look.sy += (wantedY - look.sy) * pointerEase;
    const wantedFocusX = pointerActive ? (look.x + 1) * .5 : .5 + Math.sin(time * .07) * .18;
    const wantedFocusY = pointerActive ? (1 - look.y) * .5 : .4 + Math.sin(time * .05 + 2) * .12;
    focusAt.x += (wantedFocusX - focusAt.x) * pointerEase * .7;
    focusAt.y += (wantedFocusY - focusAt.y) * pointerEase * .7;
    focus.uniforms.focusUv.value.copy(focusAt);
    const surface = 1 - smooth(0, .18, d);
    focus.uniforms.amount.value = surface * (pointerActive ? 1 : .30);
    const free = 1 - smooth(0, .3, d) * .7;
    const yaw = Math.PI / 4 + look.sx * .5 * free * (1 - surface) + d * .9;
    const pitch = mix(.54, .3, smooth(.3, .6, d)) + mix(0, .55, smooth(.2, 1, fl)) - look.sy * .12 * free * (1 - surface);
    const dist = mix(92, 26, smooth(0, .55, d)) * mix(1, .3, smooth(0, 1, fl));
    // a tall screen keeps the same width of view as a wide one
    const fv = mix(16, 34, smooth(0, .55, d)) * Math.PI / 180;
    camera.fov = 2 * Math.atan(Math.tan(fv / 2) * Math.max(1, 1.2 / camera.aspect)) * 180 / Math.PI; camera.updateProjectionMatrix();
    const aim = box && fl > 0 ? lampPos.clone().lerp(box.position, .55 * smooth(0, 1, fl)) : lampPos;
    if (surface > .999) tgt.copy(lampPos);
    else tgt.lerp(aim, Math.min(1, dt * (d > 0 ? 6 : 2)));
    camera.position.set(tgt.x + Math.cos(pitch) * Math.sin(yaw) * dist, tgt.y + Math.sin(pitch) * dist, tgt.z + Math.cos(pitch) * Math.cos(yaw) * dist);
    parallax.set(surface * Math.cos(Math.PI / 4) * look.sx * .18,
      surface * look.sy * .10,
      -surface * Math.sin(Math.PI / 4) * look.sx * .18);
    camera.position.add(parallax);
    water.position.set(camera.position.x, 0, camera.position.z);
    // the camera follows the lamp down, but stays above the water until the lamp is well under, then drops through it
    viewAim.copy(tgt).add(parallax);
    camera.lookAt(viewAim);
    camera.updateMatrixWorld();
    cabin.getWorldPosition(reflectionAnchor);
    reflectionAnchor.project(camera);
    wu.cabinScreen.value.set(reflectionAnchor.x * .5 + .5, reflectionAnchor.y * .5 + .5);
    reflectionAnchor.copy(lampPos).project(camera);
    wu.lampScreen.value.set(reflectionAnchor.x * .5 + .5, reflectionAnchor.y * .5 + .5);
    const cu = camera.position.y < 0;
    const fogCol = cu ? fogBelow.clone().lerp(black, smooth(-2, -22, camera.position.y)) : fogAbove;
    scene.fog.color.copy(fogCol); scene.background.copy(fogCol);
    scene.fog.density = cu ? mix(mix(.022, .085, smooth(-2, -26, camera.position.y)), .035, smooth(0, 1, fl)) : .0035;
    sky.visible = !cu;
    // the boat's lights go out of sight from deep down
    lit.visible = true;
    grain.uniforms.time.value = time % 10; grain.uniforms.dark.value = deep;
    canvas.style.opacity = st.fade;
    composer.render(dt);
  };
  // the lamp on screen, in CSS pixels, for the point and its ping
  const screen = () => { const p = lampPos.clone().project(camera); return { x: (p.x * .5 + .5) * W, y: (-p.y * .5 + .5) * H }; };
  return { st, look, render, screen, ready, renderer, scene, camera, get box() { return box; } };
}
