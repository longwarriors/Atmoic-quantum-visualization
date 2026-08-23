import { create } from 'zustand'

import type { BasisKind, OrbitalParameters, RepresentationKind } from '../api/types'

interface SceneStore {
  orbital: OrbitalParameters
  representation: RepresentationKind
  samples: number
  seed: number
  resolution: number
  probabilityMass: number
  seedCount: number
  pointSize: number
  opacity: number
  bloom: number
  exposure: number
  fogStrength: number
  autoRotate: boolean
  showGrid: boolean
  setOrbital: (patch: Partial<OrbitalParameters>) => void
  setRepresentation: (value: RepresentationKind) => void
  setSamples: (value: number) => void
  setSeed: (value: number) => void
  setResolution: (value: number) => void
  setProbabilityMass: (value: number) => void
  setSeedCount: (value: number) => void
  setPointSize: (value: number) => void
  setOpacity: (value: number) => void
  setBloom: (value: number) => void
  setExposure: (value: number) => void
  setFogStrength: (value: number) => void
  setAutoRotate: (value: boolean) => void
  setShowGrid: (value: boolean) => void
  applyPreset: (preset: OrbitalParameters) => void
}

function normalizeOrbital(current: OrbitalParameters, patch: Partial<OrbitalParameters>): OrbitalParameters {
  const n = Math.max(1, Math.min(8, Math.round(patch.n ?? current.n)))
  const l = Math.max(0, Math.min(n - 1, Math.round(patch.l ?? current.l)))
  const m = Math.max(-l, Math.min(l, Math.round(patch.m ?? current.m)))
  const z = Math.max(0.1, Math.min(20, patch.z ?? current.z))
  const basis: BasisKind = patch.basis ?? current.basis
  return { n, l, m, z, basis }
}

function minimumSurfaceResolution(n: number): number {
  return Math.max(49, 16 * n + 17)
}

/**
 * Not every representation exists for every state. An isosurface is only
 * validated to n <= 4, and a real stationary orbital has identically zero
 * probability current, so streamlines would be an empty picture rather than a
 * physical statement. Fall back rather than render something meaningless.
 */
export function supportedRepresentation(
  orbital: OrbitalParameters,
  requested: RepresentationKind,
): RepresentationKind {
  if (requested === 'isosurface' && orbital.n > 4) return 'point_cloud'
  if (requested === 'streamlines' && (orbital.basis !== 'complex' || orbital.m === 0)) {
    return 'point_cloud'
  }
  return requested
}

export const useSceneStore = create<SceneStore>()((set) => ({
  orbital: { n: 2, l: 1, m: 0, z: 1, basis: 'real' },
  representation: 'point_cloud',
  samples: 28000,
  seed: 7,
  resolution: 65,
  probabilityMass: 0.9,
  seedCount: 48,
  pointSize: 2.8,
  opacity: 1.0,
  bloom: 0.12,
  exposure: 0.9,
  fogStrength: 0.18,
  autoRotate: false,
  showGrid: true,
  setOrbital: (patch) =>
    set((state) => {
      const orbital = normalizeOrbital(state.orbital, patch)
      return {
        orbital,
        representation: supportedRepresentation(orbital, state.representation),
        resolution: Math.min(81, Math.max(state.resolution, minimumSurfaceResolution(orbital.n))),
      }
    }),
  setRepresentation: (representation) =>
    set((state) => ({ representation: supportedRepresentation(state.orbital, representation) })),
  setSamples: (samples) => set({ samples }),
  setSeed: (seed) => set({ seed }),
  setResolution: (resolution) => set({ resolution }),
  setProbabilityMass: (probabilityMass) => set({ probabilityMass }),
  setSeedCount: (seedCount) => set({ seedCount }),
  setPointSize: (pointSize) => set({ pointSize }),
  setOpacity: (opacity) => set({ opacity }),
  setBloom: (bloom) => set({ bloom }),
  setExposure: (exposure) => set({ exposure }),
  setFogStrength: (fogStrength) => set({ fogStrength }),
  setAutoRotate: (autoRotate) => set({ autoRotate }),
  setShowGrid: (showGrid) => set({ showGrid }),
  applyPreset: (preset) =>
    set((state) => {
      const orbital = normalizeOrbital(state.orbital, preset)
      return {
        orbital,
        representation: supportedRepresentation(orbital, state.representation),
        resolution: Math.min(81, Math.max(state.resolution, minimumSurfaceResolution(orbital.n))),
      }
    }),
}))
