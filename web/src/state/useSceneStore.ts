import { create } from 'zustand'

import type { BasisKind, OrbitalParameters, RepresentationKind } from '../api/types'

interface SceneStore {
  orbital: OrbitalParameters
  representation: RepresentationKind
  samples: number
  seed: number
  resolution: number
  probabilityMass: number
  pointSize: number
  opacity: number
  bloom: number
  autoRotate: boolean
  showGrid: boolean
  setOrbital: (patch: Partial<OrbitalParameters>) => void
  setRepresentation: (value: RepresentationKind) => void
  setSamples: (value: number) => void
  setSeed: (value: number) => void
  setResolution: (value: number) => void
  setProbabilityMass: (value: number) => void
  setPointSize: (value: number) => void
  setOpacity: (value: number) => void
  setBloom: (value: number) => void
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

export const useSceneStore = create<SceneStore>()((set) => ({
  orbital: { n: 2, l: 1, m: 0, z: 1, basis: 'real' },
  representation: 'point_cloud',
  samples: 28000,
  seed: 7,
  resolution: 52,
  probabilityMass: 0.9,
  pointSize: 3.8,
  opacity: 0.82,
  bloom: 0.58,
  autoRotate: true,
  showGrid: true,
  setOrbital: (patch) => set((state) => ({ orbital: normalizeOrbital(state.orbital, patch) })),
  setRepresentation: (representation) => set({ representation }),
  setSamples: (samples) => set({ samples }),
  setSeed: (seed) => set({ seed }),
  setResolution: (resolution) => set({ resolution }),
  setProbabilityMass: (probabilityMass) => set({ probabilityMass }),
  setPointSize: (pointSize) => set({ pointSize }),
  setOpacity: (opacity) => set({ opacity }),
  setBloom: (bloom) => set({ bloom }),
  setAutoRotate: (autoRotate) => set({ autoRotate }),
  setShowGrid: (showGrid) => set({ showGrid }),
  applyPreset: (preset) => set((state) => ({ orbital: normalizeOrbital(state.orbital, preset) })),
}))
