export const PHASE_TURN_RADIANS = 2 * Math.PI
export const PHASE_SATURATION = 0.72
export const PHASE_VALUE = 0.98

/**
 * The phase palette in display-encoded sRGB.
 *
 * These are the numbers the CSS legend writes as bytes. GPU inputs must decode
 * them to Linear-sRGB before Three's output conversion encodes them again.
 */
export function phaseToRgb(phase: number): [number, number, number] {
  const hue = ((phase / PHASE_TURN_RADIANS) % 1 + 1) % 1
  return hsvToRgb(hue, PHASE_SATURATION, PHASE_VALUE)
}

/** The sRGB EOTF used by Three's shader prefix (`sRGBTransferEOTF`). */
export function srgbChannelToLinear(channel: number): number {
  return channel <= 0.04045
    ? channel * 0.0773993808
    : (channel * 0.9478672986 + 0.0521327014) ** 2.4
}

/** The phase palette decoded into Three's Linear-sRGB working colour space. */
export function phaseToLinearRgb(phase: number): [number, number, number] {
  const [r, g, b] = phaseToRgb(phase)
  return [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)]
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const channel = (offset: number) => {
    const valueOnHexagon = Math.abs(((hue + offset) % 1) * 6 - 3)
    return value * (1 - saturation + saturation * Math.min(Math.max(valueOnHexagon - 1, 0), 1))
  }
  return [channel(0), channel(2 / 3), channel(1 / 3)]
}
