import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import type { SurfaceGeometry } from '../api/types'
import { phaseToRgb } from './color'

interface OrbitalSurfaceProps {
  /** Geometry only: the stationary and time-dependent payloads share these fields. */
  data: SurfaceGeometry
  opacity: number
}

export function OrbitalSurface({ data, opacity }: OrbitalSurfaceProps) {
  const geometry = useMemo(() => {
    const vertices = new Float32Array(data.vertices.flat())
    const normals = new Float32Array(data.normals.flat())
    const indices = new Uint32Array(data.faces.flat())
    const colors = new Float32Array(data.phase.length * 3)
    data.phase.forEach((value, index) => {
      const [r, g, b] = phaseToRgb(value)
      colors[index * 3] = r
      colors[index * 3 + 1] = g
      colors[index * 3 + 2] = b
    })

    const value = new THREE.BufferGeometry()
    value.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    value.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    value.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    value.setIndex(new THREE.BufferAttribute(indices, 1))
    value.computeBoundingBox()
    value.computeBoundingSphere()
    return value
  }, [data])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          vertexColors
          transparent={opacity < 0.999}
          opacity={opacity}
          roughness={0.24}
          metalness={0.02}
          clearcoat={0.7}
          clearcoatRoughness={0.24}
          side={THREE.FrontSide}
          depthWrite={opacity > 0.8}
        />
      </mesh>
    </group>
  )
}
