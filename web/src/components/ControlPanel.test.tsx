/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  capabilityFor,
  planSceneRequest,
  type Capability,
  type CapabilityInputs,
  type ParameterId,
} from '../api/capability'
import { PRINCIPAL_PLANES, SLICE_OBSERVABLES } from '../api/sliceContract'
import type { OrbitalParameters, RepresentationKind } from '../api/types'
import { useSceneStore, type SceneMode } from '../state/useSceneStore'
import { mount, type MountedTree } from '../test/mount'
import { ControlPanel } from './ControlPanel'
import { nextTimeAu, selectSceneRequestInputs } from './sceneRequest'

/**
 * The panel's answer to "can this cell be drawn?" must come from
 * `capabilityFor` and from nowhere else. That is not provable by asserting the
 * six answers it happens to give today -- a second predicate agreeing with the
 * matrix by coincidence passes such a test. It is provable by MOVING the
 * matrix underneath the mounted component and watching the buttons follow.
 *
 * So `capabilityFor` is mocked for this whole file with a delegating wrapper:
 * `capabilityOverride.current` is null in every test but the sabotage ones, in
 * which the panel therefore sees the real matrix; when a sabotage test sets it,
 * one cell of the matrix changes and nothing else does. A control panel with
 * its own opinion about that cell keeps rendering the old answer and goes red.
 */
const capabilityOverride = vi.hoisted(() => ({
  current: null as ((inputs: CapabilityInputs) => Capability) | null,
}))

const superpositionCatalogueFailure = vi.hoisted(() => ({
  current: null as Error | null,
  omitSelected: false,
}))

vi.mock('../api/capability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/capability')>()
  return {
    ...actual,
    capabilityFor: (inputs: CapabilityInputs): Capability =>
      capabilityOverride.current?.(inputs) ?? actual.capabilityFor(inputs),
  }
})

// The catalogue fetches are not what this file measures, and a jsdom worker
// that really reaches for 127.0.0.1:8000 is both slow and flaky. Two entries in
// each catalogue, one of which matches the store's initial state, so the
// "currently selected" branch of each strip is rendered as well as the other.
const CATALOGUE = vi.hoisted(() => ({
  presets: [
    { id: 'p2pz', label: '2p_z', n: 2, l: 1, m: 0, basis: 'real' as const },
    { id: 'p3d', label: '3d_xy', n: 3, l: 2, m: -2, basis: 'real' as const },
    { id: 'p1s', label: '1s', n: 1, l: 0, m: 0, basis: 'real' as const },
    { id: 'p2px', label: '2p_x', n: 2, l: 1, m: 1, basis: 'real' as const },
    { id: 'p2py', label: '2p_y', n: 2, l: 1, m: -1, basis: 'real' as const },
    { id: 'p3dz2', label: '3d_z2', n: 3, l: 2, m: 0, basis: 'real' as const },
    { id: '3d-complex', label: '3d, m=2', n: 3, l: 2, m: 2, basis: 'complex' as const },
  ],
  mixtures: [
    {
      id: 'bohr',
      label: '1s + 2p_z',
      terms: '1,0,0,0.7071067811865476;2,1,0,0.7071067811865476',
      period_au: 39.6,
      note: 'Bohr oscillation',
      slice_resolution_floor: 65,
      streamline_seed_count_max: 40,
    },
    {
      id: 'ring',
      label: '2p_+1 + 3d_+2',
      terms: '2,1,1,0.7071067811865476;3,2,2,0.7071067811865476',
      period_au: 12.1,
      note: 'ring current',
      slice_resolution_floor: 65,
      streamline_seed_count_max: 40,
    },
    {
      id: '1s-3dz2',
      label: '1s + 3d_z2',
      terms: '1,0,0,0.7071067811865476;3,2,0,0.7071067811865476',
      period_au: 14.137166941154069,
      note: 'quadrupole breathing',
      slice_resolution_floor: 103,
      streamline_seed_count_max: 24,
    },
  ],
}))

vi.mock('../api/client', () => ({
  fetchCatalog: () => Promise.resolve(CATALOGUE.presets),
  fetchSuperpositionCatalog: () =>
    superpositionCatalogueFailure.current === null
      ? Promise.resolve(
          superpositionCatalogueFailure.omitSelected
            ? CATALOGUE.mixtures.slice(1)
            : CATALOGUE.mixtures,
        )
      : Promise.reject(superpositionCatalogueFailure.current),
}))

const PRISTINE = useSceneStore.getState()

const REAL_ORBITAL: OrbitalParameters = { n: 2, l: 1, m: 0, z: 1, basis: 'real' }
const FLOWING_ORBITAL: OrbitalParameters = { n: 2, l: 1, m: 1, z: 1, basis: 'complex' }

const EVERY_PARAMETER: ParameterId[] = [
  'samples',
  'seed',
  'resolution',
  'probabilityMass',
  'seedCount',
  'timeAu',
]

/** Every representation the panel offers a button for. */
const OFFERED: RepresentationKind[] = ['point_cloud', 'isosurface', 'slice', 'streamlines']

/** Every (mode x representation) cell, with an orbital that makes it interesting. */
const CELLS: [SceneMode, RepresentationKind, OrbitalParameters][] = [
  ['eigenstate', 'point_cloud', REAL_ORBITAL],
  ['eigenstate', 'isosurface', REAL_ORBITAL],
  ['eigenstate', 'slice', REAL_ORBITAL],
  ['eigenstate', 'streamlines', REAL_ORBITAL],
  ['superposition', 'point_cloud', REAL_ORBITAL],
  ['superposition', 'isosurface', REAL_ORBITAL],
  ['superposition', 'slice', REAL_ORBITAL],
  ['superposition', 'streamlines', REAL_ORBITAL],
]

beforeEach(() => {
  capabilityOverride.current = null
  superpositionCatalogueFailure.current = null
  superpositionCatalogueFailure.omitSelected = false
  useSceneStore.setState(PRISTINE, true)
})

async function panel(
  mode: SceneMode,
  representation: RepresentationKind,
  orbital: OrbitalParameters = REAL_ORBITAL,
): Promise<MountedTree> {
  useSceneStore.setState({ mode, representation, orbital })
  const tree = await mount(createElement(ControlPanel))
  // The mocked catalogue resolves during mount and intentionally reconciles
  // an impossible selected cell to a serviceable one. Re-apply the requested
  // cell afterwards: these matrix tests need to inspect refused explanation
  // actions as well as the states the reconciler can select in production.
  await interact(() => useSceneStore.setState({ mode, representation, orbital }))
  return tree
}

function panelCapability(
  mode: SceneMode,
  orbital: OrbitalParameters,
  representation: RepresentationKind,
): Capability {
  const state = useSceneStore.getState()
  return capabilityFor({
    mode,
    orbital,
    representation,
    superpositionSliceResolutionFloor: state.superpositionSliceResolutionFloor,
    superpositionStreamlineSeedCountMax: state.superpositionStreamlineSeedCountMax,
  })
}

function representationButton(tree: MountedTree, id: RepresentationKind): HTMLButtonElement {
  const button = tree.container.querySelector<HTMLButtonElement>(
    `button[data-representation="${id}"]`,
  )
  if (button === null) throw new Error(`no representation button for ${id}`)
  return button
}

function isUnavailable(button: HTMLButtonElement): boolean {
  return button.dataset.unavailable === 'true'
}

function parameterInput(tree: MountedTree, id: ParameterId): HTMLInputElement | null {
  return tree.container.querySelector<HTMLInputElement>(`input[data-parameter="${id}"]`)
}

/** The enumerated-choice counterpart of `parameterInput`. */
function choiceGroup(tree: MountedTree, choice: 'plane' | 'observable'): HTMLElement | null {
  return tree.container.querySelector<HTMLElement>(`[data-choice="${choice}"]`)
}

function choiceButtons(
  tree: MountedTree,
  choice: 'plane' | 'observable',
): HTMLButtonElement[] {
  const group = choiceGroup(tree, choice)
  if (group === null) throw new Error(`no ${choice} picker on screen`)
  return Array.from(group.querySelectorAll<HTMLButtonElement>('button[data-choice-value]'))
}

function choiceValues(tree: MountedTree, choice: 'plane' | 'observable'): string[] {
  return choiceButtons(tree, choice).map((button) => button.dataset.choiceValue ?? '')
}

describe('ControlPanel representation buttons read the capability matrix', () => {
  it.each(CELLS)(
    '%s / %s: marks refused cells without disabling their explanation action',
    async (mode, representation, orbital) => {
      // The selected representation is deliberately the one under test, so the
      // cell is exercised as both "the button" and "the current scene".
      const tree = await panel(mode, representation, orbital)
      try {
        const expected = panelCapability(mode, orbital, representation)
        const button = representationButton(tree, representation)

        expect(isUnavailable(button)).toBe(expected.status !== 'available')
        // A refused choice is an explanation action, so assistive technology
        // must not expose it as disabled and block activation.
        expect(button.disabled).toBe(false)
        expect(button.getAttribute('aria-disabled')).toBeNull()
        if (expected.status === 'available') {
          expect(button.title.length).toBeGreaterThan(0)
        } else {
          expect(button.title).toBe(expected.reason)
        }
      } finally {
        await tree.unmount()
      }
    },
  )

  it.each(CELLS)(
    '%s / %s: every OTHER button in the same panel follows the matrix too',
    async (mode, selected, orbital) => {
      const tree = await panel(mode, selected, orbital)
      try {
        for (const representation of OFFERED) {
          const expected = panelCapability(mode, orbital, representation)
          const button = representationButton(tree, representation)
          expect(isUnavailable(button), representation).toBe(expected.status !== 'available')
          if (expected.status !== 'available') {
            expect(button.title, representation).toBe(expected.reason)
          }
        }
      } finally {
        await tree.unmount()
      }
    },
  )

  it('marks the superposition point cloud unavailable and says it was never built', async () => {
    const tree = await panel('superposition', 'isosurface')
    try {
      const button = representationButton(tree, 'point_cloud')
      expect(isUnavailable(button)).toBe(true)
      expect(button.getAttribute('aria-label')).toContain('电子云暂不可用')
      expect(button.title).toContain('尚未实现')
      expect(button.title).toContain('/api/orbitals/point-cloud')
      expect(button.title).toContain('|Ψ(t)|²')
      // "not implemented" is not "unsupported": the panel must not claim the
      // physics forbids a time-dependent point cloud.
      expect(button.title).toContain('这不是 physics 限制')
    } finally {
      await tree.unmount()
    }
  })

  it.each([
    ['eigenstate', 'isosurface'],
    ['eigenstate', 'slice'],
    ['superposition', 'isosurface'],
    ['superposition', 'slice'],
  ] as const)('%s / %s exposes and persistently explains server validation', async (mode, representation) => {
    const tree = await panel(mode, representation)
    try {
      const button = representationButton(tree, representation)
      const notice = tree.container.querySelector<HTMLElement>(
        `[data-server-validation-notice="${representation}"]`,
      )

      expect(button.dataset.serverValidation).toBe('required')
      expect(button.getAttribute('aria-label')).toContain('需服务端数值验证')
      expect(button.getAttribute('aria-describedby')).toBe(
        'representation-server-validation-notice',
      )
      expect(notice?.textContent).toContain('需服务端数值验证')
      expect(notice?.textContent).toContain('fail-closed')
      expect(useSceneStore.getState().representation).toBe(representation)
    } finally {
      await tree.unmount()
    }
  })
})

describe('probability-flow discovery', () => {
  it('shows a persistent reason on focus and never rewrites the state from the refused button', async () => {
    const tree = await panel('eigenstate', 'point_cloud', REAL_ORBITAL)
    try {
      const button = representationButton(tree, 'streamlines')
      const before = useSceneStore.getState().orbital

      await interact(() => button.focus())

      const notice = tree.container.querySelector<HTMLElement>(
        '[data-representation-notice="streamlines"]',
      )
      expect(notice?.textContent).toContain('complex basis')
      expect(button.getAttribute('aria-describedby')).toBe('representation-availability-notice')

      await press(button, 'the refused probability-flow button')
      expect(useSceneStore.getState().orbital).toEqual(before)
      expect(useSceneStore.getState().representation).toBe('point_cloud')
      expect(
        tree.container.querySelector('[data-representation-notice="streamlines"]'),
      ).not.toBeNull()
    } finally {
      await tree.unmount()
    }
  })

  it('offers an explicit example that selects, rather than silently invents, a flowing state', async () => {
    const tree = await panel('eigenstate', 'point_cloud', REAL_ORBITAL)
    try {
      const action = tree.container.querySelector<HTMLButtonElement>('[data-flow-example]')
      expect(action?.textContent).toContain('3d, m=2 · complex')

      await press(action, 'the explicit probability-flow example')

      expect(useSceneStore.getState().orbital).toEqual({
        n: 3,
        l: 2,
        m: 2,
        z: 1,
        basis: 'complex',
      })
      expect(useSceneStore.getState().representation).toBe('streamlines')
      expect(tree.container.querySelector('[data-flow-example]')).toBeNull()
    } finally {
      await tree.unmount()
    }
  })

  it('takes the flowing example from the fetched catalogue instead of a local duplicate', async () => {
    const example = CATALOGUE.presets.find((preset) => preset.id === '3d-complex')
    if (example === undefined) throw new Error('test catalogue has no flow example')
    const original = { ...example }
    Object.assign(example, { n: 2, l: 1, m: 1, label: 'catalogue flow control' })

    const tree = await panel('eigenstate', 'point_cloud', REAL_ORBITAL)
    try {
      const action = tree.container.querySelector<HTMLButtonElement>('[data-flow-example]')
      expect(action?.textContent).toContain('catalogue flow control')

      await press(action, 'the catalogue-derived probability-flow example')

      expect(useSceneStore.getState().orbital).toEqual({
        n: 2,
        l: 1,
        m: 1,
        z: 1,
        basis: 'complex',
      })
    } finally {
      await tree.unmount()
      Object.assign(example, original)
    }
  })

  it('hides the shortcut when the named catalogue preset cannot produce flow', async () => {
    const example = CATALOGUE.presets.find((preset) => preset.id === '3d-complex')
    if (example === undefined) throw new Error('test catalogue has no flow example')
    const original = { ...example }
    Object.assign(example, { basis: 'real' as const })

    const tree = await panel('eigenstate', 'point_cloud', REAL_ORBITAL)
    try {
      expect(tree.container.querySelector('[data-flow-example]')).toBeNull()
    } finally {
      await tree.unmount()
      Object.assign(example, original)
    }
  })
})

describe('ControlPanel follows a matrix that moves underneath it', () => {
  it('disables a cell the matrix newly refuses, with the new reason', async () => {
    const reason = 'sabotage: this cell is closed for the duration of this test.'
    capabilityOverride.current = (inputs) =>
      inputs.mode === 'eigenstate' && inputs.representation === 'point_cloud'
        ? { status: 'not_implemented', reason }
        : { status: 'available', endpoint: '/x', parameters: {}, latency: 'fast' }

    const tree = await mount(createElement(ControlPanel))
    try {
      const button = representationButton(tree, 'point_cloud')
      expect(isUnavailable(button)).toBe(true)
      expect(button.title).toBe(reason)
    } finally {
      await tree.unmount()
    }
  })

  it('enables a cell the matrix newly allows, however the physics reads', async () => {
    // The real matrix refuses streamlines for a real-basis m = 0 orbital, and
    // the panel used to carry that rule as its own `currentAvailable` local.
    capabilityOverride.current = () => ({
      status: 'available',
      endpoint: '/x',
      parameters: {},
      latency: 'slow',
    })

    const tree = await panel('eigenstate', 'point_cloud', REAL_ORBITAL)
    try {
      expect(isUnavailable(representationButton(tree, 'streamlines'))).toBe(false)
      expect(isUnavailable(representationButton(tree, 'isosurface'))).toBe(false)
    } finally {
      await tree.unmount()
    }
  })

  it('refuses an isosurface the matrix closes for a reason of its own', async () => {
    const reason = 'sabotage: the isosurface route is out of range for this state.'
    capabilityOverride.current = (inputs) =>
      inputs.representation === 'isosurface'
        ? { status: 'unsupported', reason }
        : { status: 'available', endpoint: '/x', parameters: {}, latency: 'fast' }

    const tree = await mount(createElement(ControlPanel))
    try {
      const button = representationButton(tree, 'isosurface')
      expect(isUnavailable(button)).toBe(true)
      expect(button.title).toBe(reason)
    } finally {
      await tree.unmount()
    }
  })
})

describe('ControlPanel sliders are the capability matrix bounds', () => {
  it.each([
    ['eigenstate', 'point_cloud', REAL_ORBITAL],
    ['eigenstate', 'isosurface', { n: 3, l: 1, m: 0, z: 1, basis: 'real' } as OrbitalParameters],
    ['eigenstate', 'slice', { n: 5, l: 1, m: 0, z: 1, basis: 'real' } as OrbitalParameters],
    ['eigenstate', 'streamlines', FLOWING_ORBITAL],
    ['superposition', 'point_cloud', REAL_ORBITAL],
    ['superposition', 'isosurface', REAL_ORBITAL],
    ['superposition', 'slice', REAL_ORBITAL],
    ['superposition', 'streamlines', REAL_ORBITAL],
  ] as [SceneMode, RepresentationKind, OrbitalParameters][])(
    '%s / %s: exactly the declared parameters, at exactly the declared bounds',
    async (mode, representation, orbital) => {
      const tree = await panel(mode, representation, orbital)
      try {
        const state = useSceneStore.getState()
        const capability = capabilityFor({
          mode,
          orbital,
          representation,
          superpositionSliceResolutionFloor: state.superpositionSliceResolutionFloor,
          superpositionStreamlineSeedCountMax:
            state.superpositionStreamlineSeedCountMax,
        })
        const bounds = capability.status === 'available' ? capability.parameters : {}
        for (const id of EVERY_PARAMETER) {
          const bound = bounds[id]
          const input = parameterInput(tree, id)
          if (bound === undefined) {
            expect(input, `${id} must not be offered here`).toBeNull()
            continue
          }
          if (input === null) throw new Error(`${id} slider is missing`)
          expect(input.type).toBe('range')
          expect(input.min, `${id} min`).toBe(String(bound.min))
          expect(input.max, `${id} max`).toBe(String(bound.max))
          expect(input.step, `${id} step`).toBe(String(bound.step))
        }
      } finally {
        await tree.unmount()
      }
    },
  )

  it('caps the seed count at 40 in superposition and 96 for an eigenstate', async () => {
    const timeDependent = await panel('superposition', 'streamlines')
    try {
      expect(parameterInput(timeDependent, 'seedCount')?.max).toBe('40')
    } finally {
      await timeDependent.unmount()
    }

    const stationary = await panel('eigenstate', 'streamlines', FLOWING_ORBITAL)
    try {
      expect(parameterInput(stationary, 'seedCount')?.max).toBe('96')
    } finally {
      await stationary.unmount()
    }
  })

  it('floors the grid at the route minimum in superposition, not at 16n + 17', async () => {
    // The eigenstate rule (16n + 17) is about ONE n. A superposition has no
    // single n, so carrying the rule over refuses grids its route accepts.
    const timeDependent = await panel('superposition', 'isosurface', {
      n: 4,
      l: 1,
      m: 0,
      z: 1,
      basis: 'real',
    })
    try {
      expect(parameterInput(timeDependent, 'resolution')?.min).toBe('49')
    } finally {
      await timeDependent.unmount()
    }

    const stationary = await panel('eigenstate', 'isosurface', {
      n: 3,
      l: 1,
      m: 0,
      z: 1,
      basis: 'real',
    })
    try {
      expect(parameterInput(stationary, 'resolution')?.min).toBe('65')
    } finally {
      await stationary.unmount()
    }
  })

  it('offers no request slider at all for a cell the matrix refuses', async () => {
    const tree = await panel('superposition', 'point_cloud')
    try {
      expect(tree.container.querySelectorAll('input[data-parameter]')).toHaveLength(0)
    } finally {
      await tree.unmount()
    }
  })

  it('offers a clock only where the matrix declares one', async () => {
    const stationary = await panel('eigenstate', 'point_cloud')
    try {
      expect(parameterInput(stationary, 'timeAu')).toBeNull()
      expect(stationary.container.querySelector('[data-control="playback"]')).toBeNull()
    } finally {
      await stationary.unmount()
    }

    const timeDependent = await panel('superposition', 'isosurface')
    try {
      expect(parameterInput(timeDependent, 'timeAu')).not.toBeNull()
      expect(timeDependent.container.querySelector('[data-control="playback"]')).not.toBeNull()
    } finally {
      await timeDependent.unmount()
    }
  })
})

/**
 * The enumerated choices are governed the same way the numeric ones are: the
 * capability declares them or the panel does not offer them.
 *
 * `planes` and `observables` are not a slice-shaped exception to the bound
 * mechanism -- they are the same statement about a cell, made with a list
 * instead of an interval -- so the panel must read them the same way and never
 * test `representation === 'slice'` for itself.
 */
describe('ControlPanel plane and observable pickers read the capability matrix', () => {
  it.each(CELLS)(
    '%s / %s: a picker exists exactly where the cell declares the choice',
    async (mode, representation, orbital) => {
      const tree = await panel(mode, representation, orbital)
      try {
        const capability = panelCapability(mode, orbital, representation)
        const declared = capability.status === 'available' ? capability : undefined
        for (const [choice, options] of [
          ['plane', declared?.planes],
          ['observable', declared?.observables],
        ] as const) {
          const group = choiceGroup(tree, choice)
          if (options === undefined) {
            expect(group, `${choice} must not be offered here`).toBeNull()
            continue
          }
          if (group === null) throw new Error(`${choice} picker is missing`)
          expect(choiceValues(tree, choice), choice).toEqual([...options])
        }
      } finally {
        await tree.unmount()
      }
    },
  )

  it('offers every principal plane and every observable the contract names', async () => {
    const tree = await panel('eigenstate', 'slice')
    try {
      expect(choiceValues(tree, 'plane')).toEqual([...PRINCIPAL_PLANES])
      expect(choiceValues(tree, 'observable')).toEqual([...SLICE_OBSERVABLES])
    } finally {
      await tree.unmount()
    }
  })

  it('marks the standing plane and observable as the active choice', async () => {
    useSceneStore.setState({ plane: 'yz', sliceObservable: 'phase' })
    const tree = await panel('eigenstate', 'slice')
    try {
      const active = (choice: 'plane' | 'observable'): string[] =>
        choiceButtons(tree, choice)
          .filter((button) => button.className.includes('active'))
          .map((button) => button.dataset.choiceValue ?? '')
      expect(active('plane')).toEqual(['yz'])
      expect(active('observable')).toEqual(['phase'])
    } finally {
      await tree.unmount()
    }
  })

  it('offers no picker at all for a cell that cuts no plane', async () => {
    // The gate is the capability's, not the representation name's. A picker
    // here would spell a `plane=` onto a request whose route has no plane to
    // read, which is a 422 the matrix promised could not happen.
    const tree = await panel('eigenstate', 'isosurface')
    try {
      expect(choiceGroup(tree, 'plane')).toBeNull()
      expect(choiceGroup(tree, 'observable')).toBeNull()
    } finally {
      await tree.unmount()
    }
  })

  it('follows a matrix that newly declares the choice on another cell', async () => {
    capabilityOverride.current = () => ({
      status: 'available',
      endpoint: '/x',
      parameters: {},
      latency: 'fast',
      planes: ['yz'],
      observables: ['phase'],
    })

    const tree = await panel('eigenstate', 'point_cloud')
    try {
      expect(choiceValues(tree, 'plane')).toEqual(['yz'])
      expect(choiceValues(tree, 'observable')).toEqual(['phase'])
    } finally {
      await tree.unmount()
    }
  })
})

describe('ControlPanel superposition read-outs', () => {
  it('shows the basis, Z and a_mu the request will actually carry, read-only', async () => {
    useSceneStore.setState({ superpositionBasis: 'complex', aMu: 1.0 })
    const tree = await panel('superposition', 'isosurface')
    try {
      const basis = tree.container.querySelector('[data-readonly="basis"]')
      const z = tree.container.querySelector('[data-readonly="z"]')
      const aMu = tree.container.querySelector('[data-readonly="a_mu"]')
      expect(basis?.textContent).toBe('complex')
      expect(z?.textContent).toBe('1')
      expect(aMu?.textContent).toBe('1')
      // Read-only means read-only: not an input, and not a slider elsewhere.
      for (const node of [basis, z, aMu]) {
        expect(node?.tagName).toBe('DD')
      }
      expect(parameterInput(tree, 'samples' as ParameterId)).toBeNull()
      expect(tree.container.querySelector('input[data-parameter="aMu"]')).toBeNull()
      expect(tree.container.querySelector('input[name="a_mu"]')).toBeNull()
    } finally {
      await tree.unmount()
    }
  })

  it('does not show the superposition read-outs for an eigenstate', async () => {
    const tree = await panel('eigenstate', 'point_cloud')
    try {
      expect(tree.container.querySelector('[data-readonly="basis"]')).toBeNull()
      expect(tree.container.querySelector('[data-readonly="a_mu"]')).toBeNull()
    } finally {
      await tree.unmount()
    }
  })

  /**
   * a_mu is read out iff the request carries one -- not iff the mode is
   * superposition.
   *
   * The gate used to be the superposition block this read-out happened to live
   * in, written when a_mu reached only the two superposition routes. Four routes
   * read it now, and an EIGENSTATE SLICE was sending a reduced mass that nothing
   * on screen stated: the panel showed a hydrogenic label while the server was
   * asked for a different particle's length scale.
   */
  it.each(CELLS)(
    '%s / %s: reads a_mu out exactly when the plan carries one',
    async (mode, representation, orbital) => {
      useSceneStore.setState({ aMu: 0.0054 })
      const tree = await panel(mode, representation, orbital)
      try {
        const readout = tree.container.querySelector('[data-readonly="a_mu"]')
        const plan = planSceneRequest({
          ...useSceneStore.getState(),
          mode,
          orbital,
          representation,
        })
        const carried = plan.status === 'available' ? plan.params.a_mu : undefined
        if (carried === undefined) {
          expect(readout, `${mode} x ${representation}`).toBeNull()
          return
        }
        expect(readout?.tagName).toBe('DD')
        expect(readout?.textContent).toBe(String(carried))
      } finally {
        await tree.unmount()
      }
    },
  )

  it('reads a_mu out for an eigenstate slice, which sends it', async () => {
    useSceneStore.setState({ aMu: 0.0054 })
    const tree = await panel('eigenstate', 'slice')
    try {
      expect(tree.container.querySelector('[data-readonly="a_mu"]')?.textContent).toBe('0.0054')
      // Still read-only, and still not a slider: the reason a_mu has no control
      // is unchanged by which route reads it.
      expect(tree.container.querySelector('input[data-parameter="aMu"]')).toBeNull()
    } finally {
      await tree.unmount()
    }
  })

  it('shows the CLAMPED a_mu the request will carry, not the store value', async () => {
    // The route's bound is `gt=0`, and the plan clamps to the declared floor.
    // A read-out taken from the store would name a value the wire never saw.
    useSceneStore.setState({ aMu: 0 })
    const tree = await panel('eigenstate', 'slice')
    try {
      expect(tree.container.querySelector('[data-readonly="a_mu"]')?.textContent).toBe('0.005')
    } finally {
      await tree.unmount()
    }
  })
})

/**
 * Drive a control the way the browser does, and let React finish.
 *
 * Two things are needed and each closes a different gap. React attaches one
 * delegated listener at the root and reads the value off the element, so
 * assigning `input.value = x` directly is invisible to it: React's own value
 * tracker sees no change and swallows the event. Going through the prototype
 * setter is what makes the dispatched event carry the new value.
 *
 * And the resulting store write has to be flushed before the DOM is read.
 * Measured: without the `act` wrapper, pressing "Superposition" moved the store
 * to superposition while the panel on screen still showed the eigenstate
 * controls, so an assertion about the rendered mixture list read the PREVIOUS
 * render and failed for a reason that had nothing to do with the panel.
 * `mount()` runs its own renders inside `act` and removes the flag again
 * afterwards, so a spec that drives an already-mounted tree has to reinstate it
 * for the duration of the interaction.
 */
async function interact(body: () => void): Promise<void> {
  const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const had = 'IS_REACT_ACT_ENVIRONMENT' in scope
  const previous = scope.IS_REACT_ACT_ENVIRONMENT
  scope.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await act(async () => {
      body()
    })
  } finally {
    if (had) {
      scope.IS_REACT_ACT_ENVIRONMENT = previous
    } else {
      delete scope.IS_REACT_ACT_ENVIRONMENT
    }
  }
}

async function press(element: HTMLElement | null, what: string): Promise<void> {
  if (element === null) throw new Error(`no ${what} to press`)
  await interact(() => element.click())
}

async function setValue(
  element: HTMLInputElement | HTMLSelectElement | null,
  what: string,
  value: string,
): Promise<void> {
  if (element === null) throw new Error(`no ${what} control on screen`)
  const prototype =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (setter === undefined) throw new Error('no value setter on the element prototype')
  await interact(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('ControlPanel controls write to the store', () => {
  it('hides eigenstate quantum controls and reports the shared superposition charge', async () => {
    useSceneStore.setState({ superpositionZ: 4 })
    const tree = await panel('superposition', 'isosurface', {
      ...REAL_ORBITAL,
      z: 2.5,
    })
    try {
      expect(
        tree.container.querySelector('[data-control-section="eigenstate-quantum-numbers"]'),
      ).toBeNull()
      expect(tree.container.querySelector('[data-readonly="z"]')?.textContent).toBe('4')

      const selected = selectSceneRequestInputs(useSceneStore.getState())
      expect(planSceneRequest(selected)).toMatchObject({
        status: 'available',
        params: { z: 4 },
      })
    } finally {
      await tree.unmount()
    }
  })

  it('applies a catalogue preset and restores the default one', async () => {
    const tree = await panel('eigenstate', 'point_cloud')
    try {
      const presets = tree.container.querySelectorAll<HTMLButtonElement>('.preset-strip .preset')
      expect(presets).toHaveLength(7)
      expect(presets[0].className).toContain('active')
      expect(presets[6].textContent).toContain('3d, m=2')

      await press(presets[1], 'the second preset')
      expect(useSceneStore.getState().orbital).toMatchObject({ n: 3, l: 2, m: -2 })

      await press(tree.container.querySelector('.round-button'), 'the reset button')
      expect(useSceneStore.getState().orbital).toMatchObject({ n: 2, l: 1, m: 0, basis: 'real' })
    } finally {
      await tree.unmount()
    }
  })

  it('does not leave the state reset action in non-state contexts', async () => {
    const tree = await mount(createElement(ControlPanel, { activeContext: 'representation' }))
    try {
      expect(tree.container.querySelector('.reset-state-button')).toBeNull()

      await tree.update(createElement(ControlPanel, { activeContext: 'display' }))
      expect(tree.container.querySelector('.reset-state-button')).toBeNull()

      await tree.update(createElement(ControlPanel, { activeContext: 'state' }))
      const reset = tree.container.querySelector<HTMLButtonElement>('.reset-state-button')
      expect(reset).not.toBeNull()
      expect(reset?.hasAttribute('hidden')).toBe(false)
      expect(reset?.tabIndex).toBe(0)
    } finally {
      await tree.unmount()
    }
  })

  it('edits every quantum number and the basis', async () => {
    const tree = await panel('eigenstate', 'point_cloud')
    try {
      const selects = (): NodeListOf<HTMLSelectElement> =>
        tree.container.querySelectorAll<HTMLSelectElement>('.quantum-grid select')
      await setValue(selects()[0], 'n', '4')
      expect(useSceneStore.getState().orbital.n).toBe(4)
      await setValue(selects()[1], 'l', '2')
      expect(useSceneStore.getState().orbital.l).toBe(2)
      await setValue(selects()[2], 'm', '-1')
      expect(useSceneStore.getState().orbital.m).toBe(-1)

      await setValue(
        tree.container.querySelector<HTMLInputElement>('.quantum-grid input[type="number"]'),
        'Z',
        '2.5',
      )
      expect(useSceneStore.getState().orbital.z).toBe(2.5)

      const basis = (): NodeListOf<HTMLButtonElement> =>
        tree.container.querySelectorAll<HTMLButtonElement>('.segmented button')
      await press(basis()[1], 'the complex basis button')
      expect(useSceneStore.getState().orbital.basis).toBe('complex')
      await press(basis()[0], 'the real basis button')
      expect(useSceneStore.getState().orbital.basis).toBe('real')
    } finally {
      await tree.unmount()
    }
  })

  it('switches state kind, picks a mixture and toggles playback', async () => {
    const tree = await panel('eigenstate', 'point_cloud')
    try {
      const kind = (): NodeListOf<HTMLButtonElement> =>
        tree.container.querySelectorAll<HTMLButtonElement>(
          '.control-section .representation-switch button',
        )
      await press(kind()[1], 'the superposition button')
      expect(useSceneStore.getState().mode).toBe('superposition')

      const mixtures = tree.container.querySelectorAll<HTMLButtonElement>('.mixture-list .preset')
      expect(mixtures).toHaveLength(3)
      expect(mixtures[0].className).toContain('active')
      await press(mixtures[1], 'the second mixture')
      expect(useSceneStore.getState().superpositionTerms).toBe(CATALOGUE.mixtures[1].terms)

      const playback = (): HTMLButtonElement | null =>
        tree.container.querySelector<HTMLButtonElement>('[data-control="playback"]')
      await press(playback(), 'the playback toggle')
      expect(useSceneStore.getState().playing).toBe(true)
      await press(playback(), 'the playback toggle')
      expect(useSceneStore.getState().playing).toBe(false)

      await press(kind()[0], 'the eigenstate button')
      expect(useSceneStore.getState().mode).toBe('eigenstate')
    } finally {
      await tree.unmount()
    }
  })

  it('uses the selected catalogue floor before the first mixed-state slice plan', async () => {
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'slice',
      resolution: 65,
      superpositionSliceResolutionFloor: 65,
    })
    const tree = await mount(createElement(ControlPanel))
    try {
      const mixtures = tree.container.querySelectorAll<HTMLButtonElement>('.mixture-list .preset')
      await press(mixtures[2], 'the 1s + 3d_z2 mixture')

      const state = useSceneStore.getState()
      expect(state.superpositionTerms).toBe(CATALOGUE.mixtures[2].terms)
      expect(state.superpositionSliceResolutionFloor).toBe(103)
      expect(state.resolution).toBe(103)
      expect(parameterInput(tree, 'resolution')?.min).toBe('103')
      expect(parameterInput(tree, 'resolution')?.value).toBe('103')
      expect(planSceneRequest(selectSceneRequestInputs(state))).toMatchObject({
        status: 'available',
        endpoint: '/api/superposition/slice',
        params: { resolution: 103 },
      })
    } finally {
      await tree.unmount()
    }
  })

  it('uses the selected catalogue seed ceiling before the first streamline plan', async () => {
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'streamlines',
      seedCount: 40,
      superpositionStreamlineSeedCountMax: 40,
    })
    const tree = await mount(createElement(ControlPanel))
    try {
      const mixtures = tree.container.querySelectorAll<HTMLButtonElement>('.mixture-list .preset')
      await press(mixtures[2], 'the 1s + 3d_z2 mixture')

      const state = useSceneStore.getState()
      expect(state.superpositionTerms).toBe(CATALOGUE.mixtures[2].terms)
      expect(state.superpositionStreamlineSeedCountMax).toBe(24)
      expect(state.seedCount).toBe(24)
      expect(parameterInput(tree, 'seedCount')?.max).toBe('24')
      expect(parameterInput(tree, 'seedCount')?.value).toBe('24')
      expect(planSceneRequest(selectSceneRequestInputs(state))).toMatchObject({
        status: 'available',
        endpoint: '/api/superposition/current-field',
        params: { seed_count: 24 },
      })
    } finally {
      await tree.unmount()
    }
  })

  it('invalidates stale seed metadata when the catalogue request or parser rejects', async () => {
    superpositionCatalogueFailure.current = new Error('catalogue unavailable or corrupt')
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'streamlines',
      seedCount: 24,
      superpositionStreamlineSeedCountMax: 24,
    })

    const tree = await mount(createElement(ControlPanel))
    try {
      const state = useSceneStore.getState()
      expect(tree.container.querySelectorAll('.mixture-list .preset')).toHaveLength(0)
      expect(state.superpositionStreamlineSeedCountMax).toBeUndefined()
      expect(state.representation).toBe('isosurface')
      expect(representationButton(tree, 'streamlines').dataset.unavailable).toBe('true')
      expect(planSceneRequest(selectSceneRequestInputs(state))).toMatchObject({
        status: 'available',
        endpoint: '/api/superposition/isosurface',
      })
    } finally {
      await tree.unmount()
    }
  })

  it('invalidates stale seed metadata when the catalogue omits the selected mixture', async () => {
    superpositionCatalogueFailure.omitSelected = true
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'streamlines',
      seedCount: 24,
      superpositionStreamlineSeedCountMax: 24,
    })

    const tree = await mount(createElement(ControlPanel))
    try {
      const state = useSceneStore.getState()
      expect(state.superpositionStreamlineSeedCountMax).toBeUndefined()
      expect(state.representation).toBe('isosurface')
      expect(planSceneRequest(selectSceneRequestInputs(state))).toMatchObject({
        status: 'available',
        endpoint: '/api/superposition/isosurface',
      })
    } finally {
      await tree.unmount()
    }
  })

  it('selects an available representation when its button is pressed', async () => {
    const tree = await panel('eigenstate', 'point_cloud')
    try {
      await press(representationButton(tree, 'isosurface'), 'the isosurface button')
      expect(useSceneStore.getState().representation).toBe('isosurface')
      await press(representationButton(tree, 'point_cloud'), 'the point cloud button')
      expect(useSceneStore.getState().representation).toBe('point_cloud')
    } finally {
      await tree.unmount()
    }
  })

  it('shows exactly the resolution the newly selected representation sends', async () => {
    useSceneStore.setState({
      mode: 'eigenstate',
      representation: 'slice',
      orbital: REAL_ORBITAL,
      resolution: 129,
    })
    const tree = await mount(createElement(ControlPanel))
    try {
      await press(representationButton(tree, 'isosurface'), 'the isosurface button')

      const resolution = parameterInput(tree, 'resolution')
      const plan = planSceneRequest(selectSceneRequestInputs(useSceneStore.getState()))
      expect(useSceneStore.getState().resolution).toBe(81)
      expect(resolution?.value).toBe('81')
      expect(resolution?.closest('label')?.querySelector('.control-value')?.textContent).toBe('81')
      expect(plan).toMatchObject({ status: 'available', params: { resolution: 81 } })
    } finally {
      await tree.unmount()
    }
  })

  it('writes each request parameter the cell declares', async () => {
    const cloud = await panel('eigenstate', 'point_cloud')
    try {
      await setValue(parameterInput(cloud, 'samples'), 'samples', '40000')
      expect(useSceneStore.getState().samples).toBe(40000)
      await setValue(parameterInput(cloud, 'seed'), 'seed', '11')
      expect(useSceneStore.getState().seed).toBe(11)
    } finally {
      await cloud.unmount()
    }

    const surface = await panel('superposition', 'isosurface')
    try {
      await setValue(parameterInput(surface, 'resolution'), 'resolution', '73')
      expect(useSceneStore.getState().resolution).toBe(73)
      await setValue(parameterInput(surface, 'probabilityMass'), 'mass', '0.75')
      expect(useSceneStore.getState().probabilityMass).toBe(0.75)
      const clock = parameterInput(surface, 'timeAu')
      expect(clock?.step).toBe('0.2')
      expect(clock?.value).toBe('0')
      expect(clock?.validity.stepMismatch).toBe(false)
      await setValue(clock, 'time', '8.4')
      expect(clock?.value).toBe('8.4')
      expect(clock?.validity.stepMismatch).toBe(false)
      expect(useSceneStore.getState().timeAu).toBe(8.4)
    } finally {
      await surface.unmount()
    }

    const flow = await panel('superposition', 'streamlines')
    try {
      await setValue(parameterInput(flow, 'seedCount'), 'seed count', '36')
      expect(useSceneStore.getState().seedCount).toBe(36)
    } finally {
      await flow.unmount()
    }
  })

  it('writes the plane and the observable the slice is cut with', async () => {
    const tree = await panel('eigenstate', 'slice')
    try {
      const button = (choice: 'plane' | 'observable', value: string): HTMLButtonElement => {
        const found = choiceButtons(tree, choice).find(
          (candidate) => candidate.dataset.choiceValue === value,
        )
        if (found === undefined) throw new Error(`no ${choice} button for ${value}`)
        return found
      }
      await press(button('plane', 'yz'), 'the yz plane')
      expect(useSceneStore.getState().plane).toBe('yz')
      await press(button('plane', 'xy'), 'the xy plane')
      expect(useSceneStore.getState().plane).toBe('xy')

      await press(button('observable', 'phase'), 'the phase observable')
      expect(useSceneStore.getState().sliceObservable).toBe('phase')
      await press(button('observable', 'wavefunction_real'), 'the Re psi observable')
      expect(useSceneStore.getState().sliceObservable).toBe('wavefunction_real')
    } finally {
      await tree.unmount()
    }
  })

  it('selects the slice representation when its button is pressed', async () => {
    const tree = await panel('eigenstate', 'point_cloud')
    try {
      await press(representationButton(tree, 'slice'), 'the slice button')
      expect(useSceneStore.getState().representation).toBe('slice')
    } finally {
      await tree.unmount()
    }
  })

  it.each<[
    RepresentationKind,
    string[],
    string[],
  ]>([
    ['point_cloud', ['pointSize', 'opacity'], ['点尺寸', '透明度']],
    ['isosurface', ['opacity'], ['透明度']],
    ['slice', ['bloom'], ['Bloom']],
    ['streamlines', ['opacity', 'fog', 'bloom'], ['透明度', '雾强度', 'Bloom']],
  ])('%s exposes exactly the display controls its renderer consumes', async (
    representation,
    expectedControls,
    expectedLabels,
  ) => {
    const tree = await panel('eigenstate', representation, FLOWING_ORBITAL)
    try {
      const section = tree.container.querySelector<HTMLElement>('.display-section')
      if (section === null) throw new Error('no display section on screen')
      const controls = Array.from(
        section.querySelectorAll<HTMLInputElement>('input[data-display]'),
      )

      expect(controls.map((control) => control.dataset.display)).toEqual(expectedControls)
      expect(section.textContent).toContain('显示')
      for (const label of expectedLabels) expect(section.textContent).toContain(label)

      // Tone mapping is not yet an audited renderer contract. It therefore
      // stays internal for every representation instead of becoming a false
      // affordance in this otherwise renderer-specific control group.
      expect(section.querySelector('input[data-display="exposure"]')).toBeNull()
    } finally {
      await tree.unmount()
    }
  })

  it('writes each effective rendering knob to the local store only', async () => {
    const cloud = await panel('eigenstate', 'point_cloud')
    try {
      const knob = (name: string): HTMLInputElement | null =>
        cloud.container.querySelector<HTMLInputElement>(`input[data-display="${name}"]`)
      await setValue(knob('pointSize'), 'point size', '4.2')
      expect(useSceneStore.getState().pointSize).toBe(4.2)
      await setValue(knob('opacity'), 'opacity', '60')
      expect(useSceneStore.getState().opacity).toBeCloseTo(0.6, 10)
    } finally {
      await cloud.unmount()
    }

    const flow = await panel('eigenstate', 'streamlines', FLOWING_ORBITAL)
    try {
      const knob = (name: string): HTMLInputElement | null =>
        flow.container.querySelector<HTMLInputElement>(`input[data-display="${name}"]`)
      await setValue(knob('fog'), 'fog', '40')
      expect(useSceneStore.getState().fogStrength).toBeCloseTo(0.4, 10)
      await setValue(knob('bloom'), 'bloom', '30')
      expect(useSceneStore.getState().bloom).toBeCloseTo(0.3, 10)
    } finally {
      await flow.unmount()
    }
  })

  it('uses Chinese narrative labels while preserving scientific notation and terms', async () => {
    const tree = await panel('superposition', 'slice')
    try {
      const text = tree.container.textContent ?? ''

      for (const label of [
        '态制备',
        '轨道与表示设置',
        '态构成',
        '本征态',
        '叠加态',
        '表示法',
        '电子云',
        '等密度面',
        '平面切片',
        '概率流线',
        '显示',
      ]) {
        expect(text).toContain(label)
      }

      // A superposition is defined by its terms, not by the hidden eigenstate
      // n/l/m controls. Its actual request scales remain visible as readouts.
      expect(text).not.toContain('量子数')
      for (const notation of ['Z', 'aμ']) {
        expect(text).toContain(notation)
      }
      expect(
        tree.container.querySelector<HTMLButtonElement>('button[title="解析含时 eigenstate 叠加"]'),
      ).not.toBeNull()
    } finally {
      await tree.unmount()
    }

    const eigenstate = await panel('eigenstate', 'slice')
    try {
      const text = eigenstate.container.textContent ?? ''
      expect(text).toContain('量子数')
      for (const notation of ['ℓ', '实基 · chemistry', '复基 · Lz']) {
        expect(text).toContain(notation)
      }
    } finally {
      await eigenstate.unmount()
    }
  })

  it('offers bloom only while the requested representation owns a presentation composer', async () => {
    // A complex m=1 state keeps all four representation buttons available, so
    // the test crosses both sides through the same user-facing switch.
    const tree = await panel('eigenstate', 'point_cloud', FLOWING_ORBITAL)
    const bloom = (): HTMLInputElement | null =>
      tree.container.querySelector<HTMLInputElement>('input[data-display="bloom"]')
    try {
      // Point clouds and isosurfaces use their phase legend as a data key; the
      // canvas omits Bloom/Vignette for both, so a mutable Bloom slider would
      // be a control over nothing.
      expect(bloom()).toBeNull()

      await press(representationButton(tree, 'slice'), 'the slice button')
      expect(bloom()).not.toBeNull()

      await press(representationButton(tree, 'isosurface'), 'the isosurface button')
      expect(bloom()).toBeNull()

      await press(representationButton(tree, 'streamlines'), 'the streamlines button')
      expect(bloom()).not.toBeNull()
    } finally {
      await tree.unmount()
    }
  })

  it('toggles the two viewport switches', async () => {
    const tree = await panel('eigenstate', 'point_cloud')
    try {
      const toggles = (): NodeListOf<HTMLButtonElement> =>
        tree.container.querySelectorAll<HTMLButtonElement>('.control-section.compact .toggle-row')
      expect(toggles()).toHaveLength(2)
      await press(toggles()[0], 'auto rotate')
      expect(useSceneStore.getState().autoRotate).toBe(true)
      await press(toggles()[0], 'auto rotate')
      expect(useSceneStore.getState().autoRotate).toBe(false)
      await press(toggles()[1], 'the reference grid')
      expect(useSceneStore.getState().showGrid).toBe(false)
      await press(toggles()[1], 'the reference grid')
      expect(useSceneStore.getState().showGrid).toBe(true)
    } finally {
      await tree.unmount()
    }
  })

  it('advances the clock on its own while playback is on', async () => {
    vi.useFakeTimers()
    try {
      useSceneStore.setState({ mode: 'superposition', representation: 'isosurface', timeAu: 0 })
      const tree = await mount(createElement(ControlPanel))
      try {
        await press(tree.container.querySelector('[data-control="playback"]'), 'playback')
        expect(useSceneStore.getState().playing).toBe(true)
        await vi.advanceTimersByTimeAsync(900)
        // Two ticks of the 0.6 a.u. frame grid, landing exactly on the grid.
        expect(useSceneStore.getState().timeAu).toBe(1.2)
      } finally {
        await tree.unmount()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the selected catalogue period for playback', async () => {
    vi.useFakeTimers()
    try {
      useSceneStore.setState({ mode: 'superposition', representation: 'isosurface', timeAu: 0 })
      const tree = await mount(createElement(ControlPanel))
      try {
        const mixtures = tree.container.querySelectorAll<HTMLButtonElement>('.mixture-list .preset')
        await press(mixtures[1], 'the second mixture')
        await press(tree.container.querySelector('[data-control="playback"]'), 'playback')
        await vi.advanceTimersByTimeAsync(5 * 420 + 1)

        let expected = 0
        let oldFixedPeriod = 0
        for (let frame = 0; frame < 5; frame += 1) {
          expected = nextTimeAu(expected, CATALOGUE.mixtures[1].period_au)
          oldFixedPeriod = nextTimeAu(oldFixedPeriod, 39.6)
        }
        expect(expected).toBe(2.8)
        expect(oldFixedPeriod).toBe(3)
        expect(useSceneStore.getState().timeAu).toBe(expected)
        expect(useSceneStore.getState().timeAu).not.toBe(oldFixedPeriod)
        const clock = parameterInput(tree, 'timeAu')
        expect(clock?.validity.stepMismatch).toBe(false)
        expect(clock?.closest('label')?.querySelector('.control-value')?.textContent).toMatch(
          /^\d+(?:\.\d)? a\.u\.$/,
        )
      } finally {
        await tree.unmount()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not offer motion for a degenerate catalogue state', async () => {
    const mixture = CATALOGUE.mixtures[0]
    const originalPeriod = mixture.period_au
    mixture.period_au = 0
    useSceneStore.setState({ mode: 'superposition', representation: 'isosurface' })
    const tree = await mount(createElement(ControlPanel))
    try {
      const playback = tree.container.querySelector<HTMLButtonElement>('[data-control="playback"]')
      expect(playback?.disabled).toBe(false)
      expect(playback?.getAttribute('aria-disabled')).toBe('true')
      expect(playback?.title).toContain('能量简并')
      playback?.focus()
      expect(document.activeElement).toBe(playback)
      const notice = tree.container.querySelector('[data-playback-notice]')
      expect(notice?.textContent).toContain('能量简并')
      expect(playback?.getAttribute('aria-describedby')).toBe(notice?.id)
      await press(playback, 'the inert degenerate playback control')
      expect(useSceneStore.getState().playing).toBe(false)

      // Force a real React rerender: the inert click above intentionally does
      // not write state, so checking only that moment would not prove the
      // explanation remains in the DOM across later panel updates.
      await interact(() => useSceneStore.getState().setBloom(0.31))
      const rerenderedPlayback = tree.container.querySelector<HTMLButtonElement>(
        '[data-control="playback"]',
      )
      const rerenderedNotice = tree.container.querySelector('[data-playback-notice]')
      expect(rerenderedNotice?.textContent).toContain('能量简并')
      expect(rerenderedPlayback?.getAttribute('aria-disabled')).toBe('true')
      expect(rerenderedPlayback?.getAttribute('aria-describedby')).toBe(
        rerenderedNotice?.id,
      )
    } finally {
      await tree.unmount()
      mixture.period_au = originalPeriod
    }
  })

  it('runs no clock for a cell the matrix gives no time parameter', async () => {
    vi.useFakeTimers()
    try {
      useSceneStore.setState({ mode: 'eigenstate', representation: 'point_cloud', playing: true })
      const tree = await mount(createElement(ControlPanel))
      try {
        await vi.advanceTimersByTimeAsync(2000)
        expect(useSceneStore.getState().timeAu).toBe(0)
      } finally {
        await tree.unmount()
      }
    } finally {
      vi.useRealTimers()
    }
  })
})
