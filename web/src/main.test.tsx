/** @vitest-environment jsdom */
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

/**
 * The entry point is four lines and every one of them is a claim: that the
 * host element is `#root`, that the tree is mounted with `createRoot` (React
 * 19's client root, not the removed `ReactDOM.render`), and that it runs under
 * `StrictMode`. None of that is checked by any other spec, because every other
 * spec mounts a component directly.
 *
 * `App` itself is mocked: bringing in the real one would drag the whole
 * three.js canvas into a jsdom worker, which is a different test.
 */
vi.mock('./App', () => ({
  default: () => createElement('div', { 'data-app-mounted': 'true' }),
}))

/** Let React's scheduler flush the root it queued; `render` is not synchronous. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('main entry point', () => {
  it('mounts the app into #root', async () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)

    await import('./main')
    await flush()

    expect(root.querySelector('[data-app-mounted="true"]')).not.toBeNull()
  })
})
