/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  capabilityFor,
  type Capability,
  type CapabilityInputs,
  type ParameterId,
} from '../api/capability'
import type { OrbitalParameters, RepresentationKind } from '../api/types'
import { useSceneStore, type SceneMode } from '../state/useSceneStore'
import { mount, type MountedTree } from '../test/mount'
import { ControlPanel } from './ControlPanel'

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
    { id: 'p2pz', label: '2p_z', n: 2, l: 1, m: 0, z: 1, basis: 'real' as const },
    { id: 'p3d', label: '3d_xy', n: 3, l: 2, m: -2, z: 1, basis: 'real' as const },
  ],
  mixtures: [
    {
      id: 'bohr',
      label: '1s + 2p_z',
      terms: '1,0,0,0.7071067811865476;2,1,0,0.7071067811865476',
      period_au: 39.6,
      note: 'Bohr oscillation',
    },
    {
      id: 'ring',
      label: '2p_+1 + 3d_+2',
      terms: '2,1,1,0.7071067811865476;3,2,2,0.7071067811865476',
      period_au: 12.1,
      note: 'ring current',
    },
  ],
}))

vi.mock('../api/client', () => ({
  fetchCatalog: () => Promise.resolve(CATALOGUE.presets),
  fetchSuperpositionCatalog: () => Promise.resolve(CATALOGUE.mixtures),
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

/** Every (mode x representation) cell, with an orbital that makes it interesting. */
const CELLS: [SceneMode, RepresentationKind, OrbitalParameters][] = [
  ['eigenstate', 'point_cloud', REAL_ORBITAL],
  ['eigenstate', 'isosurface', REAL_ORBITAL],
  ['eigenstate', 'streamlines', REAL_ORBITAL],
  ['superposition', 'point_cloud', REAL_ORBITAL],
  ['superposition', 'isosurface', REAL_ORBITAL],
  ['superposition', 'streamlines', REAL_ORBITAL],
]

beforeEach(() => {
  capabilityOverride.current = null
  useSceneStore.setState(PRISTINE, true)
})

async function panel(
  mode: SceneMode,
  representation: RepresentationKind,
  orbital: OrbitalParameters = REAL_ORBITAL,
): Promise<MountedTree> {
  useSceneStore.setState({ mode, representation, orbital })
  return mount(createElement(ControlPanel))
}

function representationButton(tree: MountedTree, id: RepresentationKind): HTMLButtonElement {
  const button = tree.container.querySelector<HTMLButtonElement>(
    `button[data-representation="${id}"]`,
  )
  if (button === null) throw new Error(`no representation button for ${id}`)
  return button
}

function parameterInput(tree: MountedTree, id: ParameterId): HTMLInputElement | null {
  return tree.container.querySelector<HTMLInputElement>(`input[data-parameter="${id}"]`)
}

describe('ControlPanel representation buttons read the capability matrix', () => {
  it.each(CELLS)(
    '%s / %s: disabled iff the matrix refuses, and the title carries its reason',
    async (mode, representation, orbital) => {
      // The selected representation is deliberately the one under test, so the
      // cell is exercised as both "the button" and "the current scene".
      const tree = await panel(mode, representation, orbital)
      try {
        const expected = capabilityFor({ mode, orbital, representation })
        const button = representationButton(tree, representation)

        expect(button.disabled).toBe(expected.status !== 'available')
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
        for (const representation of ['point_cloud', 'isosurface', 'streamlines'] as const) {
          const expected = capabilityFor({ mode, orbital, representation })
          const button = representationButton(tree, representation)
          expect(button.disabled, representation).toBe(expected.status !== 'available')
          if (expected.status !== 'available') {
            expect(button.title, representation).toBe(expected.reason)
          }
        }
      } finally {
        await tree.unmount()
      }
    },
  )

  it('disables the superposition point cloud and says it was never built', async () => {
    const tree = await panel('superposition', 'isosurface')
    try {
      const button = representationButton(tree, 'point_cloud')
      expect(button.disabled).toBe(true)
      expect(button.title).toContain('has not been built')
      // "not implemented" is not "unsupported": the panel must not claim the
      // physics forbids a time-dependent point cloud.
      expect(button.title).toContain('Nothing about the physics forbids it')
    } finally {
      await tree.unmount()
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
      expect(button.disabled).toBe(true)
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
      expect(representationButton(tree, 'streamlines').disabled).toBe(false)
      expect(representationButton(tree, 'isosurface').disabled).toBe(false)
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
      expect(button.disabled).toBe(true)
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
    ['eigenstate', 'streamlines', FLOWING_ORBITAL],
    ['superposition', 'point_cloud', REAL_ORBITAL],
    ['superposition', 'isosurface', REAL_ORBITAL],
    ['superposition', 'streamlines', REAL_ORBITAL],
  ] as [SceneMode, RepresentationKind, OrbitalParameters][])(
    '%s / %s: exactly the declared parameters, at exactly the declared bounds',
    async (mode, representation, orbital) => {
      const tree = await panel(mode, representation, orbital)
      try {
        const capability = capabilityFor({ mode, orbital, representation })
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

  it('caps the seed count at 128 in superposition and 256 for an eigenstate', async () => {
    const timeDependent = await panel('superposition', 'streamlines')
    try {
      expect(parameterInput(timeDependent, 'seedCount')?.max).toBe('128')
    } finally {
      await timeDependent.unmount()
    }

    const stationary = await panel('eigenstate', 'streamlines', FLOWING_ORBITAL)
    try {
      expect(parameterInput(stationary, 'seedCount')?.max).toBe('256')
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

describe('ControlPanel superposition read-outs', () => {
  it('shows the basis, Z and a_mu the request will actually carry, read-only', async () => {
    useSceneStore.setState({ superpositionBasis: 'complex', superpositionAMu: 1.0 })
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
      expect(tree.container.querySelector('[data-readonly="a_mu"]')).toBeNull()
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
  it('applies a catalogue preset and restores the default one', async () => {
    const tree = await panel('eigenstate', 'point_cloud')
    try {
      const presets = tree.container.querySelectorAll<HTMLButtonElement>('.preset-strip .preset')
      expect(presets).toHaveLength(2)
      expect(presets[0].className).toContain('active')

      await press(presets[1], 'the second preset')
      expect(useSceneStore.getState().orbital).toMatchObject({ n: 3, l: 2, m: -2 })

      await press(tree.container.querySelector('.round-button'), 'the reset button')
      expect(useSceneStore.getState().orbital).toMatchObject({ n: 2, l: 1, m: 0, basis: 'real' })
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
      expect(mixtures).toHaveLength(2)
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
      await setValue(parameterInput(surface, 'timeAu'), 'time', '6')
      expect(useSceneStore.getState().timeAu).toBe(6)
    } finally {
      await surface.unmount()
    }

    const flow = await panel('superposition', 'streamlines')
    try {
      await setValue(parameterInput(flow, 'seedCount'), 'seed count', '96')
      expect(useSceneStore.getState().seedCount).toBe(96)
    } finally {
      await flow.unmount()
    }
  })

  it('writes each rendering knob, none of which reaches a route', async () => {
    const tree = await panel('eigenstate', 'point_cloud')
    try {
      const knob = (name: string): HTMLInputElement | null =>
        tree.container.querySelector<HTMLInputElement>(`input[data-display="${name}"]`)
      await setValue(knob('pointSize'), 'point size', '4.2')
      expect(useSceneStore.getState().pointSize).toBe(4.2)
      await setValue(knob('opacity'), 'opacity', '60')
      expect(useSceneStore.getState().opacity).toBeCloseTo(0.6, 10)
      await setValue(knob('exposure'), 'exposure', '120')
      expect(useSceneStore.getState().exposure).toBeCloseTo(1.2, 10)
      await setValue(knob('fog'), 'fog', '40')
      expect(useSceneStore.getState().fogStrength).toBeCloseTo(0.4, 10)
      await setValue(knob('bloom'), 'bloom', '30')
      expect(useSceneStore.getState().bloom).toBeCloseTo(0.3, 10)
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

