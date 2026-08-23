import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import type { CurrentFieldPayload } from '../api/types'

interface CurrentStreamlinesProps {
  data: CurrentFieldPayload
  opacity: number
}

/**
 * Probability-flow streamlines.
 *
 * Colour encodes |j|/rho against the payload's own max_speed. Geometry stays
 * evenly spaced in arc length, so speed is shown once, by colour, and never
 * doubly encoded as vertex spacing.
 *
 * These are flow lines of the probability current, not electron trajectories.
 */
export function CurrentStreamlines({ data, opacity }: CurrentStreamlinesProps) {
  const geometry = useMemo(() => {
    const positions: number[] = []
    const colors: number[] = []
    const slow = new THREE.Color('#2b6cff')
    const fast = new THREE.Color('#ff4d6d')
    const scale = data.max_speed > 0 ? data.max_speed : 1

    data.lines.forEach((line, lineIndex) => {
      const speeds = data.speed[lineIndex]
      for (let index = 0; index + 1 < line.length; index += 1) {
        // LineSegments: every drawn segment needs both endpoints.
        positions.push(...line[index], ...line[index + 1])
        for (const offset of [0, 1]) {
          const normalized = Math.min(1, Math.max(0, (speeds[index + offset] ?? 0) / scale))
          const color = slow.clone().lerp(fast, Math.sqrt(normalized))
          colors.push(color.r, color.g, color.b)
        }
      }
    })

    const value = new THREE.BufferGeometry()
    value.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
    value.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3))
    value.computeBoundingBox()
    value.computeBoundingSphere()
    return value
  }, [data])

  useEffect(() => () => geometry.dispose(), [geometry])

  if (data.lines.length === 0) {
    return null
  }

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent={opacity < 0.999} opacity={opacity} />
    </lineSegments>
  )
}
