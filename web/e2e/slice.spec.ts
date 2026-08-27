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
 * racing drei's `Bounds` fit -- `OrbitControls`' damping was blamed alongside
 * it, which turned out to be wrong and is what the correction below is about
 * -- and it was upstream of everything here: no wait a harness can perform
 * fixes a scene that has genuinely stopped moving in the wrong place.
 * (Measured on Windows/ANGLE, but the race was in JavaScript, not in the
 * rasteriser, so SwiftShader would show it too.)
 *
 * REDUCED MOTION WAS ONCE CREDITED WITH FIXING THAT, AND IT DID NOT.
 * src/components/OrbitalCanvas.tsx does read `(prefers-reduced-motion: reduce)`
 * and, for a viewer who has asked for it, collapse the fit to
 * `maxDuration={0}` and turn `OrbitControls`' damping off; that is the
 * accessibility behaviour on its own terms, the same code path runs for every
 * such viewer whether or not anybody is taking screenshots, and
 * playwright.config.ts sets `reducedMotion: 'reduce'` on every context, so it
 * is the path these tests exercise. What it removes is the easing curve and the
 * damping tail -- the two things that could be sampled part-way through. What
 * it does not remove is the race, because the race was never about how LONG the
 * fit took. It was about what the fit had been aimed at.
 *
 * The mechanism, named properly. `Bounds` is mounted with `observe`, so it runs
 * fits of its own -- one from its mount, one on every canvas resize -- and each
 * captures a goal position and rotation from wherever the camera is AT THAT
 * MOMENT, then lands them from a `useFrame` one or more frames later.
 * `FitOnAssetChange` aims the camera imperatively but defers its own
 * `refresh().clip().fit()` to a `requestAnimationFrame`, and r3f's loop runs
 * before that callback. So a goal captured BEFORE the aim lands AFTER it,
 * writing the stale position and quaternion back over the aim -- and leaving
 * `up` alone, because a `Bounds` goal carries no `up` at all. The deferred
 * `refresh()` then measures the camera where the stale goal left it, and the
 * direction nobody chose is fitted to the right distance and kept. Collapsing
 * the durations only narrows the window; it does not close it, which is why
 * SwiftShader -- where a frame of this scene is expensive -- still lost the
 * race that Windows/ANGLE wins every time.
 *
 * MEASURED, not inferred, in both environments. Mounting the xz slice scene
 * under `@react-three/test-renderer` and reading the camera after 240 frames
 * instead of at the commit (src/components/OrbitalCanvas.test.tsx, "holds the
 * slice's pose once the frames have run") put the settled camera at
 * (19.2135, 11.5281, 23.0562) -- exactly 1.9214 times the `<Canvas>`'s own
 * opening position (10, 6, 12) -- with `up` still (0, 0, 1). The first CI
 * bootstrap drew that same pose: the parallelogram in its `1s2pz-t8.4-xz`
 * image has screen edge vectors in the ratio 1.158, against 1.174 predicted
 * for (10, 6, 12) with up (0, 0, 1) and 1.002 for the three-quarter default of
 * `cameraDirectionFor`. The pose CI settled at is the opening camera wearing
 * the section's own up, which is precisely what the repro produces.
 *
 * The fix is one line, and it is in the aim rather than in this suite:
 * `FitOnAssetChange` calls `bounds.refresh()` BEFORE it aims. `refresh()`
 * clears every field of the pending goal, so a fit in flight lands as a no-op
 * and the aim is the last word before the next fit is computed; a fit started
 * after the aim measures the aimed pose and is correct by construction.
 *
 * So step 3 is expected to pass -- on a stated mechanism now, rather than on a
 * hope about durations. If it still fails, that is a further defect of the same
 * kind, and the answer is the one it always was: find what is still moving. Do
 * not widen the budget. And note that the five images the first bootstrap
 * produced are NOT the baselines: that run predates both this fix and the
 * slice's fog fix (src/scene/SliceField.tsx), and every one of them is wrong.
 *
 * The two `.not.toHaveScreenshot` assertions (the mechanism control, and the
 * half-period check in the t = 8.4 test) reference baselines the POSITIVE tests
 * produce, so they are red in run 1 for the same "no baseline" reason and green
 * from run 2 on. They do NOT share the positive tests' per-pixel threshold --
 * the half-period one carries SENSITIVE_COMPARISON, because the first real-mode
 * run against committed baselines found it reporting a match over a lobe that
 * had visibly swung.
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
 * **The clock is set through the panel, not waited on.** The instant under test
 * is t = 8.4 a.u., and the time slider cannot express it. `TIME_BOUND`
 * (src/api/capability.ts) transcribes the route's own range as min = -1000 and
 * gives the widget a 0.6 a.u. increment, so the slider's grid is -1000 + 0.6n
 * -- ... 8.0, 8.6 ... -- and 8.4 is not on it. Measured against the built app:
 * `fill('8.4')` is refused as "Malformed value", and every DOM-level assignment
 * (the `value` property, the prototype setter, `valueAsNumber`) is snapped to
 * 8.6 before React's change handler ever sees it. The grid does not contain 0
 * either -- on a fresh load the store says t = 0 while the thumb sits at 0.2.
 *
 * capability.ts states what that number is FOR in as many words: "a fractional
 * step (a mass, a clock) is a display increment only and never snaps the
 * value", and `clampParameter` honours that -- the request layer clamps the
 * time into [-1000, 1000] and never rounds it. It is the browser's own range
 * sanitisation that disagrees. So `advanceToHalfPeriod` clears the display
 * increment for exactly one assignment, fills 8.4 through the input, and puts
 * the declared step straight back. Everything downstream is the app's: its
 * onChange, its store, its query, its texture. What is faked is one attribute
 * of one widget, for the duration of one event.
 *
 * WHY NOT PLAYBACK, AND WHY NOT A FAKE CLOCK. Playback reaches 8.4 honestly --
 * it steps 0.6 a.u. every 420 ms from the store's initial 0, and the fourteenth
 * tick is exactly 8.4 -- but stopping it there is a race with a 420 ms window.
 * (Nor can the two be combined: the slider's grid and the tick ladder are
 * incommensurate, so no slider value plus any number of ticks lands on 8.4.)
 * `page.clock` made those fourteen ticks deterministic and is what this suite
 * used until its first CI run, where it cost every screenshot taken after it:
 * the clock fakes `requestAnimationFrame` too, `toHaveScreenshot`'s stability
 * phase polls the element's box across rAF callbacks, and so each capture
 * following a `pauseAt`/`runFor` starved for its full 30 s and timed out --
 * a `resume()` before the capture did not revive it. The one screenshot taken
 * with the clock merely installed passed, which is what identifies the pause
 * rather than the install as the cause.
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
 *
 * THIS IS THE ACCEPT BUDGET, and only that. `threshold` here is tuned to absorb
 * a software rasteriser's noise, which is the right instrument for "this frame
 * must still look like the baseline" and the wrong one for "these two frames
 * must differ" -- a faint physical displacement hides under a perceptual bar
 * set for noise. The reject side therefore carries its own sensitivity; see
 * SENSITIVE_COMPARISON below, which changes nothing here.
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
 * The same budget with the PER-PIXEL bar lowered, for a `.not` assertion.
 *
 * An accept budget and a reject budget are not the same instrument, and using
 * one for both is what let a real defect through. `threshold` is a perceptual
 * tolerance: it exists to absorb a software rasteriser's own noise, and it does
 * that by declaring two pixels equal unless they differ by more than
 * `35215 * threshold^2` in pixelmatch's YIQ metric. That is exactly the wrong
 * instrument to point at a claim of the form "these two pictures MUST differ",
 * because a difference that is real but faint -- a deep-blue lobe moving across
 * a dark ground -- falls under the bar pixel by pixel and the assertion reports
 * a match.
 *
 * MEASURED, on the two committed baselines, through Playwright's own comparator
 * (`getComparator('image/png')`, i.e. pixelmatch with antialiased pixels
 * excluded, which is what its call site leaves at the default). The frame is
 * 656 x 1416, so `maxDiffPixelRatio` 0.001 is a budget of 928.9 pixels and an
 * assertion fires only above it:
 *
 *   threshold   surviving px   x budget
 *   0.2                   22       0.02
 *   0.1 (accept)         800       0.86   <- the guard could not fire
 *   0.05                3073       3.31
 *   0.03                4504       4.85
 *   0.02 (reject)       5994       6.45   <- chosen
 *   0.01                8402       9.05
 *   0                  24443      26.31
 *
 * ...against a noise floor measured the same way, on the same scene rendered
 * twice in two separate browser sessions: 19 pixels at threshold 0.1, 23 at
 * 0.02, and 26 at threshold 0 -- i.e. every pixel that is not bit-identical,
 * all of them in the animating star field. The floor never reaches 0.03 of the
 * budget at any threshold, so there is no value here at which noise alone could
 * satisfy a reject guard, and 0.02 sits 260x above it.
 *
 * 0.02 rather than something tighter ON PURPOSE. Lowering the threshold counts
 * MORE pixels, which makes a `.not` assertion EASIER to satisfy and therefore
 * WEAKER. The honest choice for a reject guard is the loosest threshold at
 * which the physics is still visible with room to spare, not the tightest one
 * available -- which is also why the transposed mechanism control below keeps
 * the tolerant budget rather than this one: it clears at threshold 0.1 with
 * 21212 pixels, 30x its budget, and moving it here would only weaken it.
 *
 * Nothing about the ACCEPT side changes: `maxDiffPixelRatio`, the timeout and
 * the mask are the same values, and no budget anywhere is widened.
 */
const SENSITIVE_COMPARISON = {
  ...COMPARISON,
  threshold: 0.02,
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

/** The same options with the reject side's per-pixel bar. Same mask, same budget. */
const sensitiveScreenshotOptions = (page: Page) => ({
  ...SENSITIVE_COMPARISON,
  mask: overlays(page),
})

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

/**
 * Half the 1s + 2p_z Bohr period to within 0.023 a.u., and the instant both
 * time-dependent fixture pairs were computed at. Spelled as the string the
 * input carries, because that is what is typed into it.
 */
const HALF_PERIOD_AU = '8.4'

/**
 * The time slider's declared increment, asserted rather than assumed.
 *
 * This is `TIME_BOUND.step` reaching the DOM. The helper below suspends it, so
 * it reads it back first: if the panel ever declares a step that DOES put 8.4
 * on the grid, the assertion fails, and the right response is to delete the
 * suspension rather than to keep overriding a constraint that no longer bites.
 */
const DECLARED_TIME_STEP = '0.6'

/** The panel's clock: `ParameterRow`'s range input for `timeAu`. */
const timeSlider = (page: Page): Locator => page.locator('input[data-parameter="timeAu"]')

/**
 * Set the clock to t = 8.4 a.u. through the panel, and prove the frame on
 * screen is the new one before returning.
 *
 * Two things happen here and both are deliberate.
 *
 * The DISPLAY INCREMENT is suspended for one assignment. 8.4 is not on the
 * slider's -1000 + 0.6n grid, so the browser's range sanitisation rewrites it
 * to 8.6 -- see the note at the top of this file, and capability.ts, which says
 * the step is a display increment that must never snap a clock. With `step`
 * cleared the fill is an ordinary user edit: React's own onChange reads 8.4 off
 * the input, `setTimeAu` stores it, and the query carries `time=8.4`. The
 * declared step goes back immediately, so the control is left exactly as the
 * app renders it -- including the thumb re-snapping to 8.6 over a store that
 * says 8.4, which is the state playback itself produces and not an artefact of
 * this test.
 *
 * The ANSWER IS HELD (`openApp(..., { hold })`), which turns the transition
 * into something assertable. Without it the fixture is served from memory and
 * the new frame is up before anything can look; with it the app sits in
 * `refreshing` -- old frame on screen, new instant named -- until this function
 * releases it. That is the keep-the-last-frame behaviour asserted directly,
 * and it replaces the fourteen-tick walk with one request for one instant.
 */
async function advanceToHalfPeriod(page: Page, ledger: RequestLedger): Promise<void> {
  const status = page.locator('span[data-status]')
  const clock = timeSlider(page)

  await expect(clock).toHaveAttribute('step', DECLARED_TIME_STEP)
  await clock.evaluate((input) => input.setAttribute('step', 'any'))
  await clock.fill(HALF_PERIOD_AU)
  await clock.evaluate((input, step) => input.setAttribute('step', step), DECLARED_TIME_STEP)

  // The old frame, still up, labelled with the instant it actually shows and
  // the one being computed. Both halves matter: a UI that relabelled the frame
  // on screen with the requested time would print "showing t=8.4" here over
  // pixels drawn at t=0.
  await expect(status).toHaveAttribute('data-status', 'refreshing', SETTLE)
  await expect(status).toHaveText(/showing t=0\.0 a\.u\. · computing t=8\.4 a\.u\./, SETTLE)

  ledger.releaseHeld()
  await expect(status).toHaveAttribute('data-status', 'ready', SETTLE)
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

  // The picture. arg psi = wrap(phi + pi) on this plane -- Y_1^1 carries the
  // Condon-Shortley minus sign, so phase 0 sits at -u, not at +u
  // (tests/test_slice_science.py:397 pins that, and the committed fixture reads
  // exactly pi on +x). The colour must still wind once through the full cycle
  // going counter-clockwise from +u -- the direction fixed by the frame's
  // right-handedness (u x v = +z here), which the pi offset shifts but cannot
  // reverse. A mirrored normal winds it the other way and passes every numeric
  // check in the repo; the masked origin must be a hole, not a coloured pixel.
  await expect(canvasOf(page)).toHaveScreenshot('2p+1-phase-xy.png', screenshotOptions(page))
  expect(ledger.offOrigin, 'a request escaped while the frame was being compared').toEqual([])
})

test('2s + 2p_z are degenerate: the same picture at t=0 and at t=8.4', async ({ page, baseURL }) => {
  const terms = SUPERPOSITION_TERMS['2s-2pz']
  // The t = 8.4 section of this mixture: a committed fixture, withheld so the
  // step away from t = 0 can be caught mid-flight rather than after the fact.
  const held = superpositionSliceQuestion({ terms, time: HALF_PERIOD_AU })
  const ledger = await openApp(page, baseURL, { hold: held })
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
      // The held one, now released: a single jump to t = 8.4 asks for the
      // instant under test and nothing between it and t = 0.
      'degenerate-stationary-xz-t8.4',
    ],
    declared: [EIGENSTATE_DENSITY_XZ],
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
  const held = superpositionSliceQuestion({
    terms: SUPERPOSITION_TERMS['1s-2pz'],
    time: HALF_PERIOD_AU,
  })
  const ledger = await openApp(page, baseURL, { hold: held })
  await showPlaneSection(page)
  await page.locator('.representation-switch button:has-text("Superposition")').click()
  await settled(page)
  await expect(contractValue(page, 'Time')).toHaveText('0.00 a.u.')

  await advanceToHalfPeriod(page, ledger)
  await expect(contractValue(page, '⟨H⟩')).toHaveText('-0.312500 Ha')

  expectProvenance(ledger, {
    served: [...CATALOGS, '1s2pz-t0-xz', '1s2pz-t8.4-xz'],
    declared: [EIGENSTATE_DENSITY_XZ],
  })

  await expect(canvasOf(page)).toHaveScreenshot('1s2pz-t8.4-xz.png', screenshotOptions(page))

  // ... and it is a DIFFERENT picture from the one half a period earlier. Both
  // baselines exist, and an animation that quietly stopped evolving would match
  // both; this is the assertion that says the displacement is visible. The
  // degenerate test above is the same assertion with the sign reversed, which
  // is what makes either of them mean anything.
  //
  // On the SENSITIVE budget, and this is the assertion that earned it. The
  // displacement here is a deep-blue lobe crossing a dark ground, so almost all
  // of it lands under a per-pixel bar set to absorb rasteriser noise: measured
  // on the two committed baselines, threshold 0.1 leaves 800 differing pixels
  // against a budget of 928.9 and this line reported a MATCH -- the guard could
  // not fire even though the lobe had visibly swung. See SENSITIVE_COMPARISON
  // for the whole threshold table and the noise floor it was chosen against.
  await expect(canvasOf(page)).not.toHaveScreenshot(
    '1s2pz-t0-xz.png',
    sensitiveScreenshotOptions(page),
  )
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
  // about those tests and not about a stricter comparison invented for it --
  // and it keeps that budget deliberately, rather than taking the half-period
  // guard's sensitive one. Measured on this build, normal against transposed:
  // 21212 differing pixels at threshold 0.1, 30x its 702.6 budget, and still
  // 16x at threshold 0.2. A lower threshold counts MORE pixels and so makes a
  // `.not` easier to satisfy; on the reject side the tolerant budget is the
  // stronger claim, and this assertion can afford it.
  await expect(canvasOf(page)).not.toHaveScreenshot('2pz-real-xz.png', screenshotOptions(page))
  expect(ledger.offOrigin, 'a request escaped while the frame was being compared').toEqual([])
})
