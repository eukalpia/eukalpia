import { BackSide, BoxGeometry, Color, Mesh, ShaderMaterial, Vector3 } from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { sunDirection, type LightingPreset, type TimeOfDay } from './timeOfDay';

const SKY_SCALE = 10000;

const nightVertex = /* glsl */ `
varying vec3 vWorldPosition;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  gl_Position.z = gl_Position.w;
}`;

const nightFragment = /* glsl */ `
uniform vec3 moonDirection;
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform float time;
varying vec3 vWorldPosition;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float stars(vec3 dir, float scale, float threshold) {
  vec3 p = dir * scale;
  vec3 cell = floor(p);
  float h = hash13(cell);
  if (h < threshold) return 0.0;
  vec3 center = cell + 0.5 + (vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) - 0.5) * 0.7;
  float d = length(p - center);
  float twinkle = 0.75 + 0.25 * sin(time * (1.0 + h * 3.0) + h * 40.0);
  // Stars are kept around a pixel wide so they survive at any resolution.
  return smoothstep(0.32, 0.0, d) * pow((h - threshold) / (1.0 - threshold), 1.5) * twinkle;
}

void main() {
  vec3 dir = normalize(vWorldPosition - cameraPosition);
  float up = clamp(dir.y, -1.0, 1.0);
  vec3 col = mix(horizonColor, zenithColor, smoothstep(-0.05, 0.55, up));

  // Milky Way: a soft noisy band along a tilted great circle.
  vec3 bandNormal = normalize(vec3(0.35, 0.55, -0.76));
  float band = exp(-pow(dot(dir, bandNormal) / 0.13, 2.0));
  float dust = noise3(dir * 40.0) * 0.5 + noise3(dir * 90.0) * 0.3 + noise3(dir * 200.0) * 0.2;
  float lane = smoothstep(0.35, 0.65, noise3(dir * 16.0 + 4.0));
  float visible = smoothstep(-0.02, 0.12, up);
  col += vec3(0.018, 0.02, 0.028) * band * smoothstep(0.3, 0.8, dust) * mix(1.0, 0.35, lane) * visible;

  // Kept under the night bloom threshold except for a few bright stars.
  float s = stars(dir, 140.0, 0.975) * 0.9 + stars(dir, 320.0, 0.985) * 0.35 + band * stars(dir, 520.0, 0.95) * 0.3;
  vec3 starTint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.86, 0.7), hash13(floor(dir * 260.0) + 9.0));
  col += starTint * s * visible;

  // Moon disc with a faint halo.
  float m = dot(dir, moonDirection);
  float disc = smoothstep(0.99988, 0.99993, m);
  float crater = 0.8 + 0.2 * noise3(dir * 900.0);
  col += vec3(1.0, 0.97, 0.9) * disc * 12.0 * crater;
  col += vec3(0.32, 0.38, 0.5) * pow(max(m, 0.0), 900.0) * 0.6 + vec3(0.06, 0.08, 0.12) * pow(max(m, 0.0), 40.0);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface SkyRig {
  mesh: Mesh;
  setPreset(p: LightingPreset, time: TimeOfDay): void;
  update(seconds: number): void;
  dispose(): void;
}

export function createSky(): SkyRig {
  const day = new Sky();
  day.scale.setScalar(SKY_SCALE);
  const dayMaterial = day.material as ShaderMaterial;
  dayMaterial.uniforms.mieCoefficient.value = 0.004;
  dayMaterial.uniforms.mieDirectionalG.value = 0.82;
  dayMaterial.uniforms.cloudCoverage.value = 0.32;
  dayMaterial.uniforms.cloudDensity.value = 0.5;
  dayMaterial.uniforms.cloudElevation.value = 0.55;

  const nightMaterial = new ShaderMaterial({
    name: 'NightSky',
    uniforms: {
      moonDirection: { value: new Vector3(0, 1, 0) },
      zenithColor: { value: new Color(0x02040a) },
      horizonColor: { value: new Color(0x0c1626) },
      time: { value: 0 },
    },
    vertexShader: nightVertex,
    fragmentShader: nightFragment,
    side: BackSide,
    depthWrite: false,
  });

  const mesh = new Mesh(new BoxGeometry(1, 1, 1), dayMaterial);
  mesh.scale.setScalar(SKY_SCALE);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  const dir = new Vector3();

  return {
    mesh,
    setPreset(p, time) {
      sunDirection(p, dir);
      if (time === 'day') {
        mesh.material = dayMaterial;
        dayMaterial.uniforms.sunPosition.value.copy(dir);
        dayMaterial.uniforms.turbidity.value = p.turbidity;
        dayMaterial.uniforms.rayleigh.value = p.rayleigh;
      } else {
        mesh.material = nightMaterial;
        nightMaterial.uniforms.moonDirection.value.copy(dir);
      }
    },
    update(seconds) {
      dayMaterial.uniforms.time.value = seconds;
      nightMaterial.uniforms.time.value = seconds;
    },
    dispose() {
      mesh.geometry.dispose();
      dayMaterial.dispose();
      nightMaterial.dispose();
      day.geometry.dispose();
    },
  };
}
