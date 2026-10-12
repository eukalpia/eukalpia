import { Effect, EffectAttribute } from 'postprocessing';
import { Color, Matrix4, Uniform, Vector3, type Camera } from 'three';

const fragmentShader = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform float uDensity;
uniform float uFalloff;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uExposure;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 col = inputColor.rgb;
  if (depth < 0.999999) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = uProjInv * ndc;
    view /= view.w;
    vec3 world = (uViewInv * vec4(view.xyz, 1.0)).xyz;
    vec3 d = world - uCamPos;
    float len = length(d);
    vec3 dir = d / max(len, 1e-3);
    // Exponential height fog integrated analytically along the view ray.
    float k = uFalloff * dir.y * len;
    float column = uDensity * exp(-uFalloff * uCamPos.y) * len * (abs(k) > 1e-4 ? (1.0 - exp(-k)) / k : 1.0);
    float fog = 1.0 - exp(-column);
    // Forward scattering towards the sun warms the haze around it.
    float mu = dot(dir, uSunDir);
    float g = 0.6;
    float hg = (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    vec3 inscatter = uFogColor + uSunColor * hg * 0.5;
    col = mix(col, inscatter, fog);
  }
  outputColor = vec4(col * uExposure, inputColor.a);
}
`;

/** Height fog, aerial perspective and exposure, applied from the depth buffer. */
export class AtmosphereEffect extends Effect {
  private readonly camera: Camera;

  constructor(camera: Camera) {
    super('AtmosphereEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uProjInv', new Uniform(new Matrix4())],
        ['uViewInv', new Uniform(new Matrix4())],
        ['uCamPos', new Uniform(new Vector3())],
        ['uFogColor', new Uniform(new Color())],
        ['uDensity', new Uniform(0.0002)],
        ['uFalloff', new Uniform(0.0016)],
        ['uSunDir', new Uniform(new Vector3(0, 1, 0))],
        ['uSunColor', new Uniform(new Color())],
        ['uExposure', new Uniform(1)],
      ]),
    });
    this.camera = camera;
  }

  setAtmosphere(o: {
    fogColor: Color;
    density: number;
    falloff: number;
    sunDir: Vector3;
    sunColor: Color;
    exposure: number;
  }) {
    const u = this.uniforms;
    (u.get('uFogColor')!.value as Color).copy(o.fogColor);
    u.get('uDensity')!.value = o.density;
    u.get('uFalloff')!.value = o.falloff;
    (u.get('uSunDir')!.value as Vector3).copy(o.sunDir);
    (u.get('uSunColor')!.value as Color).copy(o.sunColor);
    u.get('uExposure')!.value = o.exposure;
  }

  override update() {
    const u = this.uniforms;
    (u.get('uProjInv')!.value as Matrix4).copy(this.camera.projectionMatrixInverse);
    (u.get('uViewInv')!.value as Matrix4).copy(this.camera.matrixWorld);
    (u.get('uCamPos')!.value as Vector3).setFromMatrixPosition(this.camera.matrixWorld);
  }
}
