import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LoadingOverlay } from './LoadingOverlay'

const render = (visible: boolean): string =>
  renderToStaticMarkup(createElement(LoadingOverlay, { visible }))

describe('LoadingOverlay covers the viewport only when there is nothing in it', () => {
  it('renders nothing at all when it is not visible', () => {
    // Not "renders an invisible div": App keeps the last frame on screen while
    // a refetch runs, and anything painted over the viewport at that moment
    // hides a picture that is still true.
    expect(render(false)).toBe('')
  })

  it('names what it is waiting for when it is visible', () => {
    const markup = render(true)
    expect(markup).toContain('loading-overlay')
    expect(markup).toContain('Computing quantum scene')
    expect(markup).toContain('sampling / meshing / GPU upload')
  })
})
