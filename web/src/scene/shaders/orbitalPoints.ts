export const orbitalPointVertexShader = /* glsl */ `
  attribute float phase;

  uniform float pointSize;
  uniform float pixelRatio;

  varying float vPhase;

  #include <fog_pars_vertex>

  void main() {
    vPhase = phase;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float perspective = clamp(150.0 / max(1.0, -mvPosition.z), 0.45, 3.4);
    gl_PointSize = pointSize * pixelRatio * perspective;
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`

export const orbitalPointFragmentShader = /* glsl */ `
  uniform float opacity;

  varying float vPhase;

  #include <fog_pars_fragment>

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
    gl_FragColor = vec4(phaseColor, disc * opacity * 0.60);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`
