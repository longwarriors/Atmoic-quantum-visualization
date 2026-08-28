/** @vitest-environment jsdom */
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mount, type MountedTree } from '../test/mount'
import { Header } from './Header'

/**
 * jsdom implements no canvas backend, so `HTMLCanvasElement.prototype
 * .toDataURL` does not exist at all: reaching it throws rather than returning
 * a blank image. The stub is what lets the capture path be exercised, and it
 * is installed per test and removed afterwards so no other spec inherits it.
 */
const DATA_URL = 'data:image/png;base64,QUJD'
const canvasPrototype = HTMLCanvasElement.prototype as unknown as {
  toDataURL?: (type?: string) => string
}

/** Anchors the header creates and clicks; they are never added to the document. */
let clicked: HTMLAnchorElement[] = []

beforeEach(() => {
  clicked = []
  canvasPrototype.toDataURL = () => DATA_URL
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  delete canvasPrototype.toDataURL
  document.querySelectorAll('canvas').forEach((canvas) => canvas.remove())
})

async function header(): Promise<MountedTree> {
  return mount(createElement(Header))
}

function captureButton(tree: MountedTree): HTMLButtonElement {
  const button = tree.container.querySelector<HTMLButtonElement>('button.icon-button.primary')
  if (button === null) throw new Error('the header offers no capture button')
  return button
}

describe('Header capture', () => {
  it('saves the canvas it can actually read, under a file-system-safe name', async () => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const tree = await header()
    try {
      captureButton(tree).click()

      expect(clicked).toHaveLength(1)
      expect(clicked[0].href).toBe(DATA_URL)
      // An ISO timestamp carries colons, which Windows refuses in a file name.
      expect(clicked[0].download).not.toContain(':')
      expect(clicked[0].download).toMatch(/^quviz-.*\.png$/)
    } finally {
      await tree.unmount()
    }
  })

  it('does nothing at all when there is no canvas to capture', async () => {
    // "Downloads nothing" is not enough on its own: a header that reached
    // straight for `canvas.toDataURL()` also downloads nothing, by throwing a
    // TypeError that React reports asynchronously and `click()` never rethrows.
    // So the uncaught-error channel is watched too, and the guard is what keeps
    // it empty.
    const raised: unknown[] = []
    const onError = (event: ErrorEvent): void => {
      raised.push(event.error)
      event.preventDefault()
    }
    window.addEventListener('error', onError)
    const tree = await header()
    try {
      captureButton(tree).click()
      expect(clicked).toHaveLength(0)
      expect(raised).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
      await tree.unmount()
    }
  })

  it('links to the OpenAPI document the scene contract is published in', async () => {
    const tree = await header()
    try {
      const link = tree.container.querySelector<HTMLAnchorElement>('a.icon-button')
      expect(link?.getAttribute('href')).toBe('http://127.0.0.1:8000/docs')
      expect(link?.rel).toBe('noreferrer')
      expect(tree.container.textContent).toContain('QuViz')
      expect(tree.container.textContent).toContain('量子态 · 可观测量 · 表示法')
      expect(tree.container.textContent).toContain('OpenAPI')
      expect(captureButton(tree).getAttribute('aria-label')).toBe('保存当前画布')
    } finally {
      await tree.unmount()
    }
  })
})
