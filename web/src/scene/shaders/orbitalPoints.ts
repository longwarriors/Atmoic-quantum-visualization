export const orbitalPointVertexShader = /* glsl */ `
  attribute float intensity;
  attribute float phase;

  uniform float pointSize;
  uniform float pixelRatio;

  varying float vIntensity;
  varying float vPhase;

  void main() {
    vIntensity = intensity;
    vPhase = phase;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float perspective = clamp(150.0 / max(1.0, -mvPosition.z), 0.45, 3.4);
    gl_PointSize = pointSize * pixelRatio * perspective * (0.70 + 0.85 * intensity);
    gl_Position = projectionMatrix * mvPosition;
  }
`

export const orbitalPointFragmentShader = /* glsl */ `
  uniform float opacity;

  varying float vIntensity;
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

    float hue = fract(vPhase / 6.28318530718 + 1.0);
    vec3 phaseColor = hsv2rgb(vec3(hue, 0.72, 0.98));
    vec3 coolCore = vec3(0.70, 0.93, 1.0);
    vec3 color = mix(coolCore, phaseColor, 0.72);
    color *= 0.72 + 0.52 * vIntensity;

    float alpha = disc * opacity * (0.18 + 0.82 * vIntensity);
    gl_FragColor = vec4(color, alpha);
  }
`
