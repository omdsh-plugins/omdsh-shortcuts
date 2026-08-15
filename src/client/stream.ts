/**
 * Following the runtime's bindings, and receiving the presses this page could
 * not hear for itself.
 *
 * One subscription carries both, because they are the same fact arriving at
 * different times: what this page is supposed to answer to, and one instance of
 * it happening. Opening the stream is the whole handshake — the document
 * arrives on connect, so there is no separate read and no window in which a
 * page is mounted with no bindings.
 *
 * The stream is opened through an injected function rather than by naming
 * `EventSource` here. That keeps this module free of the DOM, which is worth
 * more than it sounds: the framing and the refusal to trust a payload are the
 * parts most likely to be wrong, and this way they are testable without a
 * browser standing in the way.
 * @module @omdsh-plugins/omdsh-shortcuts/src/client/stream
 */

import { CLIENT_EVENTS_PATH, CLIENT_PARAM, type ClientEvent, type MenuDocument } from '../contract.ts'

/** As much of `EventSource` as this module uses. */
export interface EventSourceLike {
  /**
   * Receive each `data:` payload the stream carries.
   * @param type - the event name; only `message` is subscribed.
   * @param listener - called with the payload.
   */
  addEventListener: (type: 'message', listener: (event: { data: string }) => void) => void
  /** Stop listening and drop the connection. */
  close: () => void
}

/**
 * Open one stream.
 * @param url - the address to subscribe to.
 * @returns the subscription.
 */
export type OpenStream = (url: string) => EventSourceLike

/** What a subscriber does with what arrives. */
export interface StreamHandlers {
  /**
   * The document, on connect and on every later revision.
   * @param document - the current bindings; an empty one means the publisher is going away.
   */
  onBindings: (document: MenuDocument) => void
  /**
   * One command, pressed somewhere this page could not hear.
   * @param command - the item's id.
   */
  onInvoke: (command: string) => void
}

/**
 * The address a client subscribes on.
 * @param client - this client's id.
 * @returns the path, with the client named.
 */
export function streamUrl(client: string): string {
  return `${CLIENT_EVENTS_PATH}?${CLIENT_PARAM}=${encodeURIComponent(client)}`
}

/**
 * Read one payload, refusing anything that is not an event this build knows.
 *
 * An unknown `kind` is dropped rather than guessed at. The stream is versioned
 * by the document it carries, not by the frame, so a newer runtime adding a
 * frame type must be able to assume an older page ignores it.
 * @param payload - the `data:` text.
 * @returns the event, or undefined when it is not one.
 */
export function parseClientEvent(payload: string): ClientEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(payload)
  }
  catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const source = value as Record<string, unknown>
  if (source.kind === 'invoke') {
    return typeof source.command === 'string' ? { kind: 'invoke', command: source.command } : undefined
  }
  if (source.kind !== 'bindings') return undefined
  const document = source.document
  if (typeof document !== 'object' || document === null) return undefined
  const shape = document as Record<string, unknown>
  if (typeof shape.version !== 'number' || !Array.isArray(shape.items)) return undefined
  return { kind: 'bindings', document: document as MenuDocument }
}

/**
 * Subscribe for as long as the returned disposer is unspent.
 *
 * Reconnection is `EventSource`'s own and is left to it: the runtime restarting
 * or this plugin remounting is exactly the case it retries for, and a plugin
 * that comes back should find its pages already listening.
 * @param open - opens the stream.
 * @param client - this client's id.
 * @param handlers - what to do with what arrives.
 * @returns the removal.
 */
export function followBindings(open: OpenStream, client: string, handlers: StreamHandlers): () => void {
  const source = open(streamUrl(client))
  source.addEventListener('message', (event) => {
    const parsed = parseClientEvent(event.data)
    // One malformed event costs that event, not the subscription.
    if (parsed === undefined) return
    if (parsed.kind === 'bindings') handlers.onBindings(parsed.document)
    else handlers.onInvoke(parsed.command)
  })
  return () => { source.close() }
}
