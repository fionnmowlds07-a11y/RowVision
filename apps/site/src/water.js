// The lake. three's mirror water, with the boat's effect on the surface added inside the shader so it bends
// the reflections instead of sitting on top as a sticker: the dark line where the hull meets the water, the
// bow waves and stern trail, and the puddles the blades leave behind. The boat stays at the origin heading +x
// and the water flows past it, so world x/z are boat x/z.
import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';

const PUDDLES = 10;

function waterNormals() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N);
  const hgt = new Float32Array(N * N), waves = [];
  for (let i = 0; i < 28; i++) waves.push([Math.round((Math.random() - .5) * 14), Math.round((Math.random() - .5) * 14), Math.random() * 6.28, 1 / (1 + i * .25)]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let v = 0; for (const [kx, ky, p, a] of waves) v += a * Math.sin(6.2832 * (kx * x + ky * y) / N + p); hgt[y * N + x] = v; }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = hgt[y * N + (x + 1) % N] - hgt[y * N + (x - 1 + N) % N], hy = hgt[((y + 1) % N) * N + x] - hgt[((y - 1 + N) % N) * N + x];
    const n = new THREE.Vector3(-hx * .35, -hy * .35, 1).normalize(), o = (y * N + x) * 4;
    img.data[o] = (n.x * .5 + .5) * 255; img.data[o + 1] = (n.y * .5 + .5) * 255; img.data[o + 2] = (n.z * .5 + .5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

const PARS = /* glsl */`
  uniform float flow;            // metres of water that have passed the boat
  uniform float run;             // hull speed now, as a share of the mean
  uniform vec4 puddle[${PUDDLES}];      // x, z, age in seconds, strength
  uniform vec3 blade[2];         // x, z, how hard the blade is working
  const float HALF = 4.1;
  float hullHalf(float x) {
    float u = clamp(x / HALF, -1., 1.);
    float s = u > 0. ? pow(1. - u, .9) * pow(1. + u, .35) : pow(1. + u, .9) * pow(1. - u, .35);
    return .146 * min(1., s * 1.05);
  }
  // Signed distance to the hull's waterline, roughly: negative under the boat.
  float hullDist(vec2 p) { float e = max(abs(p.x) - HALF, 0.); return length(vec2(e, max(abs(p.y) - hullHalf(p.x), 0.))) - step(abs(p.y), hullHalf(p.x)) * step(abs(p.x), HALF) * .01; }
  // One V of waves trailing from a point on the centre line at x0. Returns height.
  float vWave(vec2 p, float x0, float amp) {
    float xb = x0 - p.x; if (xb < 0.) return 0.;
    float d = abs(p.y) - (.03 + xb * .30);                 // distance outside the crest line
    float w = .05 + .05 * pow(xb, .75);
    float main = exp(-d * d / (w * w));
    float inner = exp(-pow((d + w * 2.6) / (w * 1.3), 2.)) * .45 + exp(-pow((d + w * 5.) / (w * 1.6), 2.)) * .22;
    return amp * (main - inner * .8) * smoothstep(0., .5, xb) * exp(-xb / 11.);
  }
  // Surface disturbance: x = height (m), y = broken water (0..1), z = foam (0..1)
  vec3 wake(vec2 p) {
    float h = (vWave(p, HALF - .15, .022) + vWave(p, -HALF + .4, .012)) * run;
    float d = hullDist(p);
    h += .012 * exp(-max(d, 0.) / .07) * smoothstep(-HALF, HALF, p.x + 1.);   // water piles a little along the bow half
    float turb = 0., foam = 0.;
    // stern trail: a narrow band of churned water that widens and fades
    float xs = -HALF - p.x;
    if (xs > -.3) { float w = .08 + .035 * max(xs, 0.); float band = exp(-p.y * p.y / (w * w)) * smoothstep(-.3, .3, xs) * exp(-max(xs, 0.) / 14.); turb += band * .9; foam += band * .1 * exp(-max(xs, 0.) / 2.5); }
    for (int i = 0; i < ${PUDDLES}; i++) {
      vec4 q = puddle[i]; if (q.w <= 0.) continue;
      float r = length(p - q.xy), R = .26 + .2 * q.z, env = exp(-r * r / (R * R)) * q.w * exp(-q.z * .42);
      h += env * .03 * cos(r * 17. / (1. + q.z * .55) - q.z * 4.5) + q.w * .012 * exp(-pow((r - R * 1.25) / .07, 2.)) * exp(-q.z * .5);
      turb += env; foam += env * .12 * smoothstep(1.2, 0., q.z);
    }
    for (int i = 0; i < 2; i++) {
      float r = length(p - blade[i].xy), env = exp(-r * r / .03) * blade[i].z;
      h += env * .03; turb += env * 1.2; foam += env * .16;
    }
    return vec3(h, min(turb, 1.5), min(foam, 1.));
  }
`;
const NORMAL = /* glsl */`
  vec2 wp = worldPosition.xz;
  vec3 wk = wake(wp); float we = .035;
  vec2 grad = vec2(wake(wp + vec2(we, 0.)).x - wk.x, wake(wp + vec2(0., we)).x - wk.x) / we;
  vec2 chop = (texture2D(normalSampler, wp * 1.3 + vec2(flow * 1.3, time * .12)).xy + texture2D(normalSampler, wp * .55 + vec2(flow * .55, -time * .07)).xy - 1.);
  surfaceNormal = normalize(surfaceNormal + vec3(-grad.x * 1.4 + chop.x * wk.y * .5, 0., -grad.y * 1.4 + chop.y * wk.y * .5));
`;
const SHADE = /* glsl */`
  float hd = hullDist(wp);
  albedo *= 1. - .62 * exp(-max(hd, 0.) / .045);                       // the hull shades the water it sits in
  // Slopes of the wake catch or lose the sky's light, so the V reads even where the reflection is plain sky.
  albedo *= 1. + clamp(-(grad.x * sunDirection.x + grad.y * sunDirection.z), -.5, .5) * .55;
  albedo = mix(albedo, albedo * 1.18 + .02, clamp(wk.y, 0., 1.) * .5);   // churned water is paler
  float fn = texture2D(normalSampler, wp * 2.3 + vec2(flow * 2.3, 0.)).x * texture2D(normalSampler, wp * 5.1 + vec2(flow * 5.1, .3)).y * 4.;
  albedo = mix(albedo, vec3(.8, .83, .83), clamp(wk.z * 2.2 * smoothstep(.95, 1.25, fn + wk.z * .4), 0., .85));
  vec3 outgoingLight = albedo;
`;

export function createWater({ sun, mirror = 1024 }) {
  const water = new Water(new THREE.PlaneGeometry(6000, 6000), {
    textureWidth: mirror, textureHeight: mirror, waterNormals: waterNormals(), sunDirection: sun.clone(), sunColor: 0xffe0b0,
    waterColor: 0x14261f, distortionScale: .9, fog: true, alpha: 1,
  });
  water.rotation.x = -Math.PI / 2;
  const m = water.material, u = m.uniforms;
  u.size.value = 6;
  u.flow = { value: 0 }; u.run = { value: 1 };
  u.puddle = { value: Array.from({ length: PUDDLES }, () => new THREE.Vector4(0, 0, 0, 0)) };
  u.blade = { value: [new THREE.Vector3(), new THREE.Vector3()] };
  m.fragmentShader = m.fragmentShader
    .replace('void main() {', PARS + '\nvoid main() {')
    .replace('getNoise( worldPosition.xz * size )', 'getNoise( ( worldPosition.xz + vec2( flow, 0.0 ) ) * size )')
    .replace('vec3 diffuseLight = vec3(0.0);', NORMAL + '\nvec3 diffuseLight = vec3(0.0);')
    .replace('vec3 outgoingLight = albedo;', SHADE);
  m.needsUpdate = true;
  let next = 0;
  return {
    mesh: water,
    // Leave a puddle on the water at boat-frame (x, z).
    puddle(x, z, strength = 1) { u.puddle.value[next++ % PUDDLES].set(x, z, 0, strength); },
    blade(i, x, z, work) { u.blade.value[i].set(x, z, work); },
    update(dt, time, moved, run) {
      u.time.value = time * .6; u.flow.value = (u.flow.value + moved) % 20000; u.run.value = run;
      for (const p of u.puddle.value) if (p.w > 0) { p.x -= moved; p.z += dt; if (p.z > 9) p.w = 0; }
    },
  };
}
