/**
 * The switchboard: a press arriving on one route and coming out wherever the
 * command actually lives.
 *
 * Two things are worth testing hardest here. One is that the three kinds go to
 * three different places and a mistake about which is reported rather than
 * swallowed. The other is the routing question the desktop forced on this
 * package — WHICH client — because it is the part with no obvious right answer
 * and the part that is wrong in the most confusing way when it is wrong: a
 * panel opening in a window nobody is looking at.
 */

import { describe, expect, it } from 'vitest'
import {
  CLIENT_EVENTS_PATH,
  CLIENT_FOCUS_PATH,
  CLIENT_PARAM,
  MENU_INVOKE_PATH,
  type ClientEvent,
  type MenuItem,
} from '../src/index.ts'
import { events, mount, request, response, routeAt, type Mounted } from './harness.ts'

/** A command a browser client performs. */
const BROWSER_ITEM: MenuItem = {
  id: 'ask',
  label: 'Ask Here',
  section: 'help',
  command: { kind: 'browser' },
  accelerator: 'CmdOrCtrl+K',
}

/** A command the runtime performs. */
const RUNTIME_ITEM: MenuItem = { id: 'say-hello', label: 'Hello', section: 'help', command: { kind: 'runtime' } }

/** One subscribed client, and what it has been sent. */
interface Client {
  id: string
  received: () => ClientEvent[]
  disconnect: () => void
}

/**
 * Subscribe one browser client to a mounted plugin.
 * @param mounted - the mounted plugin.
 * @param id - the client's id.
 * @returns the client (see {@link Client}).
 */
async function subscribe(mounted: Mounted, id: string): Promise<Client> {
  const route = routeAt(mounted, CLIENT_EVENTS_PATH)
  const { res, recorded } = response()
  const req = request('GET', undefined, `${CLIENT_EVENTS_PATH}?${CLIENT_PARAM}=${id}`)
  await route.handler(req, res)
  return { id, received: () => events<ClientEvent>(recorded), disconnect: () => { req.close() } }
}

/**
 * Report one client's focus.
 * @param mounted - the mounted plugin.
 * @param id - the client's id.
 */
async function focus(mounted: Mounted, id: string): Promise<void> {
  const { res } = response()
  await routeAt(mounted, CLIENT_FOCUS_PATH).handler(request('POST', JSON.stringify({ client: id })), res)
}

/**
 * Press one command over the route the shell posts to.
 * @param mounted - the mounted plugin.
 * @param id - the command.
 * @returns the recorded response.
 */
async function press(mounted: Mounted, id: string) {
  const { res, recorded } = response()
  await routeAt(mounted, MENU_INVOKE_PATH).handler(request('POST', JSON.stringify({ id })), res)
  return recorded
}

describe('the client subscription', () => {
  it('hands over the document the moment it opens, so there is no unbound window', async () => {
    const mounted = mount({ items: [BROWSER_ITEM] })
    const client = await subscribe(mounted, 'a')
    // The frame carries the hint switch beside the document: a page decides
    // whether to teach its chords on the buttons from the same event that tells
    // it what the chords are.
    expect(client.received()).toEqual([{ kind: 'bindings', document: { version: 1, items: [BROWSER_ITEM] }, hints: true }])
  })

  it('refuses a subscriber that did not name itself', async () => {
    // A nameless stream would receive the document and never an invocation,
    // which is a subtler failure than a refusal.
    const mounted = mount({ items: [BROWSER_ITEM] })
    const { res, recorded } = response()
    await routeAt(mounted, CLIENT_EVENTS_PATH).handler(request('GET', undefined, CLIENT_EVENTS_PATH), res)
    expect(recorded.status).toBe(400)
  })
})

describe('where a press goes', () => {
  it('runs a runtime command here and never troubles a client with it', async () => {
    const mounted = mount({ items: [RUNTIME_ITEM, BROWSER_ITEM] })
    const client = await subscribe(mounted, 'a')
    let ran = 0
    mounted.shortcut()?.register('say-hello', () => { ran += 1 })

    expect((await press(mounted, 'say-hello')).status).toBe(200)
    expect(ran).toBe(1)
    expect(client.received().filter(event => event.kind === 'invoke')).toEqual([])
  })

  it('forwards a browser command to the client in front', async () => {
    const mounted = mount({ items: [BROWSER_ITEM] })
    const back = await subscribe(mounted, 'back')
    const front = await subscribe(mounted, 'front')
    await focus(mounted, 'front')

    expect((await press(mounted, 'ask')).status).toBe(200)
    expect(front.received()).toContainEqual({ kind: 'invoke', command: 'ask' })
    expect(back.received().filter(event => event.kind === 'invoke')).toEqual([])
  })

  it('follows focus as it moves, rather than pinning the first window it saw', async () => {
    const mounted = mount({ items: [BROWSER_ITEM] })
    const one = await subscribe(mounted, 'one')
    const two = await subscribe(mounted, 'two')

    await focus(mounted, 'one')
    await press(mounted, 'ask')
    await focus(mounted, 'two')
    await press(mounted, 'ask')

    expect(one.received().filter(event => event.kind === 'invoke')).toHaveLength(1)
    expect(two.received().filter(event => event.kind === 'invoke')).toHaveLength(1)
  })

  it('treats the newest connection as the front one until somebody says otherwise', async () => {
    // A tab that just opened is a tab somebody just opened. Without this, the
    // first press after opening a second window lands in the first one.
    const mounted = mount({ items: [BROWSER_ITEM] })
    const older = await subscribe(mounted, 'older')
    const newer = await subscribe(mounted, 'newer')

    await press(mounted, 'ask')
    expect(newer.received()).toContainEqual({ kind: 'invoke', command: 'ask' })
    expect(older.received().filter(event => event.kind === 'invoke')).toEqual([])
  })

  it('reports that nobody is home when the last client disconnects', async () => {
    const mounted = mount({ items: [BROWSER_ITEM] })
    const client = await subscribe(mounted, 'a')
    expect((await press(mounted, 'ask')).status).toBe(200)

    client.disconnect()
    // Declared, and nothing can perform it. Not a 404: the command exists and
    // the same press a moment later may well land.
    expect((await press(mounted, 'ask')).status).toBe(503)
  })

  it('ignores a focus report from a client it does not know, which is a race and not an error', async () => {
    // A reconnecting tab can report focus before its new subscription lands.
    // The next report settles it; an error is something the page could not act
    // on anyway.
    const mounted = mount({ items: [BROWSER_ITEM] })
    const { res, recorded } = response()
    await routeAt(mounted, CLIENT_FOCUS_PATH).handler(request('POST', JSON.stringify({ client: 'ghost' })), res)
    expect(recorded.status).toBe(204)
  })
})

describe('the switchboard service', () => {
  it('refuses a second handler for one command, rather than letting one win quietly', () => {
    const mounted = mount({ items: [RUNTIME_ITEM] })
    const shortcut = mounted.shortcut()
    shortcut?.register('say-hello', () => {})
    expect(() => shortcut?.register('say-hello', () => {})).toThrow(/already has a handler/)
  })

  it('gives the command back when its registration is spent', async () => {
    const mounted = mount({ items: [RUNTIME_ITEM] })
    const dispose = mounted.shortcut()?.register('say-hello', () => {})
    dispose?.()
    expect((await press(mounted, 'say-hello')).status).toBe(503)
  })

  it('lets a host plugin press a browser command, which is the same path a menu takes', async () => {
    const mounted = mount({ items: [BROWSER_ITEM] })
    const client = await subscribe(mounted, 'a')
    const outcome = await mounted.shortcut()?.invoke('ask')
    expect(outcome).toEqual({ kind: 'delivered', command: 'ask', client: 'a' })
    expect(client.received()).toContainEqual({ kind: 'invoke', command: 'ask' })
  })

  it('reports a handler that threw as a failure, not as a missing command', async () => {
    const mounted = mount({ items: [RUNTIME_ITEM] })
    mounted.shortcut()?.register('say-hello', () => { throw new Error('the handler broke') })
    const recorded = await press(mounted, 'say-hello')
    expect(recorded.status).toBe(500)
    expect(recorded.body).toContain('the handler broke')
  })
})

describe('unmounting', () => {
  it('unbinds every client at once rather than leaving keys pointing at nothing', async () => {
    const mounted = mount({ items: [BROWSER_ITEM] })
    const client = await subscribe(mounted, 'a')

    mounted.unmount()

    expect(client.received().at(-1)).toEqual({ kind: 'bindings', document: { version: 1, items: [] }, hints: true })
    expect(mounted.routes.size).toBe(0)
  })
})
