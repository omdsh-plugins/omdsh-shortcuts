/**
 * What a page will and will not believe off the wire, and which of the two
 * surfaces it has decided it is.
 *
 * The framing is the part most likely to be wrong and the part that fails most
 * quietly — an event dropped for the wrong reason looks exactly like a key that
 * does not work — so the refusals are tested as carefully as the acceptances.
 */

import { describe, expect, it } from 'vitest'
import { CLIENT_EVENTS_PATH } from '../src/contract.ts'
import { followBindings, parseClientEvent, streamUrl, type EventSourceLike } from '../src/client/stream.ts'
import { detectSurface } from '../src/client/surface.ts'

/** A user agent as Electron writes it. */
const ELECTRON_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) omdsh/0.1.0 Chrome/140.0.0.0 Electron/43.4.0 Safari/537.36'
/** The same machine's browser. */
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

/** A stream under the spec's control. */
function fakeSource() {
  let listener: ((event: { data: string }) => void) | undefined
  let closed = false
  const source: EventSourceLike = {
    addEventListener: (_type, next) => { listener = next },
    close: () => { closed = true },
  }
  return {
    source,
    emit: (payload: string) => { listener?.({ data: payload }) },
    isClosed: () => closed,
  }
}

describe('detectSurface', () => {
  it('knows a window from a tab, which is the whole basis of who binds what', () => {
    expect(detectSurface({ navigator: { userAgent: ELECTRON_UA } })).toBe('desktop')
    expect(detectSurface({ navigator: { userAgent: CHROME_UA } })).toBe('web')
  })

  it('wants the slash, so a stray word in an agent string is not a verdict', () => {
    expect(detectSurface({ navigator: { userAgent: 'Something Electron Corp Browser/1.0' } })).toBe('web')
  })
})

describe('streamUrl', () => {
  it('names the client, escaped, because it is what an invocation is routed by', () => {
    expect(streamUrl('a b/c')).toBe(`${CLIENT_EVENTS_PATH}?client=a%20b%2Fc`)
  })
})

describe('parseClientEvent', () => {
  it('reads the two frames this build knows', () => {
    expect(parseClientEvent(JSON.stringify({ kind: 'invoke', command: 'ask' })))
      .toEqual({ kind: 'invoke', command: 'ask' })
    expect(parseClientEvent(JSON.stringify({ kind: 'bindings', document: { version: 1, items: [] } })))
      .toEqual({ kind: 'bindings', document: { version: 1, items: [] } })
  })

  it('drops a frame kind it does not know, so a newer runtime can add one', () => {
    expect(parseClientEvent(JSON.stringify({ kind: 'something-later', payload: 1 }))).toBeUndefined()
  })

  it('refuses a frame whose shape does not hold up', () => {
    expect(parseClientEvent('not json')).toBeUndefined()
    expect(parseClientEvent(JSON.stringify({ kind: 'invoke' }))).toBeUndefined()
    expect(parseClientEvent(JSON.stringify({ kind: 'bindings', document: { version: 1 } }))).toBeUndefined()
    expect(parseClientEvent(JSON.stringify({ kind: 'bindings', document: null }))).toBeUndefined()
  })
})

describe('followBindings', () => {
  it('sorts the two frames to the two handlers', () => {
    const fake = fakeSource()
    const bindings: unknown[] = []
    const invoked: string[] = []
    followBindings(() => fake.source, 'a', {
      onBindings: document => bindings.push(document),
      onInvoke: command => invoked.push(command),
    })

    fake.emit(JSON.stringify({ kind: 'bindings', document: { version: 1, items: [] } }))
    fake.emit(JSON.stringify({ kind: 'invoke', command: 'ask' }))

    expect(bindings).toEqual([{ version: 1, items: [] }])
    expect(invoked).toEqual(['ask'])
  })

  it('lets one malformed event cost that event and not the subscription', () => {
    const fake = fakeSource()
    const invoked: string[] = []
    followBindings(() => fake.source, 'a', { onBindings: () => {}, onInvoke: command => invoked.push(command) })

    fake.emit('{ half a')
    fake.emit(JSON.stringify({ kind: 'invoke', command: 'ask' }))

    expect(invoked).toEqual(['ask'])
  })

  it('subscribes on the address that names this client, and closes on disposal', () => {
    const fake = fakeSource()
    let opened = ''
    const dispose = followBindings((url) => { opened = url; return fake.source }, 'client-1', {
      onBindings: () => {},
      onInvoke: () => {},
    })
    expect(opened).toBe(streamUrl('client-1'))
    dispose()
    expect(fake.isClosed()).toBe(true)
  })
})
