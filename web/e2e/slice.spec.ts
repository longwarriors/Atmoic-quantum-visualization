/**
 * What a plane section actually looks like -- the five pictures this feature
 * exists to draw, each pinned to a committed PNG.
 *
 * Everything else in the suite tests the numbers. `sliceContract.ts` proves a
 * payload is internally consistent, `sliceTexture.ts` proves a sample becomes
 * the right texel, `camera.ts` proves the viewpoint is the plane's. None of
 * them can see the one thing a user does: the picture. A renderer that reads
 * the grid transposed, mirrors v, decodes the colormap twice or drops the mask
 * passes every one of those tests and draws a physically false image -- and
 * each of those failures is *plausible-looking*, which is why nobody catches it
 * by eye either.
 *
 * So the five cases below are chosen to be pictures where a specific mistake is
 * VISIBLE and nothing else in the suite would see it:
 *
 *   2pz-real-xz          the nodal line of 2p_z on xz is the xy plane, i.e.
 *                        v = 0, i.e. a HORIZONTAL line on screen. A u/v swap
 *                        turns it vertical; a |value| colormap erases it.
 *   2p+1-phase-xy        one full counter-clockwise winding of the phase, with
 *                        the origin masked. A mirrored normal reverses the
 *                        winding; an ignored mask fills the hole with the
 *                        sentinel's colour (phase 0, "positive real").
 *   degenerate-*-xz      2s + 2p_z share E = -1/8 Ha, so |Psi|^2 cannot move.
 *                        The SAME baseline is asserted at t = 0 and t = 8.4:
 *                        the animation's negative control.
 *   1s2pz-t0 / -t8.4     1s + 2p_z beat at omega = 3/8 Ha. Two baselines half a
 *                        Bohr period apart: the positive control the negative
 *                        one is only meaningful against.
 *
 * The bytes behind every one of them are committed (`tests/fixtures/visual/`,
 * served by `./fixtures`), so a diff here is about rendering and never about a
 * server that answered differently today.
 *
 * ---------------------------------------------------------------------------
 * HOW THE BASELINES GET HERE. Read this before the first CI run.
 *
 * There are no PNGs in `e2e/__screenshots__/` yet, and they cannot be produced
 * on the machine this file was written on: playwright.config.ts throws at load
 * off Linux, because the baselines are SwiftShader's pixels and any other stack
 * renders different ones. Committing PNGs drawn anywhere else would make the
 * suite permanently red in CI and permanently meaningless everywhere else, so
 * none were invented. The bootstrap is two CI runs:
 *
 *   1. The first run FAILS, by design. `updateSnapshots: 'none'` makes a
 *      missing baseline an error rather than a silently written answer key, so
 *      every assertion below reports "A snapshot doesn't exist at ...". The
 *      run's failure artifact carries what it actually rendered, as
 *      `test-results/<test>/<name>-actual.png`.
 *   2. A human looks at those images -- that is the whole point of step 1;
 *      the node line has to be horizontal, the winding counter-clockwise, the
 *      masked disc a hole -- and commits them to
 *      `e2e/__screenshots__/slice.spec.ts/<name>.png`.
 *   3. The second run must pass. If it does not, the renderer is not
 *      deterministic and the suite has found a real defect before it ever had
 *      a baseline: a picture that differs from the one drawn minutes earlier in
 *      the same environment is not something to paper over with a threshold.
 *
 * STEP 3 USED TO BE EXPECTED TO FAIL, and the measurement is kept here because
 * it is what the fix has to be judged against. The scene as first written did
 * not settle to a repeatable camera: driving the 2p_z path below six times in
 * one browser, waiting on `data-scene-ready` and the ready status exactly as
 * these tests do, produced six DIFFERENT settled renderings -- each perfectly
 * stable within its own run (identical again 2.5 s later), and visibly
 * different between runs: some face-on to the section, some still at the
 * default three-quarter view. That was `aimCamera`'s imperative placement
 * racing drei's `Bounds` fit and `OrbitControls`' damping, and it was upstream
 * of everything here: no wait a harness can perform fixes a scene that has
 * genuinely stopped moving in the wrong place. (Measured on Windows/ANGLE, but
 * the race was in JavaScript, not in the rasteriser, so SwiftShader would show
 * it too.)
 *
 * Both of those animations are now gone from THIS suite's runs, and not by a
 * test hook. src/components/OrbitalCanvas.tsx reads
 * `(prefers-reduced-motion: reduce)` and, for a viewer who has asked for it,
 * collapses the fit to `maxDuration={0}` and turns `OrbitControls`' damping
 * off. That is the accessibility behaviour on its own terms -- the same code
 * path runs for every such viewer whether or not anybody is taking screenshots
 * -- and playwright.config.ts sets `reducedMotion: 'reduce'` on every context,
 * so it is the path these tests exercise. With no easing curve left to be
 * sampled part-way through and no damping still integrating, the fitted pose is
 * reached in a single frame and there is one of it rather than a family.
 *
 * So step 3 is now expected to PASS -- expected, not measured: this suite
 * cannot run off Linux, so the first evidence either way will be the CI
 * bootstrap itself. If it still fails, that is a second defect of the same
 * kind, and the answer is the same as it was for the first one: find what is
 * still moving. Do not widen the budget.
 *
 * The two `.not.toHaveScreenshot` assertions (the mechanism control, and the
 * half-period check in the t = 8.4 test) reference baselines the POSITIVE tests
 * produce, so they are red in run 1 for the same "no baseline" reason and green
 * from run 2 on.
 *
 * `npm run test:visual:update` is not part of this procedure. It writes every
 * baseline from whatever was just rendered, which is how a bug becomes the
 * answer key; scripts/assert-visual-run.mjs refuses the report such a run
 * produces.
 * ---------------------------------------------------------------------------
 *
 * Three rules the tests below follow, each because the alternative silently
 * weakens the evidence:
 *
 * **Only the canvas is compared, and only its non-text pixels.** The scene is
 * WebGL; the headline and the legend are DOM drawn on top of it, and text is
 * where font rasterisation and locale creep into a baseline. They are masked
 * out of the comparison and asserted through the DOM instead, where a changed
 * number is a readable diff rather than a grey smudge.
 *
 * **Nothing waits on a timer.** The scene says when it has stopped moving
 * (`data-scene-ready`, see src/scene/SceneReady.tsx) and the status bar says
 * whether what is on screen is the frame that was asked for. A `waitForTimeout`
 * here would be choosing between a race and a tax on every green run.
 *
 * **The clock is driven, not waited on.** Playback advances 0.6 a.u. every
 * 420 ms of wall time, and t = 8.4 is the fourteenth step. Pausing a real
 * interval at exactly the fourteenth tick is a race with a 420 ms window; worse,
 * the time slider CANNOT express 8.4 at all (its step base is min = -1000, so
 * its grid is ... 8.0, 8.6 ... -- measured: `fill('8.4')` is rejected as
 * "Malformed value"), which is why playback is the only honest way to reach the
 * instant the fixture was built at. `page.clock` makes those fourteen ticks
 * deterministic, and `./fixtures` holds the answer to the first one so the
 * latest-wins coordinator in useSceneAsset collapses the other thirteen into a
 * single request for the instant under test.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  eigenstateSliceQuestion,
  installApiHarness,
  OPENING_QUESTIONS,
  superpositionSliceQuestion,
  SUPERPOSITION_TERMS,
  transposeSlicePayload,
  type RequestLedger,
} from './fixtures'

/**
 * Every test drives a full scene setup and, twice, a half-period advance,
 * against a software rasteriser. Playwright's 30 s default is a budget for a
 * DOM test; a 656 x 1071 SwiftShader canvas plus five screenshot comparisons is
 * not that. Generous rather than tuned: a timeout is a safety net here, not a
 * performance assertion, and a tight one would turn a loaded CI box into a red
 * suite that says nothing about the pixels.
 */
test.describe.configure({ timeout: 120_000 })

/**
 * The comparison budget, PROVISIONAL.
 *
 * `threshold` is the per-pixel YIQ distance below which two pixels count as
 * equal; `maxDiffPixelRatio` is the share of the frame allowed to exceed it.
 * These two numbers are guesses until they are measured: the honest way to set
 * them is to run this suite three times on the CI image against committed
 * baselines, take the largest ratio any test reports, and set the budget just
 * above it -- tight enough that a one-lobe shift fails, loose enough that
 * SwiftShader's own frame-to-frame noise does not. Until that measurement
 * exists, 0.1 / 0.001 (about 700 pixels of this canvas) is a starting point and
 * nothing more. Do not widen either number to make a red test pass; a rendering
 * that moves by more than this is the thing the suite is for.
 */
const COMPARISON = {
  threshold: 0.1,
  maxDiffPixelRatio: 0.001,
  /**
   * The screenshot itself is retried until two consecutive captures agree AND
   * the capture matches the baseline, so this budget covers a slow software
   * rasteriser rather than a slow assertion. `expect`'s 5 s default is not
   * enough for a canvas this size under SwiftShader.
   */
  timeout: 30_000,
} as const

/**
 * How long a wait on the app's own readiness signals may take.
 *
 * expect()'s 5 s default is a budget for a DOM update; these waits sit behind a
 * software-rasterised WebGL context being created, a scene being fitted and a
 * payload of 4225 samples becoming a texture, on a CI box running one worker at
 * a time. Long enough not to be a performance assertion, short enough that a
 * signal that never arrives still fails the test rather than the suite timeout.
 */
const SETTLE = { timeout: 30_000 } as const

/** The WebGL surface, which is the only thing any baseline here is of. */
const canvasOf = (page: Page): Locator => page.locator('canvas')

/**
 * The DOM drawn over the canvas: the headline block and the legend card.
 *
 * Masked out of every comparison because both are text. They are not thereby
 * exempt from checking -- each test asserts the legend's own statement about
 * which field is on screen through the DOM, where the assertion says what it
 * means.
 */
const overlays = (page: Page): Locator[] => [page.locator('.viewport-copy'), page.locator('.legend')]

const screenshotOptions = (page: Page) => ({ ...COMPARISON, mask: overlays(page) })

/**
 * The value the Inspector prints for one contract term.
 *
 * Anchored on the whole `dt` text: "Plane" would otherwise also match "Phase
 * mask ..." rows, and a loose match that silently reads the wrong row is worse
 * than no assertion at all.
 */
function contractValue(page: Page, term: string): Locator {
  return page
    .locator('.contract-list dt', { hasText: new RegExp(`^${term.replace(/[|]/g, '\\|')}$`) })
    .locator('xpath=following-sibling::dd[1]')
}

/**
 * Open the app with the API replaced by committed fixtures, and hand back the
 * ledger of what it asked for.
 *
 * The wait is for the app's own error status, and it is what makes the ledger
 * deterministic rather than a race: the opening scene is the 2p_z point cloud,
 * no fixture answers it, and until the harness has declined it the next click
 * can abort the request before it is ever dispatched.
 */
async function openApp(
  page: Page,
  baseURL: string | undefined,
  options: { transform?: Record<string, (payload: unknown) => unknown>; hold?: string } = {},
): Promise<RequestLedger> {
  expect(
    baseURL,
    'the visual suite has no baseURL: playwright.config.ts sets one from the preview server, ' +
      'and without it this test would be driving whatever happens to be on the default origin',
  ).toBeDefined()
  const origin = baseURL as string
  const ledger = await installApiHarness(page, { origin, ...options })
  await page.goto('/')
  await expect(page.locator('span[data-status]')).toHaveAttribute('data-status', 'error', SETTLE)

  // Bloom off, through the slider itself. `Home` on a focused range input is
  // the platform's own "go to minimum" gesture, which the store reads through
  // React's change event exactly as a drag would -- unlike assigning `value`,
  // which React's value tracker can swallow. Bloom is a luminance-thresholded
  // blur of the rendered buffer: it turns every bright texel into a halo whose
  // extent depends on float rounding, which is a per-pixel diff on every frame
  // and measures nothing about the slice.
  const bloom = page.locator('input[data-display="bloom"]')
  await bloom.focus()
  await page.keyboard.press('Home')
  await expect(bloom).toHaveValue('0')
  return ledger
}

/**
 * Wait until the scene on screen is the one that was asked for and has stopped
 * moving.
 *
 * Both halves are needed and neither implies the other: `data-scene-ready`
 * carries the identity of the settled scene (the camera fit and the control
 * damping are over), and the status bar's `ready` says the frame is the
 * requested one rather than the previous one kept up while a fetch runs.
 *
 * The first assertion is spelled POSITIVELY -- "an element carrying a non-empty
 * flag is attached" -- rather than as `not.toHaveAttribute(..., '')`. The
 * obvious worry about the negated spelling, that it is satisfied while no such
 * element exists at all (which is the state every test here starts in), turns
 * out NOT to hold in @playwright/test 1.62: measured against this app before
 * any slice is requested, `not.toHaveAttribute` polls and then fails, exactly
 * as the positive form does. Both spellings are correct today; this one is used
 * because it does not depend on that behaviour staying the same, and because
 * "an element with a real flag exists" is the thing the screenshot needs.
 */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('[data-scene-ready]:not([data-scene-ready=""])')).toBeAttached(SETTLE)
  await expect(page.locator('span[data-status]')).toHaveAttribute('data-status', 'ready', SETTLE)
}

/** Switch the panel to the plane-section representation. */
const showPlaneSection = (page: Page): Promise<void> =>
  page.locator('button[data-representation="slice"]').click()

const chooseObservable = (page: Page, observable: string): Promise<void> =>
  page.locator(`[data-choice="observable"] button[data-choice-value="${observable}"]`).click()

const choosePlane = (page: Page, plane: string): Promise<void> =>
  page.locator(`[data-choice="plane"] button[data-choice-value="${plane}"]`).click()

/** `sceneRequest.ts`: playback steps 0.6 a.u. every 420 ms. */
const PLAYBACK_INTERVAL_MS = 420
/** 14 * 0.6 = 8.4 a.u., the instant both time-dependent fixture pairs were built at. */
const HALF_PERIOD_STEPS = 14
/**
 * Where the fake clock stops. Any instant far enough past load that nothing the
 * page scheduled during startup is still pending; the value itself is never
 * displayed, because the UI's clock is the physics time in atomic units and has
 * nothing to do with the wall clock.
 */
const CLOCK_PAUSE_AT = new Date('2026-01-01T01:00:00Z')
/** The wall-clock instant the page loads at, fixed so the pause above is too. */
const CLOCK_INSTALL_AT = new Date('2026-01-01T00:00:00Z')

/**
 * Advance playback to t = 8.4 a.u. -- the fourteenth 0.6 a.u. step, and half
 * the 1s + 2p_z Bohr period to within 0.023 a.u.
 *
 * Every step here exists because of something that is otherwise a race:
 *
 *   - the clock is PAUSED first, so the fourteen ticks are the only time that
 *     passes and no fifteenth can arrive while the pause button is being
 *     clicked;
 *   - the first tick is run alone and the status bar is read, so the request
 *     for t = 0.6 is provably in flight before the rest run. The harness is
 *     holding its answer, so `useSceneAsset` keeps exactly one request open and
 *     remembers only the newest time behind it: the remaining thirteen ticks
 *     collapse into one queued instant instead of fourteen races;
 *   - playback is stopped BEFORE the held answer is released, so the queued
 *     instant is 8.4 and nothing can advance past it;
 *   - the clock is resumed last, because `page.clock` fakes
 *     requestAnimationFrame too: with it paused the new payload would be in the
 *     scene graph and never drawn, and the screenshot would be of the old frame.
 */
async function advanceToHalfPeriod(page: Page, ledger: RequestLedger): Promise<void> {
  const status = page.locator('span[data-status]')
  await page.clock.pauseAt(CLOCK_PAUSE_AT)
  await page.locator('[data-control="playback"]').click()

  await page.clock.runFor(PLAYBACK_INTERVAL_MS)
  await expect(status).toHaveAttribute('data-status', 'refreshing', SETTLE)
  await expect(status).toHaveText(/showing t=0\.0 a\.u\. · computing t=0\.6 a\.u\./, SETTLE)

  await page.clock.runFor(PLAYBACK_INTERVAL_MS * (HALF_PERIOD_STEPS - 1))
  await expect(status).toHaveText(/computing t=8\.4 a\.u\./, SETTLE)

  await page.locator('[data-control="playback"]').click()
  ledger.releaseHeld()
  await expect(status).toHaveAttribute('data-status', 'ready', SETTLE)
  await page.clock.resume()
  await expect(contractValue(page, 'Time')).toHaveText('8.40 a.u.', SETTLE)
}

/**
 * Where this picture's bytes came from -- asserted BEFORE the screenshot,
 * because a picture whose provenance is unknown is not evidence about anything.
 *
 * `served` is exact: these are the committed fixtures the frame is made of, and
 * an extra one means a fixture answered a question it is not the answer to.
 * `declared` is an upper bound on the questions the click path passes through
 * (a scene change aborts the request in flight, and an abort can beat the
 * dispatch), so what is asserted is that nothing OUTSIDE it was asked.
 */
function expectProvenance(
  ledger: RequestLedger,
  expected: { served: readonly string[]; declared: readonly string[] },
): void {
  expect(
    ledger.unexpected([...OPENING_QUESTIONS, ...expected.declared]),
    'the app asked the API something this test did not declare: either the UI now sends a ' +
      'different query for the same picture, or a fixture stopped matching the question it ' +
      'answers',
  ).toEqual([])
  expect(
    [...ledger.served].sort(),
    'the committed fixtures this frame was rendered from are not the ones the test is about',
  ).toEqual([...expected.served].sort())
  expect(ledger.offOrigin, 'a request was addressed off the preview origin').toEqual([])
}

/** The two catalogs, which every page load fetches whatever the test is about. */
const CATALOGS = ['catalog-orbitals', 'catalog-superposition']

/** The density section of 2p_z on xz: what the panel asks for the moment it switches. */
const EIGENSTATE_DENSITY_XZ = eigenstateSliceQuestion({
  n: '2',
  l: '1',
  m: '0',
  basis: 'real',
  plane: 'xz',
  observable: 'probability_density',
})

test('2p_z on xz: the nodal line lies across the plane, not down it', async ({ page, baseURL }) => {
  const ledger = await openApp(page, baseURL)
  await showPlaneSection(page)
  await chooseObservable(page, 'wavefunction_real')
  await settled(page)

  // The picture's own claims, in text: the section is the xz one, the field is
  // the signed amplitude in bohr^-3/2, and the colour scale is the largest
  // |value| on the plane -- 7.276e-2, i.e. the +-7.28e-2 pair of lobes the
  // fixture was chosen for. A diverging map centred anywhere but zero, or one
  // taking |value|, still prints these numbers; the baseline is what sees it.
  await expect(contractValue(page, 'Plane')).toHaveText('xz')
  await expect(contractValue(page, 'Value unit')).toHaveText('bohr^-3/2')
  await expect(contractValue(page, 'Max |value|')).toHaveText('7.276e-2')
  await expect(contractValue(page, 'Slice grid')).toHaveText('65 × 65 · Δ=0.583 bohr')
  await expect(contractValue(page, 'Masked fraction')).toHaveText('0.000%')
  await expect(page.locator('.legend-title')).toHaveText('Re ψ on the plane')

  expectProvenance(ledger, {
    served: [...CATALOGS, '2pz-real-xz'],
    declared: [
      EIGENSTATE_DENSITY_XZ,
      eigenstateSliceQuestion({
        n: '2',
        l: '1',
        m: '0',
        basis: 'real',
        plane: 'xz',
        observable: 'wavefunction_real',
      }),
    ],
  })

  // The picture. Two lobes of opposite sign, one above the other, separated by
  // a HORIZONTAL nodal line: u is x (screen +X) and v is z (screen +Y), and
  // 2p_z changes sign across z = 0. Reading the grid transposed puts that line
  // down the middle of the frame instead, which is the single most likely
  // renderer bug and the one nothing else in this repo can see.
  await expect(canvasOf(page)).toHaveScreenshot('2pz-real-xz.png', screenshotOptions(page))
  expect(ledger.offOrigin, 'a request escaped while the frame was being compared').toEqual([])
})

test('2p(+1) on xy: one winding around a masked disc', async ({ page, baseURL }) => {
  const ledger = await openApp(page, baseURL)
  await showPlaneSection(page)
  await page.locator('.segmented.two button:has-text("Complex / Lz")').click()
  await page.locator('.quantum-grid label:has-text("m") select').selectOption('1')
  await choosePlane(page, 'xy')
  await chooseObservable(page, 'phase')
  await settled(page)

  await expect(contractValue(page, 'Plane')).toHaveText('xy')
  await expect(contractValue(page, 'Value unit')).toHaveText('radian')
  await expect(page.locator('.legend-title')).toHaveText('Wavefunction phase')

  // The masked disc, as a number rather than as a hole someone squints at.
  // Exactly one of the 4225 samples is masked -- the origin, where r e^{i phi}
  // has no defined phase -- which is 0.0237%. The second assertion states the
  // claim the picture rests on: a client that ignored `valid_mask` would render
  // that sample as the sentinel 0.0, i.e. as phase 0, and would report a masked
  // fraction of zero here.
  await expect(contractValue(page, 'Masked fraction')).toHaveText('0.024%')
  await expect(contractValue(page, 'Masked fraction')).not.toHaveText('0.000%')
  await expect(contractValue(page, 'Masked value sentinel')).toHaveText('0.000')
  await expect(page.locator('.legend')).toContainText('0.0237% of this plane is masked')

  expectProvenance(ledger, {
    served: [...CATALOGS, '2p+1-phase-xy'],
    declared: [
      EIGENSTATE_DENSITY_XZ,
      // The three states the panel passes through on the way: complex basis,
      // then m = +1, then the xy plane, each of them a density section nobody
      // asked to look at.
      eigenstateSliceQuestion({
        n: '2', l: '1', m: '0', basis: 'complex', plane: 'xz', observable: 'probability_density',
      }),
      eigenstateSliceQuestion({
        n: '2', l: '1', m: '1', basis: 'complex', plane: 'xz', observable: 'probability_density',
      }),
      eigenstateSliceQuestion({
        n: '2', l: '1', m: '1', basis: 'complex', plane: 'xy', observable: 'probability_density',
      }),
      eigenstateSliceQuestion({
        n: '2', l: '1', m: '1', basis: 'complex', plane: 'xy', observable: 'phase',
      }),
    ],
  })

  // The picture. arg psi = phi on this plane, so the colour must wind once
  // through the full cycle going counter-clockwise from +u -- the direction
  // fixed by the frame's right-handedness (u x v = +z here). A mirrored normal
  // winds it the other way and passes every numeric check in the repo; the
  // masked origin must be a hole, not a coloured pixel.
  await expect(canvasOf(page)).toHaveScreenshot('2p+1-phase-xy.png', screenshotOptions(page))
  expect(ledger.offOrigin, 'a request escaped while the frame was being compared').toEqual([])
})

test('2s + 2p_z are degenerate: the same picture at t=0 and at t=8.4', async ({ page, baseURL }) => {
  const terms = SUPERPOSITION_TERMS['2s-2pz']
  const held = superpositionSliceQuestion({ terms, time: '0.6' })
  const ledger = await openApp(page, baseURL, { hold: held })
  await page.clock.install({ time: CLOCK_INSTALL_AT })
  await showPlaneSection(page)
  await page.locator('.representation-switch button:has-text("Superposition")').click()
  await settled(page)
  await page.locator('.mixture-list button:has-text("2s + 2p_z")').click()
  await settled(page)

  // The claim the control rests on, in the payload's own words: the terms share
  // an energy, so the density is stationary. Without this the test would be
  // asserting that two pictures match without saying why they must.
  await expect(contractValue(page, '⟨H⟩')).toHaveText('-0.125000 Ha · stationary density')
  await expect(page.locator('.warning-card')).toContainText(
    'all terms share one energy, so this superposition is stationary',
  )
  await expect(contractValue(page, 'Time')).toHaveText('0.00 a.u.')
  await expect(contractValue(page, 'Plane')).toHaveText('xz')

  // Provenance of THIS frame, before its baseline is compared. The t=8.4 half
  // of the test adds two more entries below; asserting only there would leave
  // the first screenshot's bytes unaccounted for at the moment it is taken.
  expectProvenance(ledger, {
    served: [...CATALOGS, '1s2pz-t0-xz', 'degenerate-stationary-xz-t0'],
    declared: [EIGENSTATE_DENSITY_XZ],
  })

  await expect(canvasOf(page)).toHaveScreenshot(
    'degenerate-stationary-xz.png',
    screenshotOptions(page),
  )

  await advanceToHalfPeriod(page, ledger)

  // Same state, same energy, a different instant -- and, because the phase is
  // global, the same |Psi|^2 to the last bit. The payload is a DIFFERENT file
  // (t=8.4 was computed independently), so this is not a tautology about
  // caching: it is the assertion that time evolution changed nothing it should
  // not have.
  await expect(contractValue(page, '⟨H⟩')).toHaveText('-0.125000 Ha · stationary density')
  await expect(contractValue(page, 'Time')).toHaveText('8.40 a.u.')

  expectProvenance(ledger, {
    served: [
      ...CATALOGS,
      // Switching mode lands on the store's default mixture before the preset
      // strip is touched, and that scene is a fixture too.
      '1s2pz-t0-xz',
      'degenerate-stationary-xz-t0',
      'degenerate-stationary-xz-t8.4',
    ],
    declared: [EIGENSTATE_DENSITY_XZ, held],
  })

  await expect(canvasOf(page)).toHaveScreenshot(
    'degenerate-stationary-xz.png',
    screenshotOptions(page),
  )
  expect(ledger.offOrigin, 'a request escaped while the frame was being compared').toEqual([])
})

test('1s + 2p_z at t=0: the dipole in its first lobe', async ({ page, baseURL }) => {
  const ledger = await openApp(page, baseURL)
  await showPlaneSection(page)
  await page.locator('.representation-switch button:has-text("Superposition")').click()
  await settled(page)

  await expect(contractValue(page, 'Time')).toHaveText('0.00 a.u.')
  await expect(contractValue(page, 'Plane')).toHaveText('xz')
  await expect(contractValue(page, 'Value unit')).toHaveText('bohr^-3')
  // The positive control's premise: these terms do NOT share an energy, so the
  // density is time-dependent. The degenerate test asserts the opposite string
  // on the same row.
  await expect(contractValue(page, '⟨H⟩')).toHaveText('-0.312500 Ha')
  await expect(page.locator('.legend-title')).toHaveText('Probability density')

  expectProvenance(ledger, {
    served: [...CATALOGS, '1s2pz-t0-xz'],
    declared: [EIGENSTATE_DENSITY_XZ],
  })

  await expect(canvasOf(page)).toHaveScreenshot('1s2pz-t0-xz.png', screenshotOptions(page))
  expect(ledger.offOrigin, 'a request escaped while the frame was being compared').toEqual([])
})

test('1s + 2p_z at t=8.4: half a Bohr period later, the lobe has swung over', async ({
  page,
  baseURL,
}) => {
  const held = superpositionSliceQuestion({ terms: SUPERPOSITION_TERMS['1s-2pz'], time: '0.6' })
  const ledger = await openApp(page, baseURL, { hold: held })
  await page.clock.install({ time: CLOCK_INSTALL_AT })
  await showPlaneSection(page)
  await page.locator('.representation-switch button:has-text("Superposition")').click()
  await settled(page)
  await expect(contractValue(page, 'Time')).toHaveText('0.00 a.u.')

  await advanceToHalfPeriod(page, ledger)
  await expect(contractValue(page, '⟨H⟩')).toHaveText('-0.312500 Ha')

  expectProvenance(ledger, {
    served: [...CATALOGS, '1s2pz-t0-xz', '1s2pz-t8.4-xz'],
    declared: [EIGENSTATE_DENSITY_XZ, held],
  })

  await expect(canvasOf(page)).toHaveScreenshot('1s2pz-t8.4-xz.png', screenshotOptions(page))

  // ... and it is a DIFFERENT picture from the one half a period earlier. Both
  // baselines exist, and an animation that quietly stopped evolving would match
  // both; this is the assertion that says the displacement is visible. The
  // degenerate test above is the same assertion with the sign reversed, which
  // is what makes either of them mean anything.
  await expect(canvasOf(page)).not.toHaveScreenshot('1s2pz-t0-xz.png', screenshotOptions(page))
  expect(ledger.offOrigin, 'a request escaped while the frame was being compared').toEqual([])
})

test('the comparison can see a transposed slice: the apparatus is not vacuous', async ({
  page,
  baseURL,
}) => {
  // The same question, answered with the same payload except that `values` is
  // transposed: u and v swapped, nothing else touched. Every client-side check
  // still passes -- `parseSlicePayload` sees the same frame, the same finite
  // samples and the same extreme, and the Inspector prints identical numbers
  // (asserted below) -- so this payload is invisible to every other test in the
  // repo. If the screenshot assertion cannot tell it from the committed one,
  // then neither can any of the five baselines above, and they are decoration.
  const ledger = await openApp(page, baseURL, {
    transform: { '2pz-real-xz': transposeSlicePayload },
  })
  await showPlaneSection(page)
  await chooseObservable(page, 'wavefunction_real')
  await settled(page)

  await expect(contractValue(page, 'Max |value|')).toHaveText('7.276e-2')
  await expect(contractValue(page, 'Slice grid')).toHaveText('65 × 65 · Δ=0.583 bohr')
  await expect(contractValue(page, 'Masked fraction')).toHaveText('0.000%')

  expectProvenance(ledger, {
    served: [...CATALOGS, '2pz-real-xz'],
    declared: [
      EIGENSTATE_DENSITY_XZ,
      eigenstateSliceQuestion({
        n: '2',
        l: '1',
        m: '0',
        basis: 'real',
        plane: 'xz',
        observable: 'wavefunction_real',
      }),
    ],
  })

  // The nodal line is vertical here and horizontal in the baseline. Compared
  // against the SAME budget the positive tests use, so this is a statement
  // about those tests and not about a stricter comparison invented for it.
  await expect(canvasOf(page)).not.toHaveScreenshot('2pz-real-xz.png', screenshotOptions(page))
  expect(ledger.offOrigin, 'a request escaped while the frame was being compared').toEqual([])
})
