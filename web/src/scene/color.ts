export function phaseToRgb(phase: number): [number, number, number] {
  const hue = ((phase / (2 * Math.PI)) % 1 + 1) % 1
  return hsvToRgb(hue, 0.72, 0.98)
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const channel = (offset: number) => {
    const valueOnHexagon = Math.abs(((hue + offset) % 1) * 6 - 3)
    return value * (1 - saturation + saturation * Math.min(Math.max(valueOnHexagon - 1, 0), 1))
  }
  return [channel(0), channel(2 / 3), channel(1 / 3)]
}
