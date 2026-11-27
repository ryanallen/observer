// The bay before the lamp goes down: a survey boat at rest on black water at night, seen from above at an angle, its
// A-frame holding the lamp (the point) on its cable just over the water. The point draws the view in; the dive lowers
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

const SEABED = -25;          // the deepest channel, in metres
const BOX_SCALE = 3.5;       // the box is 220 mm across; drawn at the size the floor shot was framed for
const BOX_SINK = .35;        // how far its foot sits under the silt: about a third of it buried
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
    moonDir: { value: new THREE.Vector3() }, moonColor: { value: new THREE.Color(0.88, 0.91, 0.96) }, moonDive: { value: 0 }, sceneZoom: { value: 1 }, sceneCam: { value: new THREE.Vector2() },
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
      uniform mat4 textureMatrix; uniform float time, sceneZoom;
      uniform vec4 swell[4]; uniform vec2 swellMotion[4];
      varying vec4 mirrorCoord; varying vec3 wp, swellNormal;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        float edge = clamp(max(abs(position.x), abs(position.y)) / 256.0, 0.0, 1.0);
        float reach = 1.0 + (1.0 - sceneZoom) * 7.0 * pow(edge, 4.0);
        vec4 w = modelMatrix * vec4(position.xy * reach, position.z, 1.0);
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
      uniform sampler2D mirrorSampler, normalSampler; uniform float time, lampPow, moonDive, sceneZoom; uniform vec2 screenSize, cabinScreen, lampScreen, sceneCam; uniform vec3 eye, waterColor, moonDir, moonColor, lampPos;
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
      float moonSquiggle(vec2 px, float t, out float band) {
        float waveY = px.y + px.x * .10 + 9.0 * sin(px.x * .014 + t * .32)
                    + 2.5 * sin(px.x * .043 - t * .21)
                    + 7.0 * (vnoise(px * vec2(.012, .019) + vec2(t * .03, 0.0)) - .5) + t * 4.0;
        band = smoothstep(-.15, .62, sin(waveY * .131));
        float rowY = (waveY + 2.2 * (vnoise(px * vec2(.027, .024)) - .5)) / 5.8;
        float rowSeed = hash2(vec2(floor(rowY), 17.0));
        vec2 cell = vec2((px.x + 5.0 * sin(waveY * .08) + rowSeed * 31.0
                       + 3.0 * (vnoise(vec2(px.x * .04, floor(rowY) * .19)) - .5))
                       / (19.0 + 13.0 * rowSeed), rowY);
        vec2 id = floor(cell), f = fract(cell);
        float seed = hash2(id), seed2 = hash2(id + vec2(19.0, 7.0));
        float seed3 = hash2(id + vec2(3.0, 31.0));
        float start = .03 + .20 * seed;
        float end = min(.98, start + .35 + .60 * seed2);
        float xMask = smoothstep(start, start + .045, f.x) * (1.0 - smoothstep(end - .05, end, f.x));
        float centre = .5 + .32 * (seed3 - .5) + .12 * sin(f.x * 7.0 + seed * 6.28)
                            + .045 * sin(f.x * 15.0 + seed2 * 6.28);
        float yMask = 1.0 - smoothstep(.035, .13, abs(f.y - centre));
        float shine = .32 + 1.15 * hash2(id + vec2(57.0, 11.0));
        return xMask * yMask * shine * smoothstep(.08, .32, seed3);
      }
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
          float sideFade = exp(-pow((screenUv.x - .52) / .40, 2.0));
          float fineCrest = smoothstep(.45, .70, vnoise(wp.xz * vec2(5.0, 8.0) + vec2(time * .12, -time * .18)));
          float crinkle = sin(wp.x * 2.7 + wp.z * 5.1 - time * 1.2
                          + 2.0 * vnoise(wp.xz * vec2(.8, 1.2) + vec2(time * .08, 0.0)));
          float littleCrests = pow(max(crinkle, 0.0), 10.0)
                             * smoothstep(.25, .68, vnoise(wp.xz * vec2(2.2, 3.7) - vec2(0.0, time * .17)));
          float swellSheen = longCrest * fineCrest * sideFade * smoothstep(.30, .75, screenUv.y);
          float lowerSheen = pow(1.0 - screenUv.y, 1.2) * exp(-pow((screenUv.x - .20) / .65, 2.0));
          vec3 col = waterColor + (vec3(.001, .002, .003) + vec3(.006, .009, .011) * smoothstep(.25, .75, screenUv.y)
                   - vec3(.003, .003, .003) * (1.0 - smoothstep(.30, .60, screenUv.y))) * (1.0 - sceneZoom)
                   + vec3(.006, .007, .008) * fineCrest * (1.0 - sceneZoom)
                   + vec3(.042, .048, .052) * littleCrests * (1.0 - sceneZoom)
                   + vec3(.0060, .0080, .0080) * (1.0 - step(.1, moonDive))
                   + vec3(.006, .007, .008) * longCrest * (1.0 - .65 * lowerSheen)
                   + vec3(.012, .012, .012) * swellSheen
                   + vec3(.0040, .0045, .0050) * lowerSheen
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
          float surfaceReflect = 1.0 - step(.1, moonDive);
          float broken = smoothstep(.53, .79, vnoise(wp.xz * vec2(5.7, 9.5) + vec2(0.0, time * .5)));
          float cabinLane = exp(-pow((screenUv.x - cabinScreen.x - mix(.03, .06, sceneZoom)) / mix(.014, .024, sceneZoom), 2.0));
          float lampLane = exp(-pow((screenUv.x - lampScreen.x) / mix(.012, .020, sceneZoom), 2.0));
          float fallPower = mix(.72, .75, surfaceReflect);
          float cabinFall = pow(smoothstep(cabinScreen.y - mix(.37, mix(.32, .23, sceneZoom), surfaceReflect) * reflectionReach, cabinScreen.y - .04 * reflectionReach, screenUv.y), fallPower)
                          * (1.0 - smoothstep(cabinScreen.y - .02, cabinScreen.y + .03, screenUv.y));
          float lampFall = pow(smoothstep(lampScreen.y - mix(.34, mix(.32, .22, sceneZoom), surfaceReflect) * reflectionReach, lampScreen.y - .04 * reflectionReach, screenUv.y), fallPower)
                         * (1.0 - smoothstep(lampScreen.y - .02, lampScreen.y + .03, screenUv.y));
          float columns = max(cabinLane * cabinFall * mix(1.0, 1.5, surfaceReflect), lampLane * lampFall);
          vec2 dashAt = screenUv * mix(vec2(520.0, 960.0), vec2(260.0, 500.0), sceneZoom) + vec2(fine.x * 1.3 + ripple, time * .5);
          vec2 roundAt = screenUv * mix(vec2(440.0, 780.0), vec2(220.0, 400.0), sceneZoom) + vec2(fine.x * .8 + ripple * .5, time * .35);
          float dashMask = smoothstep(.55, .80, vnoise(dashAt));
          float roundedMask = smoothstep(.46, .72, vnoise(roundAt));
          float dashes = mix(dashMask, roundedMask, surfaceReflect) * columns;
          vec3 warmTint = mix(vec3(1.0, .60, .30), vec3(1.0, .58, .28), surfaceReflect);
          float warmClose = warmth * columns * mix(1.4, 4.8, surfaceReflect) * (.08 + .92 * broken) * (1.0 - .45 * tallScreen)
                          + dashes * mix(.28, .38, surfaceReflect);
          float warmWide = 0.0;
          if (sceneZoom < .98 && columns > .002) {
            float warmBandA = 0.0, warmBandB = 0.0;
            float streakA = moonSquiggle(gl_FragCoord.xy * vec2(.72, 1.0), time, warmBandA);
            float streakB = moonSquiggle(gl_FragCoord.xy * vec2(.83, 1.0) + vec2(17.0, 11.0), time + 2.1, warmBandB);
            warmWide = (streakA * (.25 + .75 * warmBandA) + streakB * (.25 + .75 * warmBandB) * .75) * columns * 1.65;
          }
          col += warmTint * mix(warmWide, warmClose, sceneZoom);
          // Moonlight breaks into irregular soft flecks along moving crests.
          float upper = mix(smoothstep(.10, .45, screenUv.y), smoothstep(.16, .52, screenUv.y), sceneZoom);
          float width = mix(mix(.070, .055, smoothstep(.30, 1.0, screenUv.y)), mix(.025, .070, smoothstep(.30, 1.0, screenUv.y)), sceneZoom);
          float centre = mix(.705 + sceneCam.x * .12, mix(.50, .54, smoothstep(.30, 1.0, screenUv.y)), sceneZoom);
          float lane = exp(-pow((screenUv.x - centre) / width, 2.0));
          vec2 fp = mat2(.8, -.6, .6, .8) * wp.xz * vec2(6.0, 3.8);
          float facets = vnoise(fp + vec2(time * .9, -time * .6))
                       * vnoise(fp * 2.3 - vec2(time * 1.3, time * .4));
          float specMain = pow(max(dot(v, reflect(-moonDir, fine)), 0.0), 780.0);
          float spec = specMain;
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
          if (lane > .005 && screenUv.y > .82) {
            vec2 crestStep = vec2(.707, -.707) * .20;
            vec3 leftNormal = waveNormal(wp.xz - crestStep);
            vec3 rightNormal = waveNormal(wp.xz + crestStep);
            float leftGlint = pow(max(dot(v, reflect(-moonDir, leftNormal)), 0.0), 780.0);
            float rightGlint = pow(max(dot(v, reflect(-moonDir, rightNormal)), 0.0), 780.0);
            spec += .28 * smoothstep(.82, .96, screenUv.y) * (leftGlint + rightGlint - 2.0 * specMain);
          }
          float topThin = smoothstep(.68, .95, screenUv.y);
          float moonCrest = mix(longCrest, .35, tallScreen);
          float fleck = spec * smoothstep(.23 + .10 * topThin + .22 * moonDive,
                                         .48 + .10 * topThin + .18 * moonDive, facets) * (.30 + .70 * moonCrest);
          float swellBand = 0.0;
          if (surfaceReflect > .5 && lane > .005) {
            float squiggle = moonSquiggle(gl_FragCoord.xy, time, swellBand);
            float topAccent = 1.0 + .8 * smoothstep(.75, .96, screenUv.y) * swellBand;
            fleck = squiggle * (.22 + 1.28 * swellBand) * topAccent
                  * (1.1 + .65 * longCrest) + fleck * .35;
          }
          float crestGlint = .3 + .7 * smoothstep(-.15, .27, wp.y);
          float topLight = .35 + 4.0 * smoothstep(.58, .80, screenUv.y)
                         - 1.0 * smoothstep(.90, 1.0, screenUv.y);
          topLight = mix(topLight, .65 + .8 * smoothstep(.45, .95, screenUv.y), moonDive);
          float moonProfile = .58 + 1.02 * smoothstep(.70, .98, screenUv.y);
          float midLift = 1.0 + 1.2 * smoothstep(.40, .60, screenUv.y)
                        * (1.0 - smoothstep(.63, .83, screenUv.y)) * surfaceReflect;
          float moonStop = mix(1.0, smoothstep(lampScreen.y - .02, lampScreen.y + .14, screenUv.y),
                               smoothstep(.20, .60, tallScreen) * (1.0 - moonDive));
          float zoomMoon = mix(1.5 + 1.6 * smoothstep(.45, .90, screenUv.y), 1.0, sceneZoom);
          col += moonColor * lane * upper * fleck * crestGlint * topLight * .35 * moonProfile * midLift * moonStop * zoomMoon * (1.0 - .55 * moonDive);
          if (sceneZoom < .98 && screenUv.y > .76) {
            float horizonBand = 0.0;
            float horizonSpark = moonSquiggle(gl_FragCoord.xy * vec2(.83, 1.0) + vec2(31.0, 7.0), time, horizonBand);
            col += moonColor * lane * horizonSpark * (.18 + .32 * horizonBand)
                 * smoothstep(.76, .87, screenUv.y) * (1.0 - sceneZoom);
            float distantSheen = exp(-pow((screenUv.y - .81 - sceneCam.y * .12) / .065, 2.0));
            col += moonColor * lane * distantSheen * (.025 + .12 * fineCrest)
                 * (1.0 - sceneZoom);
          }
          float farFlecks = smoothstep(.18, .70, screenUv.y)
                           * smoothstep(.34 + .02 * topThin + .16 * moonDive,
                                        .58 + .02 * topThin + .15 * moonDive, facets) * (.25 + .75 * moonCrest);
          farFlecks = mix(farFlecks, farFlecks * (.35 + .25 * swellBand), surfaceReflect);
          col += moonColor * lane * farFlecks * moonProfile * midLift * mix(1.2, .50, moonDive) * moonStop * zoomMoon * (1.0 - .55 * moonDive);
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
        #ifdef USE_FOG
          float fogLane = exp(-pow((gl_FragCoord.x / screenSize.x - .705 - sceneCam.x * .12) / .075, 2.0)) * (1.0 - sceneZoom);
          float waterFog = mix(fogDensity, .0007, fogLane);
          float fogFactor = 1.0 - exp(-waterFog * waterFog * vFogDepth * vFogDepth);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
        #endif
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
    const hidden = s.children.filter(o => o === sky || o.isPoints || o.position.y < -10);
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
        vec3 dir = normalize(d);
        float h = max(dir.y, 0.0);
        vec3 col = mix(vec3(0.012, 0.017, 0.024), vec3(0.004, 0.006, 0.010), pow(h, 0.45));
        float m = max(dot(dir, moonDir), 0.0);
        col += vec3(0.55, 0.62, 0.75) * pow(m, 20000.0) * .9;     // the disc
        col += vec3(0.20, 0.24, 0.32) * pow(m, 60.0) * .025;       // its halo in the haze
        col += vec3(0.05, 0.06, 0.08) * pow(m, 8.0) * 0.08;
        vec3 sp = floor(dir * 420.0); float st = step(0.9965, hash(sp)) * smoothstep(0.05, 0.4, h);
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
  // a small cap and a thin wire cage over the globe, sized with it, so it reads as a lamp housing
  const fitting = new THREE.Group(); lamp.add(fitting);
  const topCap = new THREE.Mesh(new THREE.CylinderGeometry(.035, .055, .035, 20), cage); topCap.position.y = .212; fitting.add(topCap);
  for (let i = 0; i < 4; i++) {
    const wire = new THREE.Mesh(new THREE.TorusGeometry(.209, .0045, 6, 64), cage);   // one meridian, top to bottom
    wire.rotation.y = i * Math.PI / 4; fitting.add(wire);
  }
  const band = new THREE.Mesh(new THREE.TorusGeometry(.209, .006, 6, 64), cage); band.rotation.x = Math.PI / 2; fitting.add(band);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(.205, 32, 24), new THREE.ShaderMaterial({
    uniforms: { core: { value: new THREE.Color().setRGB(2.0, 1.65, 1.15) }, rim: { value: new THREE.Color().setRGB(1.2, .60, .25) } },
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
  // the real silt, loaded with the floor: a colour and a height map, sampled at two sizes and angles
  // blended by a slow noise, so no repeat shows in the lamp's pool
  const siltMats = [floor.material];
  let silt = null;
  const applySilt = m => {
    if (!silt) return;
    m.map = silt.color; m.bumpMap = silt.height; m.bumpScale = 2.2; m.normalMap = null; m.color.set(0xe6dcc4);
    m.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        vec2 siltA = vMapUv, siltB = mat2(.8, -.6, .6, .8) * vMapUv * .61 + vec2(.37, .11);
        float siltK = smoothstep(.25, .75, .5 + .25 * sin(vMapUv.x * .83 + sin(vMapUv.y * .57) * 1.7) + .25 * sin(vMapUv.y * .71 - vMapUv.x * .29));
        diffuseColor *= mix(texture2D(map, siltA), texture2D(map, siltB), siltK);`);
    };
    m.customProgramCacheKey = () => 'silt2';
    m.needsUpdate = true;
  };
  const loadSilt = () => Promise.all(['models/web/silt_color.jpg', 'models/web/silt_height.jpg'].map(u => new THREE.TextureLoader().loadAsync(u))).then(([color, height]) => {
    for (const t of [color, height]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(16, 16); t.anisotropy = 4; }
    color.colorSpace = THREE.SRGBColorSpace;
    for (const t of [floor.material.map, floor.material.normalMap]) if (t) t.dispose();
    silt = { color, height }; siltMats.forEach(applySilt);
  });

  // the boat; its lights; it rides the swell, and the lamp hangs from its sheave
  const boat = new THREE.Group(); scene.add(boat);
  let hull = standInBoat(); boat.add(hull);
  let sheave = hull.getObjectByName('sheave');
  const lit = new THREE.Group(); boat.add(lit);
  const flood = new THREE.SpotLight(0xffdfad, 12, 22, .7, .55, 1.6); flood.position.set(-1.6, 5.8, 6.8); flood.target.position.set(0, 0, 9);
  flood.castShadow = !mobile; flood.shadow.mapSize.set(1024, 1024); flood.shadow.bias = -.0004; lit.add(flood, flood.target);
  const deck = new THREE.PointLight(0xffc98a, 12, 9, 2); deck.position.set(0, 3.6, 2.4); lit.add(deck);
  const cabin = new THREE.PointLight(0xffce9a, 18, 12, 2); cabin.position.set(-3.0, 4.2, -2.2); lit.add(cabin);
  const workPools = [-1.15, 1.15].map(x => {
    const light = new THREE.SpotLight(0xffb874, 30, 5, .72, .8, 2);
    light.position.set(x, 2.2, 6.55);
    light.target.position.set(x, 0, 6.55);
    lit.add(light, light.target); return light;
  });
  const aftPools = [-1.15, 1.15].map(x => {
    const light = new THREE.SpotLight(0xffc58b, 12, 5.5, .68, .85, 2);
    light.position.set(x, 2.8, -.7);
    light.target.position.set(x, 0, -.7);
    lit.add(light, light.target); return light;
  });
  const roofPool = new THREE.PointLight(0xffc992, 2.5, 3.5, 2);
  roofPool.position.set(-.98, 3.4, -.8); lit.add(roofPool);
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
      const workBulbs = [];
      hull.traverse(o => { if (o.isMesh && /^deck_work_lamp/.test(o.name)) workBulbs.push(o); });
      workBulbs.sort((a, b) => a.position.x - b.position.x);
      workBulbs.slice(0, 2).forEach((bulb, i) => {
        const light = workPools[i];
        light.position.copy(boat.worldToLocal(bulb.getWorldPosition(new THREE.Vector3()))).y -= .12;
        light.target.position.copy(light.position).y -= 2.2;
      });
      const aftBulbs = [];
      hull.traverse(o => { if (o.isMesh && /^aft work light/.test(o.name)) aftBulbs.push(o); });
      aftBulbs.sort((a, b) => a.position.x - b.position.x);
      aftBulbs.slice(0, 2).forEach((bulb, i) => {
        const light = aftPools[i];
        light.position.copy(boat.worldToLocal(bulb.getWorldPosition(new THREE.Vector3()))).y -= .12;
        light.target.position.copy(light.position).add(new THREE.Vector3(0, -2.7, 1.2));
      });
      const roofBulb = hull.getObjectByName('roof lamp bright core');
      if (roofBulb) roofPool.position.copy(boat.worldToLocal(roofBulb.getWorldPosition(new THREE.Vector3()))).y -= .1;
    }),
    loader.loadAsync('models/web/buoy.glb').then(gl => { const b = gl.scene; dress(b); b.position.set(-34, 0, 22); b.userData.bob = 1; scene.add(b); buoy = b; }),
  ]);
  // the box, the stone and the seabed are only seen at the bottom of the dive: they load once the dive is chosen
  let floorLoad = null;
  const loadFloor = () => floorLoad || (floorLoad = Promise.allSettled([
    loadSilt(),
    // the box, closed, tilted and half sunk in the silt, with the stone still inside it
    Promise.all([loader.loadAsync('models/web/box_cd.glb'), loader.loadAsync('models/web/stone.glb')]).then(([gb, gs]) => {
      const b = gb.scene; dress(b);
      b.traverse(o => { if (o.isMesh && o.material.name === 'box_lid_filigree') { o.material.side = THREE.DoubleSide; o.material.alphaTest = o.material.alphaTest || .5; o.material.transparent = false; } });
      const seat = b.getObjectByName('gem_seat'), glowAt = b.getObjectByName('gem_glow');
      const g = gs.scene; g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; gemMat = o.material; } });
      (seat || b).add(g);
      gemLight = new THREE.PointLight(0xff2408, 0, 3.2, 2); (glowAt || seat || b).add(gemLight);
      b.position.set(.35, SEABED + floorY(.35, .45) - BOX_SINK, .45); b.rotation.set(.04, .7, -.2); b.scale.setScalar(BOX_SCALE);
      b.visible = false; scene.add(b); b.updateMatrixWorld(true);
      (glowAt || seat || b).getWorldPosition(motes.position);
      scene.add(siltDrift(b));
      box = b;
    }),
    loader.loadAsync('models/web/seabed.glb').then(gl => {
      dress(gl.scene); props.add(gl.scene);
      // the pot, the chain and the stones lie round the box in the lamp's light, each settled into the silt where it lies
      const bx = .35, bz = .45;
      for (const o of [...gl.scene.children]) {
        const r = Math.hypot(o.position.x, o.position.z), a = r > .05 ? Math.atan2(o.position.z, o.position.x) : 0;
        const d = .8 + r * 1.1;
        o.position.x = bx + Math.cos(a) * d; o.position.z = bz + Math.sin(a) * d;
        o.position.y = floorY(o.position.x, o.position.z) - .04;
        // the pot lies across the view, a little rolled and sunk, so it reads as lying on its side
        if (o.name === 'lobster_pot') { o.rotation.set(0, Math.PI / 2 + .25, .12); o.position.y -= .05; }
      }
    }),
  ]));
  let buoy = null, box = null, gemMat = null, gemLight = null;
  // a stage that is over gives its memory back: geometry, materials and their textures
  const disposeTree = root => root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
      if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k].value; if (v && v.isTexture) v.dispose(); }
      m.dispose();
    }
  });
  let surfaceFreed = false;
  const freeSurface = () => {
    surfaceFreed = true;
    for (const k of ['scenery', 'stillMask', 'depthMap', 'shoreMap']) { const t = plate.uniforms[k].value; if (t) t.dispose(); plate.uniforms[k].value = null; }
    plateReady = false; plate.enabled = false; plate.uniforms.shoreReady.value = 0; focus.uniforms.photoDepth.value = null; focus.uniforms.photoActive.value = 0;
    for (const o of [water, boat, sky, buoy].filter(Boolean)) { scene.remove(o); disposeTree(o); }
    waterTarget.dispose();
  };
  // silt drifted against the box's sides, deepest where it leans and spilling over its low edge
  const siltDrift = b => {
    const c = b.position, up = new THREE.Vector3(0, 1, 0).applyQuaternion(b.quaternion);
    const lean = Math.atan2(up.z, up.x), wall = .11 * 4 * BOX_SCALE / 3.5, rings = 28, segs = 96;
    const pos = [], uv = [], col = [], idx = [];
    for (let i = 0; i <= rings; i++) for (let j = 0; j <= segs; j++) {
      const r = (wall - .16) + (i / rings) * 1.25, a = j / segs * Math.PI * 2;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const low = Math.pow(Math.max(0, Math.cos(a - lean)), 2);
      const height = .13 + .2 * low + .035 * Math.sin(a * 5 + 1.3) + .02 * Math.sin(a * 11);
      const out = r - wall, reach = .38 + .35 * low;
      let h = out >= 0 ? height * Math.exp(-Math.pow(out / reach, 2)) : height * (low > .35 ? 1 - Math.pow(-out / .16, 2) * .5 : Math.max(0, 1 + out / .05));
      h += .008 * Math.sin(x * 9 + z * 4) * Math.exp(-Math.abs(out) * 3);
      if (i === rings) h = 0;
      pos.push(x, floorY(x, z) + h - .004, z); uv.push((x + 40) / 80, (40 - z) / 80);
      // shadowed in the crease against the wall, catching the light along the crest, fading into the plain floor
      const crease = out < .1 ? .55 + 4.5 * Math.max(0, out - .0) : 1, crest = 1 + .35 * Math.min(1, h / .2) * Math.exp(-Math.pow((out - .12) / .2, 2));
      const k = Math.min(1.35, crease * crest); col.push(k, k * .97, k * .9);
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
      const p0 = i * (segs + 1) + j, p1 = p0 + 1, p2 = p0 + segs + 1, p3 = p2 + 1;
      idx.push(p0, p2, p1, p1, p2, p3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mat = floor.material.clone(); mat.vertexColors = true; siltMats.push(mat); applySilt(mat);
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.castShadow = true; m.position.y = SEABED;
    return m;
  };
  // red-orange motes rising off the stone through the lid, each on its own slow drift
  const motes = (() => {
    const n = 150, seed = new Float32Array(n), pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) seed[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, glow: { value: 0 }, rise: { value: .95 * BOX_SCALE / 3.5 }, px: { value: 1 } },
      vertexShader: `attribute float seed; uniform float time, rise, px; varying float vA;
        void main() {
          float age = fract(time * (.06 + .05 * fract(seed * 7.13)) + seed);
          float a = seed * 40.0 + time * (.3 + .4 * fract(seed * 3.7));
          float r = (.02 + .16 * age) * rise * (.4 + fract(seed * 5.3));
          vec3 p = position + vec3(cos(a) * r, age * rise, sin(a) * r);
          vA = sin(3.14159 * age) * (.4 + .6 * fract(seed * 11.7));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = px * (2.0 + 4.0 * fract(seed * 13.1)) * (8.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform float glow; varying float vA;
        void main() { float d = length(gl_PointCoord - .5); float k = smoothstep(.5, .0, d);
          gl_FragColor = vec4(vec3(1.0, .36, .08) * k * vA * glow * 2.2, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    m.frustumCulled = false; m.visible = false; scene.add(m); return m;
  })();
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
      tDiffuse: { value: null }, tDepth: { value: null }, photoDepth: { value: null }, photoActive: { value: 0 }, sceneZoom: { value: 1 }, sceneCam: { value: new THREE.Vector2() },
      focusUv: { value: new THREE.Vector2(.5, .4) }, resolution: { value: new THREE.Vector2(1, 1) },
      nearClip: { value: camera.near }, farClip: { value: camera.far }, amount: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse, tDepth, photoDepth; uniform vec2 focusUv, resolution;
      uniform float nearClip, farClip, amount, photoActive, sceneZoom; uniform vec2 sceneCam; varying vec2 vUv;
      float linearDepth(float z) { return nearClip * farClip / (farClip - z * (farClip - nearClip)); }
      void main() {
        vec3 sharp = texture2D(tDiffuse, vUv).rgb;
        float byDepth;
        if (photoActive > .5) {
          float scale = mix(1.0, 3.1, smoothstep(0.0, 1.0, sceneZoom));
          vec2 hereUv = (vUv - .5) / scale + .5;
          vec2 focusPhotoUv = (focusUv - .5) / scale + .5;
          float hereLayer = texture2D(photoDepth, hereUv).r;
          float focusLayer = texture2D(photoDepth, focusPhotoUv).r;
          float here = texture2D(photoDepth, hereUv - sceneCam * (.12 + .75 * hereLayer)).r;
          float pointed = texture2D(photoDepth, focusPhotoUv - sceneCam * (.12 + .75 * focusLayer)).r;
          byDepth = smoothstep(.045, .30, abs(here - pointed));
        } else {
          float here = linearDepth(texture2D(tDepth, vUv).r);
          float pointed = linearDepth(texture2D(tDepth, focusUv).r);
          byDepth = smoothstep(.13, .95, abs(log2(max(here, 1.0) / max(pointed, 1.0))));
        }
        float byHeight = smoothstep(.07, .34, abs(vUv.y - focusUv.y));
        float blur = amount * max(byDepth * .9, byHeight * .85);
        vec2 px = vec2(1.0) / resolution * blur * mix(10.0, 6.0, sceneZoom);
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
  // Only the still shore, rocks and sky come from the sharp plate; every open
  // water pixel remains the live moving mesh. The focus pass follows it.
  const plate = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, scenery: { value: null }, stillMask: { value: null }, depthMap: { value: null }, shoreMap: { value: null }, shoreReady: { value: 0 }, surfTime: { value: 0 }, sceneCam: { value: new THREE.Vector2() }, zoom: { value: 1 }, aspect: { value: 1.777 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse, scenery, stillMask, depthMap, shoreMap; uniform vec2 sceneCam; uniform float zoom, aspect, shoreReady, surfTime; varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise2(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x),
                   mix(h(i + vec2(0.0, 1.0)), h(i + 1.0), f.x), f.y);
      }
      void main() {
        vec3 live = texture2D(tDiffuse, vUv).rgb;
        float scale = mix(1.0, 3.1, smoothstep(0.0, 1.0, zoom));
        vec2 uv = (vUv - vec2(.50, .50)) / scale + vec2(.50, .50);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(live, 1.0); return; }
        float layer = texture2D(depthMap, uv).r;
        uv -= sceneCam * (.12 + .75 * layer);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(live, 1.0); return; }
        float y = 1.0 - uv.y;
        float still = texture2D(stillMask, uv).r;
        float fade = 1.0 - smoothstep(.50, .94, zoom);
        vec3 photo = pow(texture2D(scenery, uv).rgb, vec3(.80));
        float crop = min(1.0, aspect / 1.777);
        vec2 skyUv = vec2(mix(.70, .50, crop) + (uv.x - .5) * crop, uv.y);
        vec3 photoSky = pow(texture2D(scenery, skyUv).rgb, vec3(.80));
        photo = mix(photo, photoSky, 1.0 - smoothstep(.13, .20, y));
        vec3 color = mix(live, photo, still * fade);
        if (shoreReady > .5 && fade > .01) {
          // The shore map is signed distance in source pixels: 128 at the
          // waterline, lighter inland, darker in water. The foam crests climb
          // the rock on one swell, then drain back on the next.
          vec2 sourcePx = uv * vec2(1672.0, 941.0);
          float distancePx = texture2D(shoreMap, uv).r * 255.0 - 128.0;
          if (abs(distancePx) < 28.0) {
            // Each swell reaches the shore at a different moment along it, so
            // only stretches of the rock are breaking at any time.
            float along = sourcePx.x * .013 + 1.6 * sin(sourcePx.x * .004 + sourcePx.y * .009);
            float swell = sin(surfTime * 1.05 - along);
            float surge = pow(max(swell, 0.0), 2.5);
            float wash = pow(max(sin(surfTime * 1.05 - along - .9), 0.0), 1.5);
            // the white climbs the rock as the swell lands, then drains back off it
            float runup = -4.0 + 9.0 * surge;
            vec2 q = mat2(.8, -.6, .6, .8) * sourcePx;
            float n = .6 * noise2(q * .11 + vec2(surfTime * .5, -surfTime * .3))
                    + .4 * noise2(q * .29 - vec2(surfTime * .9, surfTime * .6));
            float broken = smoothstep(.36, .72, n);
            float foam = exp(-pow((distancePx - runup) / (1.6 + 2.4 * surge), 2.0)) * surge * broken;
            // what the last swell left: thin streaks pulled out on the water
            float lace = exp(-pow((distancePx + 3.0 + 6.0 * (1.0 - wash)) / 3.0, 2.0)) * wash * (1.0 - surge) * .6
                       * smoothstep(.55, .85, noise2(sourcePx * vec2(.11, .45) + vec2(surfTime * .3, surfTime * .8)));
            float spray = 0.0;
            vec2 cell = floor(sourcePx / 13.0);
            for (int ix = -1; ix <= 1; ix++) for (int iy = -1; iy <= 1; iy++) {
              vec2 id = cell + vec2(float(ix), float(iy));
              float seed = h(id);
              if (seed < .80) continue;
              vec2 origin = (id + .5) * 13.0;
              float atLine = abs(texture2D(shoreMap, origin / vec2(1672.0, 941.0)).r * 255.0 - 128.0);
              // a burst only goes up where that stretch of shore is breaking
              float hit = pow(max(sin(surfTime * 1.05 - (origin.x * .013 + 1.6 * sin(origin.x * .004 + origin.y * .009)) + .35), 0.0), 4.0);
              float age = fract(surfTime * (.65 + .4 * h(id + 17.0)) + seed);
              vec2 bead = origin + vec2((h(id + 7.0) - .5) * age * 13.0,
                                         age * 30.0 - age * age * 16.0);
              float radius = mix(2.4, .7, age);
              spray += (1.0 - smoothstep(radius * .5, radius, length(sourcePx - bead)))
                     * (1.0 - smoothstep(2.0, 8.0, atLine)) * (1.0 - age) * hit;
            }
            color += vec3(.62, .68, .72) * (foam * 1.1 + lace * .45 + spray * 1.0) * fade;
          }
        }
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
  plate.enabled = false;
  let plateReady = false;
  const plateLoader = new THREE.TextureLoader();
  Promise.all([
    plateLoader.loadAsync('models/web/zoomout_a_plate.webp'),
    plateLoader.loadAsync('models/web/zoomout_a_depth.jpg'),
    plateLoader.loadAsync('models/web/zoomout_a_mask.png'),
  ]).then(([scenery, depthMap, stillMask]) => {
    scenery.colorSpace = THREE.SRGBColorSpace;
    scenery.minFilter = THREE.LinearFilter;
    depthMap.minFilter = THREE.LinearFilter;
    stillMask.minFilter = THREE.LinearFilter;
    plate.uniforms.scenery.value = scenery;
    plate.uniforms.stillMask.value = stillMask;
    plate.uniforms.depthMap.value = depthMap;
    focus.uniforms.photoDepth.value = depthMap;
    plateReady = true;
  }).catch(e => console.warn('Zoom-out scenery unavailable', e));
  plateLoader.loadAsync('models/web/zoomout_a_shore.png').then(shoreMap => {
    shoreMap.minFilter = THREE.LinearFilter;
    plate.uniforms.shoreMap.value = shoreMap;
    plate.uniforms.shoreReady.value = 1;
  }).catch(() => {});
  composer.addPass(plate);
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

  // ---- view: the pointer racks focus; observing the point draws the camera in before the dive ----
  const look = { x: 0, y: 0 };
  const focusAt = new THREE.Vector2(.5, .4);
  const viewShift = new THREE.Vector2();
  let pointerActive = false, cameraPointerActive = false;
  // as on the moor, ordinary pointer movement only racks focus
  const rackTo = e => { pointerActive = true; cameraPointerActive = true; look.x = e.clientX / innerWidth * 2 - 1; look.y = e.clientY / innerHeight * 2 - 1; };
  addEventListener('pointermove', rackTo);
  addEventListener('pointerdown', rackTo);
  addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') cameraPointerActive = false; });
  document.addEventListener('mouseleave', e => { cameraPointerActive = false; if (e.pointerType !== 'touch') pointerActive = false; });
  let underD = null;
  const st = { dive: 0, diveArmed: false, floor: 0, close: 0, stone: 0, fade: 0, zoom: 0, zoomTarget: 0 };
  let ledDive = false;
  const tgt = new THREE.Vector3(0, HANG, 0), lampPos = new THREE.Vector3(), viewAim = new THREE.Vector3();
  const cableEnd = new THREE.Vector3(), cableAxis = new THREE.Vector3(), boatCenter = new THREE.Vector3(), reflectionAnchor = new THREE.Vector3();
  let W = 1, H = 1, time = 0;
  const resize = () => {
    const dpr = Math.min(mobile ? 1.5 : 2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight; renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
    wu.screenSize.value.set(W * dpr, H * dpr);
    plate.uniforms.aspect.value = W / H;
    focus.uniforms.resolution.value.set(W * dpr, H * dpr);
    composer.setPixelRatio(dpr); composer.setSize(W, H); bloom.resolution.set(W / 2, H / 2);
    waterTarget.setSize(Math.round((mobile ? 384 : 768) * W / H), mobile ? 384 : 768);
    camera.aspect = W / H; camera.updateProjectionMatrix(); snowMat.uniforms.px.value = H * dpr / 18;
  };
  resize(); addEventListener('resize', resize);

  const render = dt => {
    time += dt;
    if (st.diveArmed && st.dive < .03 && st.zoomTarget > .9 && st.zoom < .96) {
      st.dive = Math.max(st.dive, .03 * smooth(.60, .96, st.zoom));
      ledDive = true;
    } else if (!st.diveArmed && ledDive && st.dive < .031) {
      st.dive = 0;
      ledDive = false;
    }
    const d = st.dive, fl = st.floor;
    st.zoom += ((d > 0 ? 1 : st.zoomTarget) - st.zoom) * (1 - Math.exp(-dt * 2.3));
    st.zoom = Math.max(0, Math.min(1, st.zoom));
    const zoom = smooth(0, 1, st.zoom);
    plate.enabled = plateReady && zoom < .94;
    plate.uniforms.zoom.value = zoom;
    plate.uniforms.surfTime.value = time;
    focus.uniforms.photoActive.value = plate.enabled ? 1 : 0;
    focus.uniforms.sceneZoom.value = zoom;
    moonDir.set(mix(-.35, -.62, zoom), mix(.035, .42, zoom), mix(-.90, -.66, zoom)).normalize();
    wu.moonDir.value.copy(moonDir);
    wu.sceneZoom.value = zoom;
    wu.moonColor.value.setRGB(mix(1.0, .88, zoom), mix(.85, .91, zoom), mix(.73, .96, zoom));
    moon.position.copy(moonDir).multiplyScalar(100);
    skyFill.intensity = mix(2.0, 1.15, zoom);
    // The hull samples the same surface at bow, stern, port and starboard.
    const boatScale = mix(1.14, 1, smooth(.55, .70, d));
    boat.scale.setScalar(boatScale);
    const lightBoost = boatScale * boatScale;
    const surfacePools = 1 - smooth(0, .02, d);
    flood.intensity = 12 * lightBoost;
    deck.intensity = 12 * lightBoost;
    cabin.intensity = 18 * lightBoost;
    for (const pool of workPools) pool.intensity = 30 * lightBoost * surfacePools;
    for (const pool of aftPools) pool.intensity = 12 * lightBoost * surfacePools;
    roofPool.intensity = 2.5 * lightBoost * surfacePools;
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
    const e = d;
    // one descent from the surface to just above the floor: a steady speed that only eases off near the bottom
    const run = e <= .85 ? e : .85 + (e - .85) - (e - .85) * (e - .85) / .3;
    const ly = mix(top.y - HANG, SEABED + 2.2, run / .925);
    const sway = 1 - smooth(0, .65, d) * .6;
    const swingLength = Math.min(5, Math.max(0, top.y - ly)) * .25;
    lampPos.set(top.x + (Math.sin(time * .9) * .06 + boat.rotation.z * swingLength) * sway,
      ly, top.z + (Math.cos(time * .7) * .05 + boat.rotation.x * swingLength) * sway);
    lamp.position.copy(lampPos);
    lamp.scale.setScalar(1.7);
    const surfaceGlobe = d === 0;
    globe.scale.setScalar(surfaceGlobe ? 1 : .18 / .205); fitting.scale.copy(globe.scale);
    globe.material.uniforms.core.value.setRGB(surfaceGlobe ? 2.0 : 1.6, surfaceGlobe ? 1.65 : .75, surfaceGlobe ? 1.15 : .18);
    globe.material.uniforms.rim.value.setRGB(1.2, surfaceGlobe ? .60 : .32, surfaceGlobe ? .25 : .03);
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
    wu.lampPos.value.copy(lampPos); wu.lampPow.value = 1 - deep; wu.time.value = time; wu.moonDive.value = d > 0 ? .75 + .25 * smooth(0, .045, d) : 0;
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
    // the stone glows faintly through the pierced lid, breathing, and sheds motes
    const gemGlow = smooth(.2, 1, fl) * (.5 + .12 * Math.sin(time * 1.3) + .06 * Math.sin(time * 3.7 + 1));
    if (gemMat) gemMat.emissiveIntensity = gemGlow * 4;
    if (gemLight) gemLight.intensity = gemGlow * 3;
    motes.visible = !!box && fl > .05;
    motes.material.uniforms.time.value = time; motes.material.uniforms.glow.value = gemGlow;
    motes.material.uniforms.px.value = renderer.getPixelRatio() * renderer.domElement.clientHeight / 900;

    // the camera
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointerEase = 1 - Math.exp(-dt * 8);
    if (d === 0) {
      const idleX = still ? 0 : Math.sin(time * .17) * .55;
      const idleY = still ? 0 : Math.sin(time * .11 + 1.3) * .35;
      const shiftX = cameraPointerActive ? look.x : idleX;
      const shiftY = cameraPointerActive ? look.y : idleY;
      const shiftEase = 1 - Math.exp(-dt * 4);
      viewShift.x += (shiftX - viewShift.x) * shiftEase;
      viewShift.y += (shiftY - viewShift.y) * shiftEase;
    }
    plate.uniforms.sceneCam.value.set(viewShift.x * .022, -viewShift.y * .014);
    focus.uniforms.sceneCam.value.copy(plate.uniforms.sceneCam.value);
    wu.sceneCam.value.copy(plate.uniforms.sceneCam.value);
    const wantedFocusX = pointerActive ? (look.x + 1) * .5 : .46 + Math.sin(time * .07) * .045;
    const wantedFocusY = pointerActive ? (1 - look.y) * .5 : .52 + Math.sin(time * .05 + 2) * .025;
    focusAt.x += (wantedFocusX - focusAt.x) * pointerEase;
    focusAt.y += (wantedFocusY - focusAt.y) * pointerEase;
    focus.uniforms.focusUv.value.copy(focusAt);
    const surface = 1 - smooth(0, .18, d);
    focus.uniforms.amount.value = surface * (d > 0 ? .30 : pointerActive ? 1 : mix(1, .30, zoom));
    // once the view is under the water it holds that framing: it only follows the lamp down, until the lamp is observed at the floor
    if (underD === null && camera.position.y < 0 && d > 0) underD = d;
    const dv = underD === null ? d : underD, cl = smooth(0, 1, st.close);
    const yaw = Math.PI / 4 + dv * .9;
    // a tall screen keeps the same width of view as a wide one
    const fv = mix(mix(27, 16, zoom), 34, smooth(0, .55, dv)) * Math.PI / 180;
    const platePitch = Math.atan(.70 * Math.tan(fv / 2) * Math.max(1, 1.2 / camera.aspect));
    const pitch = mix(mix(platePitch, .54, zoom), .3, smooth(.3, .6, dv)) + mix(0, .55, cl);
    const dist = mix(mix(135, 92, zoom), 26, smooth(0, .55, dv)) * mix(1, .3, cl);
    camera.fov = 2 * Math.atan(Math.tan(fv / 2) * Math.max(1, 1.2 / camera.aspect)) * 180 / Math.PI; camera.updateProjectionMatrix();
    // at the floor the view settles on the lamp and the box, then moves to put the stone at the centre
    const aim = box && cl > 0 ? lampPos.clone().lerp(box.position, .55 * cl).lerp(motes.position, smooth(0, 1, st.stone)) : lampPos;
    if (surface > .999) tgt.copy(lampPos);
    else tgt.lerp(aim, Math.min(1, dt * (d > 0 ? 6 : 2)));
    camera.position.set(tgt.x + Math.cos(pitch) * Math.sin(yaw) * dist, tgt.y + Math.sin(pitch) * dist, tgt.z + Math.cos(pitch) * Math.cos(yaw) * dist);
    const frameHeight = 2 * dist * Math.tan(camera.fov * Math.PI / 360);
    const frameWidth = frameHeight * camera.aspect;
    const dx = -.5 * viewShift.x * .022 * frameWidth;
    const dy = .5 * viewShift.y * .014 * frameHeight;
    const offsetX = Math.cos(yaw) * dx - Math.sin(pitch) * Math.sin(yaw) * dy;
    const offsetY = Math.cos(pitch) * dy;
    const offsetZ = -Math.sin(yaw) * dx - Math.sin(pitch) * Math.cos(yaw) * dy;
    camera.position.x += offsetX; camera.position.y += offsetY; camera.position.z += offsetZ;
    water.position.set(camera.position.x, 0, camera.position.z);
    water.scale.setScalar(mix(4, 1, zoom));
    // the camera follows the lamp down, but stays above the water until the lamp is well under, then drops through it
    viewAim.copy(tgt).add(new THREE.Vector3(offsetX, offsetY, offsetZ));
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
    // the floor loads once the dive is chosen; the surface is let go once it is far overhead
    if ((st.diveArmed || st.dive > 0) && !floorLoad) loadFloor();
    if (!surfaceFreed && camera.position.y < -12 && d > .5) freeSurface();
    // the boat's lights go out of sight from deep down
    lit.visible = true;
    grain.uniforms.time.value = time % 10; grain.uniforms.dark.value = deep;
    canvas.style.opacity = st.fade;
    composer.render(dt);
  };
  // the lamp on screen, in CSS pixels, for the point and its ping
  const screen = () => { const p = lampPos.clone().project(camera); return { x: (p.x * .5 + .5) * W, y: (-p.y * .5 + .5) * H }; };
  const stoneScreen = () => { const p = motes.position.clone().project(camera); return { x: (p.x * .5 + .5) * W, y: (-p.y * .5 + .5) * H }; };
  // compile every shader and draw one frame while the bay is still hidden, so its first visible frame doesn't stall
  // one material at a time in idle moments, the scene's and the passes' own, then a single first draw
  const idle = () => new Promise(r => window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 60));
  const warm = async () => {
    const seen = new Set(), jobs = [];
    scene.traverse(o => { for (const m of [].concat(o.material || [])) if (!seen.has(m)) { seen.add(m); jobs.push([o, camera, scene]); } });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    for (const pass of composer.passes) for (const k in pass) {
      const v = pass[k];
      for (const m of [].concat(v && (v.isMaterial ? v : Array.isArray(v) && v[0] && v[0].isMaterial ? v : []) || [])) {
        if (seen.has(m)) continue; seen.add(m); const q = quad.clone(); q.material = m; jobs.push([q, flat, null]);
      }
      if (pass.fsQuad && pass.fsQuad.material && !seen.has(pass.fsQuad.material)) { const m = pass.fsQuad.material; seen.add(m); const q = quad.clone(); q.material = m; jobs.push([q, flat, null]); }
    }
    // each is drawn once, alone, into a tiny target: the driver links its program and uploads its textures then, not mid-pan
    const tiny = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    const drawables = []; scene.traverse(x => { if (x.isMesh || x.isPoints || x.isLine) drawables.push(x); });
    for (const [o, c, sc] of jobs) {
      await idle();
      try {
        renderer.setRenderTarget(tiny);
        if (sc) {
          const keep = drawables.map(x => [x, x.visible, x.frustumCulled]);
          drawables.forEach(x => { x.visible = x === o; }); o.frustumCulled = false;
          renderer.render(scene, camera);
          keep.forEach(([x, v, f]) => { x.visible = v; x.frustumCulled = f; });
        } else renderer.render(o, c);
      } catch (e) {}
      renderer.setRenderTarget(null);
    }
    tiny.dispose();
    await idle(); render(1 / 60);
  };
  // the bay is over: every geometry, texture and target it made, and the context itself, are let go
  const dispose = () => {
    if (!surfaceFreed) freeSurface();
    disposeTree(scene);
    for (const p of composer.passes) { if (p.dispose) p.dispose(); }
    composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
    removeEventListener('resize', resize); renderer.dispose(); renderer.forceContextLoss();
  };
  return { st, look, render, screen, stoneScreen, ready, dispose, warm, renderer, scene, camera, get focusUv() { return focusAt.clone(); }, get lampY() { return lampPos.y; }, get box() { return box; } };
}
