/**
 * The visual suite's configuration -- i.e. the definition of "the same pixels".
 *
 * A screenshot test compares this run's rendering against a committed PNG. It
 * is therefore only a regression test to the extent that everything OTHER than
 * the code under test is held fixed: the GPU stack, the viewport, the device
 * scale factor, the colour profile, the colour scheme, animation, the locale
 * and the timezone all change pixels, and none of them is part of what the
 * suite is trying to measure. Every option below is one of those knobs nailed
 * down, and each carries the reason it matters rather than being left to a
 * default that may change with a Playwright or Chromium bump.
 *
 * The version of @playwright/test is pinned EXACTLY in package.json (no
 * caret): the browser binaries are bundled per Playwright version, so a
 * "patch" bump ships a different Chromium and invalidates every baseline in
 * e2e/__screenshots__ at once. That is a deliberate, reviewed change with new
 * baselines, never a lockfile refresh.
 */
import { defineConfig } from '@playwright/test'

/**
 * The preview server the suite drives. `npm run preview` binds 127.0.0.1
 * (see package.json), so the URL must too -- `localhost` can resolve to ::1
 * first and then the readiness probe waits forever on a port nothing is
 * listening on.
 */
const PREVIEW_ORIGIN = 'http://127.0.0.1:4173'

/**
 * Off Linux this config REFUSES TO LOAD, before Playwright can launch
 * anything.
 *
 * The baselines in e2e/__screenshots__ are drawn by SwiftShader (Chromium's
 * software rasteriser) on the Linux CI image. Windows and macOS differ in font
 * rasterisation, sub-pixel positioning and the available ANGLE backends, so
 * the same code renders visibly different pixels there. That alone would only
 * be a nuisance -- every test red on a dev machine -- were it not for
 * `--update-snapshots`, which is the obvious next thing to reach for and which
 * would OVERWRITE the CI baselines with this machine's pixels. The suite would
 * then be green locally, red in CI, and no longer describe any regression at
 * all.
 *
 * So the guard is a hard throw at module load rather than a skip inside the
 * tests: a skip leaves `playwright test --update-snapshots` perfectly able to
 * run and write. Throwing here makes the whole runner unusable on this
 * platform, which is the point. Running the visual suite is a Linux-only
 * operation; there is no env-var bypass on purpose, because a bypass is
 * exactly what someone with red local pixels would set.
 */
if (process.platform !== 'linux') {
  throw new Error(
    `The visual suite is Linux/SwiftShader-only and this is ${process.platform}. The baselines ` +
      'in web/e2e/__screenshots__ are drawn by SwiftShader on the Linux CI image; every other ' +
      'platform renders different pixels, and running the suite here would either report false ' +
      'regressions or -- with --update-snapshots -- overwrite the CI baselines with this ' +
      "machine's rendering, permanently. Run it in CI, or in a Linux container.",
  )
}

export default defineConfig({
  testDir: 'e2e',

  /**
   * Baselines live beside the suite in e2e/__screenshots__/<spec>/<name>.png.
   *
   * No `{platform}` and no `{projectName}` segment, deliberately: there is
   * exactly ONE rendering environment for this suite (the guard above), so a
   * per-platform directory would only serve to let a second, unreviewed set of
   * baselines appear from a machine that should never have produced any.
   */
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',

  /**
   * The anti-tautology latch, half one of two.
   *
   * Playwright's DEFAULT is 'missing', which silently WRITES a baseline for
   * any screenshot that has none and reports the test as passed. That turns
   * the first run of a new assertion into its own answer key: whatever the
   * renderer drew becomes the definition of correct, including a bug. 'none'
   * makes a missing baseline a failure, so a baseline can only enter the tree
   * through `npm run test:visual:update` and a human looking at the PNG in the
   * diff.
   *
   * The other half is scripts/assert-visual-run.mjs, which reads this value
   * back out of the RESOLVED config in the JSON report and fails on anything
   * but 'none' -- because `--update-snapshots` on the command line overrides
   * this file, and a report from such a run is otherwise indistinguishable
   * from a real one.
   */
  updateSnapshots: 'none',

  /**
   * A retried screenshot comparison is not flaky, it is nondeterministic
   * rendering, and retrying until it passes is how that gets hidden. Zero
   * retries; one worker and no parallelism for the same reason -- concurrent
   * headless Chromium instances contend for the software rasteriser and
   * produce timing-dependent frames.
   */
  retries: 0,
  workers: 1,
  fullyParallel: false,

  /**
   * A committed `test.only` narrows the visual suite to one case while the run
   * still reports green -- the same hole `allowOnly: false` closes for vitest
   * (see vitest.config.ts). scripts/assert-visual-run.mjs would also catch it,
   * as the other specs would be absent from the report; this fails earlier and
   * says why.
   */
  forbidOnly: true,

  /**
   * `list` for the human reading CI logs, `json` for the gate. The JSON path
   * sits under Playwright's `outputDir` (`test-results/`), which the runner
   * wipes at the start of every run, so the gate cannot be handed a report
   * from an earlier run.
   */
  reporter: [['list'], ['json', { outputFile: 'test-results/visual-report.json' }]],

  use: {
    baseURL: PREVIEW_ORIGIN,
    browserName: 'chromium',

    // Every one of these changes pixels and none of them is what the suite
    // measures, so all are stated rather than inherited:
    //   viewport + deviceScaleFactor -- the framebuffer the screenshot IS;
    //   colorScheme -- the app themes off `prefers-color-scheme`;
    //   reducedMotion -- animations that are mid-frame at capture time are
    //     the classic source of a one-pixel diff that fails once a week;
    //   timezoneId + locale -- anything the UI formats (a date, a decimal
    //     separator, a thousands separator) is otherwise the CI runner's.
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    timezoneId: 'UTC',
    locale: 'en-US',
    // `reducedMotion` is NOT a top-level `use` option in @playwright/test
    // 1.62 -- it is only reachable through `contextOptions`, and writing it
    // beside `colorScheme` above is a type error rather than a silently
    // ignored key (verified: TS2769, "'reducedMotion' does not exist in type
    // 'UseOptions<...>'"). It reaches browser.newContext() from here, which is
    // the same place the top-level options end up.
    contextOptions: { reducedMotion: 'reduce' },

    launchOptions: {
      args: [
        // ANGLE on SwiftShader: a deterministic, CPU-only GL implementation
        // that renders identically on any x86-64 machine. This is what the
        // baselines are drawn by, and e2e/webgl.spec.ts asserts the renderer
        // string still says so -- a CI image that grows a GPU would otherwise
        // change every pixel of every baseline with no other symptom.
        '--use-angle=swiftshader',
        // Chromium 137+ refuses a software WebGL context without this, and the
        // failure is a null context rather than a fallback: the app renders
        // nothing and the baseline becomes an empty canvas.
        '--enable-unsafe-swiftshader',
        // Colour management off the host profile. Without it Chromium adapts
        // output to whatever display profile the machine reports, so the same
        // RGB values come out as different pixels on a different runner.
        '--force-color-profile=srgb',
        // Scrollbars are drawn by the platform theme and are 15px of
        // host-dependent pixels down the right edge of every full-page shot.
        '--hide-scrollbars',
        // Partial raster reuses tiles between frames, so a captured frame can
        // depend on what was rendered before it -- i.e. on test order.
        '--disable-partial-raster',
        // Skia's runtime CPU-feature detection picks different code paths
        // (and different rounding) per host; this pins the portable one.
        '--disable-skia-runtime-opts',
        //
        // NOT `--disable-gpu`: it disables the GPU process entirely, which
        // takes ANGLE/SwiftShader with it and leaves WebGL2 unavailable. The
        // flag reads like the software-rendering switch and is the opposite of
        // what this suite needs -- e2e/webgl.spec.ts fails loudly if it ever
        // gets added.
      ],
    },
  },

  /**
   * Built, not dev-served: the dev server transforms modules on demand and
   * ships HMR, so what it renders is not what ships. `--strictPort` makes a
   * port collision an error instead of a silent move to 4174, which would
   * leave the suite screenshotting whatever else is on 4173.
   *
   * `reuseExistingServer` off in CI (a stale server there is a stale build);
   * on locally, so a developer with a preview already running does not wait
   * for a second build.
   */
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: PREVIEW_ORIGIN,
    reuseExistingServer: !process.env.CI,
  },
})
