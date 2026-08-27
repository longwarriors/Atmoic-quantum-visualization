/**
 * The environment check every visual baseline in this directory depends on.
 *
 * A screenshot suite is only as trustworthy as the renderer that drew the
 * pixels. Chromium will happily fall back -- to a real GPU when one is
 * present, to a different ANGLE backend, or to no WebGL2 at all -- and each of
 * those silently changes every pixel of every baseline. The failure mode is
 * not a crash; it is a diff on every test, which the next person "fixes" with
 * `--update-snapshots`, at which point the baselines describe that machine's
 * GPU and the suite has stopped being a regression test.
 *
 * So this spec asserts the two facts the baselines are pinned to, and it
 * asserts them rather than skipping on them. `test.skip()` on "no WebGL2" is
 * the obvious spelling and it is exactly wrong: it turns the one condition
 * that invalidates every baseline into a green run. (scripts/
 * assert-visual-run.mjs fails on a skipped test for the same reason, so the
 * two guards agree; this one is the readable half.)
 *
 * There is no `toHaveScreenshot` here yet, deliberately: `updateSnapshots:
 * 'none'` means a screenshot assertion with no committed baseline is a
 * failure, and baselines can only be produced on Linux/SwiftShader. This file
 * is the harness that makes such a baseline meaningful; the baselines
 * themselves land with the renderer work that needs them.
 */
import { expect, test } from '@playwright/test'

/**
 * What the page reports about its own WebGL stack. Collected in ONE evaluate
 * so the context, the extension and the parameters all come from the same
 * canvas -- asking twice can answer about two different contexts.
 */
interface WebglReport {
  supported: boolean
  renderer: string
  vendor: string
  version: string
  unmasked: boolean
}

test('renders through a software WebGL2 stack, not whatever GPU is present', async ({ page }) => {
  await page.goto('/')

  const report: WebglReport = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (gl === null) {
      return { supported: false, renderer: '', vendor: '', version: '', unmasked: false }
    }
    // WEBGL_debug_renderer_info is what reports the REAL driver; without it
    // Chromium answers a generic masked string, which would match nothing and
    // must therefore be visible in the failure message rather than papered
    // over with a fallback that quietly weakens the assertion below.
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      supported: true,
      renderer: String(
        debug === null
          ? gl.getParameter(gl.RENDERER)
          : gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
      ),
      vendor: String(
        debug === null ? gl.getParameter(gl.VENDOR) : gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),
      ),
      version: String(gl.getParameter(gl.VERSION)),
      unmasked: debug !== null,
    }
  })

  expect(
    report.supported,
    'the browser gave up no WebGL2 context at all: every scene in this app renders nothing, so ' +
      'a screenshot baseline taken here would pin an empty canvas. This is a hard failure and ' +
      'not a skip on purpose -- a skip would report the broken environment as success.',
  ).toBe(true)

  expect(
    report.unmasked,
    'WEBGL_debug_renderer_info is unavailable, so the renderer string below is Chromium\'s ' +
      'masked generic answer and cannot prove which stack drew the pixels. Check the launch ' +
      'args in playwright.config.ts.',
  ).toBe(true)

  expect(
    report.renderer,
    `WebGL2 renderer is "${report.renderer}" (vendor "${report.vendor}", version ` +
      `"${report.version}"), not SwiftShader. Every committed baseline in e2e/__screenshots__ ` +
      'was drawn by SwiftShader; a hardware or otherwise different backend changes anti-' +
      'aliasing, gradient dithering and float precision, i.e. every pixel, and the diffs that ' +
      'follow are indistinguishable from a real regression.',
  ).toContain('SwiftShader')
})
