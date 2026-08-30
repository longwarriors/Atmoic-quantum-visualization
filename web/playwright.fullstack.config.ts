/**
 * Product-path browser smoke: the built SPA, real Python API, and MkDocs site.
 *
 * This is intentionally separate from playwright.config.ts. The visual suite
 * replaces `/api` with committed fixtures so a pixel diff can only be about
 * rendering; this suite does the opposite and intercepts nothing. Uvicorn
 * serves `web/dist` through the production `create_app()` mount, so one green
 * run proves the browser, generated client, binary parser, route validation,
 * scientific builders and static-file mount agree on the source-checkout
 * production path. A second server checks client-side documentation rendering;
 * wheel packaging is a separate, still-open release concern.
 */
import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// 8000 is the documented API port and 8001 the documented MkDocs port. Keep
// both test servers on their own fail-fast ports so a run cannot reuse or kill
// either development service.
const FULLSTACK_ORIGIN = 'http://127.0.0.1:8765'
const DOCS_ORIGIN = 'http://127.0.0.1:8766'
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  testDir: 'fullstack-e2e',
  outputDir: 'test-results/fullstack',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  updateSnapshots: 'none',
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/fullstack/results.json' }],
    ['html', { outputFolder: 'playwright-report/fullstack', open: 'never' }],
  ],
  use: {
    baseURL: FULLSTACK_ORIGIN,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: [
    {
      name: 'QuViz FastAPI',
      command:
        'npm --prefix web run build && uv run --locked --no-dev --no-sync quviz serve --host 127.0.0.1 --port 8765',
      cwd: REPOSITORY_ROOT,
      url: `${FULLSTACK_ORIGIN}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      name: 'QuViz MkDocs',
      command:
        'uv run --locked --no-sync --group docs mkdocs serve --strict --no-livereload -a 127.0.0.1:8766',
      cwd: REPOSITORY_ROOT,
      url: DOCS_ORIGIN,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
