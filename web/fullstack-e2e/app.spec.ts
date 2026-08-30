/**
 * One deliberately linear product smoke over the production HTTP boundary.
 *
 * A linear test is useful here: every transition starts from a frame the user
 * can really reach, and each request is allowed to finish before the next one
 * begins. Splitting the representations into isolated pages would be faster
 * only by hiding state-transition and stale-frame bugs, which are exactly what
 * the browser layer needs to catch after unit tests have proved each function.
 */
import {
  expect,
  test,
  type APIResponse,
  type Page,
  type Request,
  type Response,
} from '@playwright/test'

type SceneMode = 'eigenstate' | 'superposition'
type Representation = 'point_cloud' | 'isosurface' | 'slice' | 'streamlines'

const STATUS = 'span[data-status]'
const API_TIMEOUT = 90_000
const QUIET_WINDOW_MS = 500
const DEFAULT_ORBITAL = {
  n: '2',
  l: '1',
  m: '0',
  z: '1',
  basis: 'real',
} as const
const FLOW_ORBITAL = {
  n: '3',
  l: '2',
  m: '2',
  z: '1',
  basis: 'complex',
} as const
const DEFAULT_SUPERPOSITION_TERMS =
  '1,0,0,0.7071067811865476;2,1,0,0.7071067811865476'

function responsePath(response: Response): string {
  return new URL(response.url()).pathname
}

function waitForApi(page: Page, path: string): Promise<Response> {
  return page.waitForResponse(
    (response) => response.request().method() === 'GET' && responsePath(response) === path,
    { timeout: API_TIMEOUT },
  )
}

async function expectSuccessful(response: APIResponse | Response): Promise<void> {
  const method = 'request' in response ? response.request().method() : 'GET'
  expect(
    response.status(),
    `${method} ${response.url()} returned ${response.status()} ${response.statusText()}`,
  ).toBeGreaterThanOrEqual(200)
  expect(response.status()).toBeLessThan(300)
}

async function expectApiSuccessful(
  response: Response,
  expectedQuery: Readonly<Record<string, string>>,
): Promise<void> {
  await expectSuccessful(response)
  const byKey = ([left]: readonly [string, string], [right]: readonly [string, string]) =>
    left.localeCompare(right)
  expect(
    [...new URL(response.url()).searchParams.entries()].toSorted(byKey),
    `the browser did not send the complete query for ${responsePath(response)}`,
  ).toEqual(Object.entries(expectedQuery).toSorted(byKey))
}

async function expectSettled(
  page: Page,
  mode: SceneMode,
  representation: Representation,
  visibleLabel: string,
): Promise<void> {
  const identity = `[data-scene-ready*="mode=${mode}"][data-scene-ready*="representation=${representation}"]`
  await expect(page.locator(identity)).toBeAttached({ timeout: API_TIMEOUT })
  await expect(page.locator(STATUS)).toHaveAttribute('data-status', 'ready', {
    timeout: API_TIMEOUT,
  })
  await expect(page.locator(`button[data-representation="${representation}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('#science-inspector')).toContainText(visibleLabel)
}

async function chooseRepresentation(
  page: Page,
  representation: Representation,
  endpoint: string,
  visibleLabel: string,
  expectedQuery: Readonly<Record<string, string>>,
): Promise<void> {
  const response = waitForApi(page, endpoint)
  await page.locator(`button[data-representation="${representation}"]`).click()
  await expectApiSuccessful(await response, expectedQuery)
  await expectSettled(page, 'eigenstate', representation, visibleLabel)
}

test('serves the built product and completes every core scene path against FastAPI', async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedApiRequests: string[] = []
  const failedApiResponses: string[] = []
  const pendingApiRequests = new Set<Request>()
  let lastObservedActivityAt = Date.now()

  const markObservedActivity = () => {
    lastObservedActivityAt = Date.now()
  }

  page.on('console', (message) => {
    if (message.type() === 'error') {
      markObservedActivity()
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    markObservedActivity()
    pageErrors.push(error.stack ?? error.message)
  })
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      pendingApiRequests.add(request)
      markObservedActivity()
    }
  })
  page.on('requestfinished', (request) => {
    if (pendingApiRequests.delete(request)) markObservedActivity()
  })
  page.on('requestfailed', (failed) => {
    if (pendingApiRequests.delete(failed)) markObservedActivity()
    const url = new URL(failed.url())
    if (url.pathname.startsWith('/api/')) {
      failedApiRequests.push(`${failed.method()} ${url.pathname}: ${failed.failure()?.errorText ?? 'failed'}`)
    }
  })
  page.on('response', (response) => {
    const path = responsePath(response)
    if (path.startsWith('/api/')) {
      markObservedActivity()
      if (response.status() < 200 || response.status() >= 300) {
        failedApiResponses.push(`${response.request().method()} ${path}: ${response.status()}`)
      }
    }
  })

  const health = await request.get('/api/health')
  await expectSuccessful(health)
  await expect(health.json()).resolves.toMatchObject({ status: 'ok', version: '0.1.0' })

  const initialPointCloud = waitForApi(page, '/api/orbitals/point-cloud')
  const documentResponse = await page.goto('/')
  expect(documentResponse, 'FastAPI returned no main-document response').not.toBeNull()
  await expectSuccessful(documentResponse as Response)
  expect((documentResponse as Response).headers()['content-type']).toContain('text/html')
  const pointCloud = await initialPointCloud
  await expectApiSuccessful(pointCloud, { ...DEFAULT_ORBITAL, samples: '28000', seed: '7' })
  expect(pointCloud.headers()['x-quviz-format']).toBe('QVPC/1')
  await expectSettled(page, 'eigenstate', 'point_cloud', '电子云')
  await expect(page.locator('#science-inspector')).toContainText('28,000 pts')
  await expect(page.locator('script[src*="/@vite/client"]')).toHaveCount(0)

  const docsLink = page.getByRole('link', { name: '查看 OpenAPI' })
  await expect(docsLink).toHaveAttribute('href', '/docs')
  const docsHref = await docsLink.getAttribute('href')
  expect(docsHref).not.toBeNull()
  expect(new URL(docsHref as string, page.url()).origin).toBe(new URL(page.url()).origin)
  const docsResponse = await request.get(docsHref as string)
  await expectSuccessful(docsResponse)
  expect(docsResponse.headers()['content-type']).toContain('text/html')
  expect(await docsResponse.text()).toContain('Swagger UI')
  const openApiResponse = await request.get('/openapi.json')
  await expectSuccessful(openApiResponse)
  expect(openApiResponse.headers()['content-type']).toContain('application/json')
  await expect(openApiResponse.json()).resolves.toMatchObject({
    info: { title: 'QuViz API', version: '0.1.0' },
  })

  await chooseRepresentation(
    page,
    'isosurface',
    '/api/orbitals/isosurface',
    '等密度面',
    { ...DEFAULT_ORBITAL, resolution: '65', probability_mass: '0.9' },
  )
  await chooseRepresentation(page, 'slice', '/api/orbitals/slice', '平面切片', {
    ...DEFAULT_ORBITAL,
    resolution: '65',
    a_mu: '1',
    plane: 'xz',
    observable: 'probability_density',
  })
  await expect(page.locator('.legend')).toContainText('概率密度 |ψ|²')

  const currentField = waitForApi(page, '/api/orbitals/current-field')
  const flowExample = page.locator('[data-flow-example]')
  await expect(flowExample).toBeVisible()
  await flowExample.click()
  await expectApiSuccessful(await currentField, { ...FLOW_ORBITAL, seed_count: '48' })
  await expectSettled(page, 'eigenstate', 'streamlines', '概率流线')
  await expect(page.locator('#science-inspector')).toContainText('48 lines')
  await expect(page.locator('.legend')).toContainText('概率流速率 |j|/ρ')

  await chooseRepresentation(
    page,
    'isosurface',
    '/api/orbitals/isosurface',
    '等密度面',
    { ...FLOW_ORBITAL, resolution: '65', probability_mass: '0.9' },
  )

  await page
    .getByRole('navigation', { name: '控制上下文' })
    .getByRole('button', { name: '态制备', exact: true })
    .click()
  const superposition = waitForApi(page, '/api/superposition/isosurface')
  await page
    .locator('.state-composition-section')
    .getByRole('button', { name: '叠加态', exact: true })
    .click()
  await expectApiSuccessful(await superposition, {
    terms: DEFAULT_SUPERPOSITION_TERMS,
    time: '0',
    resolution: '65',
    basis: 'complex',
    z: '1',
    a_mu: '1',
    probability_mass: '0.9',
  })
  await expectSettled(page, 'superposition', 'isosurface', '2 项叠加')
  await expect(page.locator('.topbar-context-value')).toContainText('1s + 2p_z (Bohr oscillation)')
  await expect(page.locator('.energy-pill')).toHaveText('-0.312500 Ha')

  await expect
    .poll(
      () =>
        pendingApiRequests.size === 0 &&
        Date.now() - lastObservedActivityAt >= QUIET_WINDOW_MS,
      { intervals: [100], timeout: API_TIMEOUT },
    )
    .toBe(true)
  expect(failedApiRequests, 'an API fetch failed before receiving an HTTP response').toEqual([])
  expect(failedApiResponses, 'an API endpoint returned a non-2xx response').toEqual([])
  expect(pageErrors, 'the page raised an uncaught browser exception').toEqual([])
  expect(consoleErrors, 'the production page wrote an error to the browser console').toEqual([])
})
