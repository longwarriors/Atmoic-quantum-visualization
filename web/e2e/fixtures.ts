/**
 * The server, replaced by committed bytes -- and the ledger that proves it.
 *
 * A screenshot suite compares this run's pixels against a committed PNG, so it
 * is evidence about RENDERING only if everything upstream of the renderer is
 * fixed. The numbers are the biggest upstream thing there is: run the visual
 * suite against a live FastAPI process and every diff becomes an argument about
 * whether the physics moved instead, and every green run silently depends on a
 * server being installed, seeded and versioned the same way on every machine.
 *
 * So the app talks to this module instead. Each of the six slice payloads and
 * both catalogs is served VERBATIM from `tests/fixtures/visual/`, the files
 * `scripts/write_visual_fixtures.py` writes and `tests/test_visual_fixtures.py`
 * rebuilds and byte-compares. The bytes that reach the browser are therefore
 * the same bytes a reviewer reads in the diff.
 *
 * Three claims this module is built to make CHECKABLE, rather than to assume:
 *
 * **The UI asked the exact question the fixture answers.** A fixture is keyed
 * by the whole query -- every parameter, not just the interesting ones. A
 * request that differs in one of them (a dropped `plane`, a resolution the
 * panel clamped elsewhere, an `a_mu` nobody meant to send) matches no fixture
 * and is DECLINED, so it shows up in the ledger instead of being answered with
 * a payload that describes a different question. `sliceContract.ts` cannot
 * catch that class: the payload it validates is internally consistent, it is
 * simply the answer to something else.
 *
 * **Nothing reached a live server.** Every request the page makes is
 * intercepted here. Anything addressed off the preview origin is aborted and
 * recorded, and the spec asserts that list is empty -- "no live server
 * variance" as a checked claim rather than a hopeful sentence in a comment.
 *
 * **The questions with no fixture are named in advance.** Driving the real UI
 * walks through intermediate states (the default point cloud on load, the
 * density slice that exists between "show me a plane section" and "show me the
 * real part"), and each one asks the server something. Those get a 503 saying
 * so, and are recorded; the spec declares the ones its own path passes through
 * and asserts nothing else appears. The declaration is an upper bound rather
 * than an exact multiset on purpose: a scene change aborts the request in
 * flight, and an abort can win the race before the request is dispatched, so a
 * declared question may legitimately not be asked. An UNDECLARED one is always
 * a defect -- either the UI asked something nobody predicted, or a fixture
 * stopped matching.
 *
 * Deliberately importable by plain `node`: every Playwright import is `import
 * type`, so a script can exercise the route table, the ledger and the payload
 * transform outside the runner. playwright.config.ts refuses to load off Linux
 * (the baselines are SwiftShader's), which would otherwise leave every line
 * here unrunnable on a developer machine.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Page, Route } from '@playwright/test'

/** `tests/fixtures/visual/`, resolved from this file rather than from the cwd. */
const FIXTURE_DIRECTORY = fileURLToPath(new URL('../../tests/fixtures/visual/', import.meta.url))

/** One committed response, as the exact text the endpoint would have sent. */
export function readVisualFixture(name: string): string {
  return readFileSync(`${FIXTURE_DIRECTORY}${name}.json`, 'utf-8')
}

export const ORBITAL_CATALOG = '/api/orbitals/catalog'
export const SUPERPOSITION_CATALOG = '/api/superposition/catalog'
export const EIGENSTATE_SLICE = '/api/orbitals/slice'
export const SUPERPOSITION_SLICE = '/api/superposition/slice'

/** Shorthand for the two catalog endpoints, whose queries are empty. */
export const CATALOG_ORBITALS = 'catalog-orbitals'
export const CATALOG_SUPERPOSITION = 'catalog-superposition'

/**
 * One request, canonicalised: the path, then every query parameter in sorted
 * order with its DECODED value.
 *
 * Sorted because parameter order is the client's spelling, not a fact about
 * the question -- `client.ts` builds its query from an object literal, and a
 * reordered literal would otherwise read as a different request. Decoded
 * because the superposition `terms` carry `,` and `;`, which percent-encode on
 * the wire and would make every declaration below unreadable.
 */
export function canonicalQuestion(url: URL): string {
  const pairs = [...url.searchParams.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
  return pairs.length === 0 ? url.pathname : `${url.pathname}?${pairs.join('&')}`
}

/** The same canonical form, written out by a caller that knows the parameters. */
export function question(path: string, params: Readonly<Record<string, string>> = {}): string {
  const url = new URL(path, 'http://declared.invalid')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return canonicalQuestion(url)
}

interface SuperpositionPresetRow {
  id: string
  terms: string
}

/**
 * The `terms` string of each committed superposition preset, keyed by id.
 *
 * Read out of the catalog fixture rather than written here a second time: the
 * preset strip renders THAT file, so a test that clicks "2s + 2p_z" and a
 * fixture keyed on a hand-copied terms string could drift apart, and the
 * symptom would be a declined request rather than anything a reader connects
 * to a typo.
 */
export const SUPERPOSITION_TERMS: Readonly<Record<string, string>> = Object.fromEntries(
  (JSON.parse(readVisualFixture(CATALOG_SUPERPOSITION)) as SuperpositionPresetRow[]).map(
    (preset) => [preset.id, preset.terms],
  ),
)

/**
 * The eigenstate slice query for one state, field and plane, in full.
 *
 * Exported because a spec has to declare the questions its click path passes
 * THROUGH as well as the ones it has fixtures for, and both are the same query
 * shape. The three parameters fixed here are the ones no test varies: the
 * panel cannot change `z` or `a_mu` for an eigenstate, and 65 is the slice
 * floor for n = 2 (`capability.ts`), which is what every fixture was built at.
 */
export const eigenstateSliceQuestion = (params: Readonly<Record<string, string>>): string =>
  question(EIGENSTATE_SLICE, { z: '1', resolution: '65', a_mu: '1', ...params })

/** The superposition slice query for one mixture, instant, field and plane. */
export const superpositionSliceQuestion = (params: Readonly<Record<string, string>>): string =>
  question(SUPERPOSITION_SLICE, {
    basis: 'complex',
    z: '1',
    a_mu: '1',
    resolution: '65',
    observable: 'probability_density',
    plane: 'xz',
    ...params,
  })

/**
 * Every committed fixture, with the ONE question it is the answer to.
 *
 * The queries are transcribed from what the built application actually sends
 * (measured against the preview build, not derived from `client.ts` by eye):
 * `a_mu` and `resolution` are on every slice query because `capability.ts`
 * declares both for the slice rows, and `plane` / `observable` are there
 * because routes.py defaults them and a dropped one would be answered with a
 * different section in silence.
 */
export const VISUAL_FIXTURES: Readonly<Record<string, string>> = {
  [ORBITAL_CATALOG]: CATALOG_ORBITALS,
  [SUPERPOSITION_CATALOG]: CATALOG_SUPERPOSITION,

  // 2p_z in the real basis: the signed field, whose nodal line is the xy plane
  // and therefore runs across v = 0 -- horizontally on screen.
  [eigenstateSliceQuestion({
    n: '2', l: '1', m: '0', basis: 'real', plane: 'xz', observable: 'wavefunction_real',
  })]: '2pz-real-xz',

  // 2p(+1) in the complex basis on xy: one full phase winding, with the single
  // masked sample at the origin.
  [eigenstateSliceQuestion({
    n: '2', l: '1', m: '1', basis: 'complex', plane: 'xy', observable: 'phase',
  })]: '2p+1-phase-xy',

  // The degenerate pair, at the two instants that must render identically.
  [superpositionSliceQuestion({ terms: SUPERPOSITION_TERMS['2s-2pz'], time: '0' })]:
    'degenerate-stationary-xz-t0',
  [superpositionSliceQuestion({ terms: SUPERPOSITION_TERMS['2s-2pz'], time: '8.4' })]:
    'degenerate-stationary-xz-t8.4',

  // The oscillating pair, at the two instants that must not.
  [superpositionSliceQuestion({ terms: SUPERPOSITION_TERMS['1s-2pz'], time: '0' })]:
    '1s2pz-t0-xz',
  [superpositionSliceQuestion({ terms: SUPERPOSITION_TERMS['1s-2pz'], time: '8.4' })]:
    '1s2pz-t8.4-xz',
}

/**
 * What the application asks before any control is touched.
 *
 * The store opens on the 2p_z point cloud, so a fresh page fetches the cloud
 * and its metadata whatever the test is about. No screenshot is of that scene
 * and no fixture answers it, so both are declined -- and both are declared
 * here, once, rather than repeated in every test's path.
 */
export const OPENING_QUESTIONS: readonly string[] = [
  question('/api/orbitals/point-cloud', {
    n: '2',
    l: '1',
    m: '0',
    z: '1',
    basis: 'real',
    samples: '28000',
    seed: '7',
  }),
  question('/api/orbitals/metadata', { n: '2', l: '1', m: '0', z: '1', basis: 'real' }),
]

/** The sample grid of a slice payload, which is all the transform below reads. */
interface SliceSampleGrid {
  resolution: number
  values: number[]
  layout: string
}

/**
 * The three fields the transform needs, checked rather than asserted.
 *
 * The argument is whatever `JSON.parse` produced, so it is `unknown` and has to
 * be narrowed. Spelling it as a cast instead would move the failure from here
 * -- where the message names the field -- to a `values.map` on undefined inside
 * a route handler, which surfaces as a page that never loads.
 */
function asSampleGrid(payload: unknown): SliceSampleGrid {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error(`transposeSlicePayload: expected a JSON object, got ${typeof payload}`)
  }
  const { resolution, values, layout } = payload as Partial<SliceSampleGrid>
  if (typeof resolution !== 'number' || !Array.isArray(values) || typeof layout !== 'string') {
    throw new Error(
      'transposeSlicePayload: expected a slice payload with resolution, values and layout',
    )
  }
  return { resolution, values, layout }
}

/**
 * The same payload with `values` transposed: sample `(row, col)` moved to
 * `(col, row)`, i.e. u and v swapped.
 *
 * This is the apparatus's own control. The result is a payload that passes
 * every check the client makes -- `parseSlicePayload` sees the same resolution,
 * the same frame, the same finite samples, the same extreme, the same absent
 * mask, and the Inspector prints the same numbers to the last digit -- and
 * differs from the committed fixture in exactly one respect: the picture. If
 * the screenshot assertion cannot tell these two apart, it is not measuring the
 * rendering at all, and every baseline in this suite is decoration.
 *
 * `layout` is asserted rather than assumed: `row_major_v_rows_u_columns` is
 * what makes "transposed" mean "u and v swapped" and not something else.
 */
export function transposeSlicePayload(payload: unknown): unknown {
  const { resolution, values, layout } = asSampleGrid(payload)
  if (layout !== 'row_major_v_rows_u_columns') {
    throw new Error(
      `transposeSlicePayload: layout is ${JSON.stringify(layout)}, so swapping row and ` +
        'column indices no longer means swapping u and v. The control would still produce a ' +
        'different picture, but it would no longer be the picture a u/v swap produces.',
    )
  }
  if (values.length !== resolution * resolution) {
    throw new Error(
      `transposeSlicePayload: ${values.length} samples for resolution ${resolution}.`,
    )
  }
  const swapped = values.map(
    (_, index) => values[(index % resolution) * resolution + Math.floor(index / resolution)],
  )
  return { ...(payload as object), values: swapped }
}

/** What every request the page made was answered with. */
export interface RequestLedger {
  /** Fixture names served, in the order the app asked for them. */
  readonly served: string[]
  /** Canonical questions the harness declined: no committed fixture answers them. */
  readonly declined: string[]
  /** Full URLs aborted for being addressed somewhere other than the preview origin. */
  readonly offOrigin: string[]
  /**
   * Release the one held question (see `HarnessOptions.hold`). Safe to call
   * when nothing is holding; a test that ends without calling it would leave a
   * request pending forever, which is why the spec always calls it.
   */
  releaseHeld(): void
  /** Declined questions the caller did not declare -- the list a spec asserts empty. */
  unexpected(declared: readonly string[]): string[]
}

export interface HarnessOptions {
  /** The preview server's origin. Anything else is off-origin and is aborted. */
  origin: string
  /**
   * Per-fixture payload transforms, for the mechanism control. A transformed
   * fixture is still recorded under its own name: the ledger says which
   * question was answered, and the transform says with what.
   */
  transform?: Readonly<Record<string, (payload: unknown) => unknown>>
  /**
   * One canonical question whose 503 is withheld until `releaseHeld()`.
   *
   * This is what makes playback deterministic. `useSceneAsset` keeps exactly
   * one request in flight and remembers only the newest time behind it, so
   * holding the answer to the first tick's question collapses every later tick
   * into one queued time -- the one the test is about -- instead of a race
   * between the clock and the network.
   */
  hold?: string
}

/**
 * Intercept every request this page makes, and return the ledger of what
 * happened to each.
 *
 * Two handlers, registered in this order because Playwright runs the most
 * recently registered matching handler first: the catch-all sees everything the
 * API handler did not claim.
 */
export async function installApiHarness(
  page: Page,
  options: HarnessOptions,
): Promise<RequestLedger> {
  const served: string[] = []
  const declined: string[] = []
  const offOrigin: string[] = []
  const transform = options.transform ?? {}

  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })

  const isOffOrigin = (url: URL): boolean => url.origin !== new URL(options.origin).origin

  /** Everything that is not an API call: the app's own bundle, css, favicon. */
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url())
    if (isOffOrigin(url)) {
      offOrigin.push(route.request().url())
      await route.abort()
      return
    }
    await route.continue()
  })

  await page.route('**/api/**', async (route: Route) => {
    const url = new URL(route.request().url())
    if (isOffOrigin(url)) {
      // An API call to another origin is the one case both handlers could
      // claim, and it must be recorded as what it is rather than answered from
      // a fixture because the path happened to match.
      offOrigin.push(route.request().url())
      await route.abort()
      return
    }
    const asked = canonicalQuestion(url)
    const fixture = VISUAL_FIXTURES[asked]
    if (fixture !== undefined) {
      const mutate = transform[fixture]
      const body =
        mutate === undefined
          ? readVisualFixture(fixture)
          : JSON.stringify(mutate(JSON.parse(readVisualFixture(fixture))))
      served.push(fixture)
      // Not wrapped in a try/catch: fulfilling a request the page has already
      // aborted (a scene change cancels the fetch in flight) would surface as a
      // failed route handler, and that is a fact about the app's request
      // lifecycle worth seeing rather than swallowing.
      await route.fulfill({ contentType: 'application/json', body })
      return
    }
    declined.push(asked)
    if (asked === options.hold) {
      await held
    }
    await route.fulfill({
      status: 503,
      contentType: 'text/plain',
      body:
        `The visual harness stands in for the API and has no committed fixture for ${asked}. ` +
        'Nothing was rendered from it; the frame already on screen is unchanged.',
    })
  })

  return {
    served,
    declined,
    offOrigin,
    releaseHeld: () => {
      release()
    },
    unexpected: (declared) =>
      [...new Set(declined.filter((asked) => !declared.includes(asked)))].sort(),
  }
}
