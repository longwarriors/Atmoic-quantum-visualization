import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import type { SurfaceGeometry } from '../api/types'
import { phaseToLinearRgb } from './color'

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
      // Buffer attributes live in Three's Linear-sRGB working space. The
      // palette itself is sRGB because it is also printed as CSS bytes.
      const [r, g, b] = phaseToLinearRgb(value)
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
      <mesh geometry={geometry} castShadow={false} receiveShadow={false}>
        <meshBasicMaterial
          vertexColors
          // Phase colour is data keyed by the adjacent legend. MeshBasic is
          // deliberately unlit: normals, coloured lights, view angle and
          // received shadows must not change which phase a vertex denotes.
          fog={false}
          toneMapped={false}
          transparent={opacity < 0.999}
          opacity={opacity}
          side={THREE.FrontSide}
          depthWrite={opacity > 0.8}
        />
      </mesh>
    </group>
  )
}
