import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import type { PointCloudData } from '../api/types'
import { orbitalPointFragmentShader, orbitalPointVertexShader } from './shaders/orbitalPoints'

interface ElectronCloudProps {
  data: PointCloudData
  pointSize: number
  opacity: number
}

export function ElectronCloud({ data, pointSize, opacity }: ElectronCloudProps) {
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  const geometry = useMemo(() => {
    const value = new THREE.BufferGeometry()
    value.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    value.setAttribute('phase', new THREE.BufferAttribute(data.phase, 1))
    value.computeBoundingBox()
    value.computeBoundingSphere()
    return value
  }, [data])

  const uniforms = useMemo(
    () => ({
      pointSize: { value: pointSize },
      pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      opacity: { value: opacity },
    }),
    [],
  )

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.pointSize.value = pointSize
      materialRef.current.uniforms.opacity.value = opacity
    }
  }, [opacity, pointSize])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={orbitalPointVertexShader}
        fragmentShader={orbitalPointFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
        // Phase colour is scientific data, so it must not move with camera
        // depth (fog) or photographic exposure (tone mapping).
        fog={false}
        toneMapped={false}
      />
    </points>
  )
}
