import * as THREE from 'three'

export function phaseToRgb(phase: number): [number, number, number] {
  const hue = ((phase / (2 * Math.PI)) % 1 + 1) % 1
  const color = new THREE.Color().setHSL(hue, 0.68, 0.58)
  return [color.r, color.g, color.b]
}
