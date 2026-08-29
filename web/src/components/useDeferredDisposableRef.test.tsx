/** @vitest-environment jsdom */
import {
  createElement,
  forwardRef,
  StrictMode,
  useImperativeHandle,
  useLayoutEffect,
  type Ref,
  type RefCallback,
} from 'react'
import { describe, expect, it, vi } from 'vitest'

import { mount } from '../test/mount'
import {
  useDeferredDisposableRef,
  type DisposableResource,
} from './useDeferredDisposableRef'

interface FakeResource extends DisposableResource {
  readonly dispose: ReturnType<typeof vi.fn>
}

function resource(): FakeResource {
  return { dispose: vi.fn() }
}

/** A stand-in for EffectComposer's forwarded imperative handle. */
const ImperativeResource = forwardRef(function ImperativeResource(
  { value }: { value: FakeResource },
  ref: Ref<FakeResource>,
) {
  useImperativeHandle(ref, () => value, [value])
  return null
})

function ResourceOwner({ value }: { value: FakeResource }) {
  const ref = useDeferredDisposableRef<FakeResource>()
  return createElement(ImperativeResource, { ref, value })
}

function ConditionalResourceOwner({
  active,
  value,
}: {
  active: boolean
  value: FakeResource
}) {
  const ref = useDeferredDisposableRef<FakeResource>()
  return active ? createElement(ImperativeResource, { ref, value }) : null
}

function RefReporter({
  report,
}: {
  report: (ref: RefCallback<FakeResource>) => void
}) {
  const ref = useDeferredDisposableRef<FakeResource>()
  useLayoutEffect(() => report(ref), [ref, report])
  return null
}

describe('useDeferredDisposableRef', () => {
  it('disposes an imperative resource exactly once after an ordinary unmount', async () => {
    const value = resource()
    const tree = await mount(createElement(ResourceOwner, { value }))
    expect(value.dispose).not.toHaveBeenCalled()

    await tree.unmount()
    expect(value.dispose).toHaveBeenCalledTimes(1)

    // The mount helper deliberately permits a repeated unmount. React must not
    // turn that no-op into a second disposal of the same GPU resources.
    await tree.unmount()
    expect(value.dispose).toHaveBeenCalledTimes(1)
  })

  it('survives the StrictMode detach/reattach probe and disposes on the true unmount', async () => {
    const value = resource()
    const tree = await mount(
      createElement(StrictMode, null, createElement(ResourceOwner, { value })),
    )

    // StrictMode has already detached and reattached the callback ref here.
    // The microtask grace period must have cancelled that transient disposal.
    expect(value.dispose).not.toHaveBeenCalled()

    await tree.unmount()
    expect(value.dispose).toHaveBeenCalledTimes(1)
  })

  it('cancels a same-microtask reattachment and never disposes one handle twice', async () => {
    let ref: RefCallback<FakeResource> | undefined
    const report = (value: RefCallback<FakeResource>): void => {
      ref = value
    }
    const tree = await mount(createElement(RefReporter, { report }))
    expect(ref).toBeDefined()
    const first = resource()
    const second = resource()

    ref?.(first)
    ref?.(null)
    ref?.(first)
    await Promise.resolve()
    expect(first.dispose).not.toHaveBeenCalled()

    // Also cover the defensive direct-replacement path. React normally sends
    // null first, but an imperative adapter is allowed to hand the ref a new
    // handle directly.
    ref?.(second)
    await Promise.resolve()
    expect(first.dispose).toHaveBeenCalledTimes(1)

    ref?.(null)
    await Promise.resolve()
    expect(second.dispose).toHaveBeenCalledTimes(1)

    // A buggy adapter reusing an already-disposed handle still cannot make us
    // double-free its render targets.
    ref?.(second)
    ref?.(null)
    await Promise.resolve()
    expect(second.dispose).toHaveBeenCalledTimes(1)

    await tree.unmount()
  })

  it('disposes the abandoned instance once when an imperative handle is replaced', async () => {
    const first = resource()
    const second = resource()
    const tree = await mount(createElement(ResourceOwner, { value: first }))

    await tree.update(createElement(ResourceOwner, { value: second }))
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.dispose).not.toHaveBeenCalled()

    await tree.unmount()
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.dispose).toHaveBeenCalledTimes(1)
  })

  it('releases one distinct resource for every repeated effects exit', async () => {
    const values = Array.from({ length: 4 }, resource)
    const tree = await mount(
      createElement(ConditionalResourceOwner, { active: true, value: values[0] }),
    )

    for (let index = 0; index < values.length; index += 1) {
      await tree.update(
        createElement(ConditionalResourceOwner, { active: false, value: values[index] }),
      )
      expect(values[index].dispose).toHaveBeenCalledTimes(1)

      if (index + 1 < values.length) {
        await tree.update(
          createElement(ConditionalResourceOwner, {
            active: true,
            value: values[index + 1],
          }),
        )
      }
    }

    expect(values.map((value) => value.dispose.mock.calls.length)).toEqual([1, 1, 1, 1])
    await tree.unmount()
    expect(values.map((value) => value.dispose.mock.calls.length)).toEqual([1, 1, 1, 1])
  })
})
