import { create } from 'zustand'

import { capabilityFor, type ParameterBound } from '../api/capability'
import type {
  BasisKind,
  OrbitalParameters,
  PrincipalPlane,
  RepresentationKind,
  SliceObservable,
} from '../api/types'

export type SceneMode = 'eigenstate' | 'superposition'

interface SceneStore {
  mode: SceneMode
  superpositionTerms: string
  superpositionLabel: string
  /**
   * The superposition's own basis, independent of `orbital.basis` on purpose:
   * they describe two different states, and sharing one field silently changed
   * the rendered physics of the time-dependent state when the eigenstate
   * toggle moved.
   */
  superpositionBasis: BasisKind
  /** Nuclear charge for the superposition request, in units of e. */
  superpositionZ: number
  /**
   * Reduced-mass ratio a_mu, carried in the store so the request states it
   * rather than letting the server default it. Read-only in the UI today.
   *
   * NOT `superpositionAMu` any more: four routes read this parameter and two of
   * them are eigenstate routes -- the eigenstate slice rescales both its derived
   * extent and the amplitude the phase mask is referenced to by this ratio. A
   * name that said "superposition" was the store asserting a mode-dependence the
   * capability matrix does not have.
   */
  aMu: number
  timeAu: number
  playing: boolean
  orbital: OrbitalParameters
  representation: RepresentationKind
  /**
   * Which principal plane a slice is cut on, and which scalar field it carries.
   *
   * Both start at the value routes.py declares as its own default, so a slice
   * requested before either picker is touched is the slice the route documents
   * rather than one this store invented.
   */
  plane: PrincipalPlane
  sliceObservable: SliceObservable
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
  setMode: (value: SceneMode) => void
  setSuperposition: (terms: string, label: string) => void
  setSuperpositionBasis: (value: BasisKind) => void
  setSuperpositionZ: (value: number) => void
  setAMu: (value: number) => void
  setTimeAu: (value: number) => void
  setPlaying: (value: boolean) => void
  setOrbital: (patch: Partial<OrbitalParameters>) => void
  setRepresentation: (value: RepresentationKind) => void
  setPlane: (value: PrincipalPlane) => void
  setSliceObservable: (value: SliceObservable) => void
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

/**
 * The grid, moved into whatever range the cell that will actually be drawn
 * declares for it -- and left exactly alone when that cell has no grid.
 *
 * Both writers of `resolution` used to spell `Math.min(81, Math.max(value,
 * max(49, 16n + 17)))`, which is the EIGENSTATE ISOSURFACE row's bound written
 * down a second time and then applied to every row there is. A slice runs to
 * 513, so a 129-sample section was silently cut to 81 -- by a store that had
 * just been told, by the same matrix the panel's slider reads, that 129 was
 * fine. The point cloud has no grid at all, and had one edited anyway.
 *
 * `representation` is the RESOLVED one, not the requested one: a demoted cell's
 * abandoned bound can be empty (the isosurface at n = 5 declares min 97 > max
 * 81) and clamping into it would produce a number no route ever offered.
 */
function clampResolution(
  mode: SceneMode,
  orbital: OrbitalParameters,
  representation: RepresentationKind,
  resolution: number,
): number {
  const capability = capabilityFor({ mode, orbital, representation })
  const bound: ParameterBound | undefined =
    capability.status === 'available' ? capability.parameters.resolution : undefined
  if (bound === undefined) return resolution
  return Math.min(bound.max, Math.max(bound.min, resolution))
}

/**
 * The representation each mode can always serve, and therefore the last resort
 * when neither the requested nor the standing one is available.
 *
 * Both entries are total, not defaults of convenience: the eigenstate point
 * cloud is unconditional (its route bounds only `samples` and `seed`), and the
 * superposition isosurface is unconditional too (no single n, so no 16n + 17
 * floor and no n <= 4 ceiling). That is why this resolver never has to answer
 * "nothing is available" -- and why superposition's fallback is the isosurface
 * rather than the point cloud, which has no time-dependent route at all.
 */
const ALWAYS_AVAILABLE: Record<SceneMode, RepresentationKind> = {
  eigenstate: 'point_cloud',
  superposition: 'isosurface',
}

/**
 * The representation actually shown for a requested one.
 *
 * This used to be a local predicate that knew two of the availability rules --
 * isosurface n <= 4, and streamlines needing a complex m != 0 orbital -- and
 * did not know the mode at all. So `setMode('superposition')` left
 * `point_cloud` standing even though no route samples a time-dependent state
 * that way, and the canvas short-circuited on a representation the store had
 * called supported. The answer now comes from `capabilityFor`, the one matrix
 * transcribed from the routes, so the store cannot hold an opinion the fetch
 * layer disagrees with.
 *
 * `current` is kept when the request is refused but the standing representation
 * still works: a user asking for something unavailable should not also lose the
 * picture they already had.
 */
export function resolveRepresentation(
  mode: SceneMode,
  orbital: OrbitalParameters,
  requested: RepresentationKind,
  current: RepresentationKind,
): RepresentationKind {
  const available = (representation: RepresentationKind): boolean =>
    capabilityFor({ mode, orbital, representation }).status === 'available'
  if (available(requested)) return requested
  if (available(current)) return current
  return ALWAYS_AVAILABLE[mode]
}

export const useSceneStore = create<SceneStore>()((set) => ({
  mode: 'eigenstate',
  superpositionTerms: '1,0,0,0.7071067811865476;2,1,0,0.7071067811865476',
  superpositionLabel: '1s + 2p_z (Bohr oscillation)',
  superpositionBasis: 'complex',
  superpositionZ: 1.0,
  aMu: 1.0,
  timeAu: 0,
  playing: false,
  orbital: { n: 2, l: 1, m: 0, z: 1, basis: 'real' },
  representation: 'point_cloud',
  // routes.py: `plane: PrincipalPlane = PrincipalPlane.XZ`,
  // `observable: SliceObservable = SliceObservable.PROBABILITY_DENSITY`.
  plane: 'xz',
  sliceObservable: 'probability_density',
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
  setMode: (mode) =>
    set((state) => ({
      mode,
      playing: false,
      // The two modes do not serve the same representations, so the standing
      // one has to be re-resolved here or the canvas is asked for a picture no
      // route can draw.
      representation: resolveRepresentation(
        mode,
        state.orbital,
        state.representation,
        state.representation,
      ),
    })),
  setSuperposition: (superpositionTerms, superpositionLabel) =>
    set({ superpositionTerms, superpositionLabel, timeAu: 0 }),
  setSuperpositionBasis: (superpositionBasis) => set({ superpositionBasis }),
  setSuperpositionZ: (superpositionZ) => set({ superpositionZ }),
  setAMu: (aMu) => set({ aMu }),
  setTimeAu: (timeAu) => set({ timeAu }),
  setPlaying: (playing) => set({ playing }),
  setOrbital: (patch) =>
    set((state) => {
      const orbital = normalizeOrbital(state.orbital, patch)
      const representation = resolveRepresentation(
        state.mode,
        orbital,
        state.representation,
        state.representation,
      )
      return {
        orbital,
        representation,
        resolution: clampResolution(state.mode, orbital, representation, state.resolution),
      }
    }),
  setRepresentation: (representation) =>
    set((state) => ({
      representation: resolveRepresentation(
        state.mode,
        state.orbital,
        representation,
        state.representation,
      ),
    })),
  setPlane: (plane) => set({ plane }),
  setSliceObservable: (sliceObservable) => set({ sliceObservable }),
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
      const representation = resolveRepresentation(
        state.mode,
        orbital,
        state.representation,
        state.representation,
      )
      return {
        orbital,
        representation,
        resolution: clampResolution(state.mode, orbital, representation, state.resolution),
      }
    }),
}))
