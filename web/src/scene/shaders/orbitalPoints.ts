import { PHASE_SATURATION, PHASE_TURN_RADIANS, PHASE_VALUE } from '../color'

export const orbitalPointVertexShader = /* glsl */ `
  attribute float phase;

  uniform float pointSize;
  uniform float pixelRatio;

  varying float vPhase;

  void main() {
    vPhase = phase;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float perspective = clamp(150.0 / max(1.0, -mvPosition.z), 0.45, 3.4);
    gl_PointSize = pointSize * pixelRatio * perspective;
    gl_Position = projectionMatrix * mvPosition;
  }
`

export const orbitalPointFragmentShader = /* glsl */ `
  uniform float opacity;

  varying float vPhase;

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float radius = length(centered);
    float disc = 1.0 - smoothstep(0.18, 0.50, radius);
    if (disc <= 0.001) discard;

    float hue = fract(vPhase / ${PHASE_TURN_RADIANS} + 1.0);
    vec3 phaseSrgb = hsv2rgb(vec3(hue, ${PHASE_SATURATION}, ${PHASE_VALUE}));
    // The palette is defined in sRGB so its numbers are the CSS legend's
    // bytes. Render targets hold linear light: decode once here, then let the
    // output chunk encode once when this pass eventually reaches the screen.
    vec3 phaseLinear = sRGBTransferEOTF(vec4(phaseSrgb, 1.0)).rgb;
    gl_FragColor = vec4(phaseLinear, disc * opacity * 0.60);

    #include <colorspace_fragment>
  }
`
