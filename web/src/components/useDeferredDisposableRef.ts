import { type RefCallback, useCallback, useRef } from 'react'

/** The only lifecycle contract the ref owns. */
export interface DisposableResource {
  dispose(): void
}

/**
 * Own a disposable imperative handle exposed through a React callback ref.
 *
 * React can detach and immediately reattach the same ref while probing a tree
 * in StrictMode. Disposing synchronously on the transient `null` would leave
 * the reattached component holding render targets that have already been
 * destroyed. A one-microtask grace period lets that same-commit reattachment
 * cancel disposal, while a true unmount or an instance replacement still
 * releases the abandoned resource exactly once.
 */
export function useDeferredDisposableRef<
  Resource extends DisposableResource,
>(): RefCallback<Resource> {
  const attached = useRef<Resource | null>(null)
  const pending = useRef(new WeakMap<Resource, object>())
  const disposed = useRef(new WeakSet<Resource>())

  return useCallback((next: Resource | null) => {
    const deferDisposal = (resource: Resource): void => {
      const token = {}
      pending.current.set(resource, token)

      queueMicrotask(() => {
        if (pending.current.get(resource) !== token) return
        pending.current.delete(resource)
        if (disposed.current.has(resource)) return

        disposed.current.add(resource)
        resource.dispose()
      })
    }

    const previous = attached.current
    if (next !== null) {
      attached.current = next
      // A same-commit StrictMode reattachment makes the pending detach a
      // probe, not ownership ending.
      pending.current.delete(next)
      if (previous !== null && previous !== next) deferDisposal(previous)
      return
    }

    attached.current = null
    if (previous !== null) deferDisposal(previous)
  }, [])
}
