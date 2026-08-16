/**
 * The menu this plugin contributes: the document it publishes, the faults it
 * refuses to publish, and the routes it holds only while it is mounted.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ITEMS,
  MENU_EVENTS_PATH,
  MENU_INVOKE_PATH,
  MENU_PATH,
  SHELL_ACCELERATORS,
  UI_ACCELERATORS,
  UI_COMMANDS,
  WEB_ACCELERATORS,
  buildMenuDocument,
  claimFor,
  documentFor,
  duplicateAccelerators,
  type MenuDocument,
  type MenuItem,
} from '../src/index.ts'
import { mount, request, response, routeAt } from './harness.ts'

/** A runtime-owned item, which the shell posts back rather than performing. */
const RUNTIME_ITEM: MenuItem = {
  id: 'say-hello',
  label: 'Say Hello',
  section: 'help',
  command: { kind: 'runtime' },
}

describe('the contributed document', () => {
  it('publishes the shell tier, each item naming a capability the shell has', () => {
    const document = buildMenuDocument()
    expect(document.version).toBe(1)
    expect(document.items.filter(item => item.command.kind === 'shell').map(item => item.id)).toEqual([
      'new-window',
      'restart-runtime',
      'open-in-browser',
      'reveal-log',
      'idle-suspend',
    ])
  })

  it('publishes the UI tier as browser commands, so a tab performs them itself', () => {
    const document = buildMenuDocument()
    const ui = document.items.filter(item => item.command.kind === 'browser')
    // As a set: the items are ordered for the menus they join, and
    // `UI_COMMANDS` is ordered for reading. Neither should constrain the other.
    expect(ui.map(item => item.id).sort()).toEqual(Object.values(UI_COMMANDS).slice().sort())
    // A `runtime` command among them would mean a press that crossed the wire
    // to a process with no DOM; every one of these is performed in the page.
    expect(document.items.every(item => item.command.kind !== 'runtime')).toBe(true)
  })

  it('gives a web chord to exactly the items a browser would otherwise eat', () => {
    const explicit = Object.fromEntries(DEFAULT_ITEMS
      .filter(item => item.webAccelerator !== undefined)
      .map(item => [item.id, item.webAccelerator]))
    expect(explicit).toEqual({
      [UI_COMMANDS.toggleSidebar]: WEB_ACCELERATORS.toggleSidebar,
      [UI_COMMANDS.settings]: WEB_ACCELERATORS.settings,
      [UI_COMMANDS.settingsPlugins]: WEB_ACCELERATORS.settingsPlugins,
      [UI_COMMANDS.addWorkspace]: WEB_ACCELERATORS.addWorkspace,
      [UI_COMMANDS.modeChat]: WEB_ACCELERATORS.modeChat,
      [UI_COMMANDS.modeWork]: WEB_ACCELERATORS.modeWork,
      [UI_COMMANDS.modeCode]: WEB_ACCELERATORS.modeCode,
      [UI_COMMANDS.toggleDetails]: WEB_ACCELERATORS.toggleDetails,
      [UI_COMMANDS.sideChat]: WEB_ACCELERATORS.sideChat,
      [UI_COMMANDS.remdevConnect]: WEB_ACCELERATORS.remdevConnect,
    })
    // Every substitution is the same one — Alt for Shift, or Alt added — which
    // is what makes the second map memorable instead of a lookup table.
    for (const chord of Object.values(WEB_ACCELERATORS)) expect(chord.includes('Alt')).toBe(true)
  })

  it('leaves the archive chord native-only rather than binding a key a tab loses', () => {
    const archive = DEFAULT_ITEMS.find(item => item.id === UI_COMMANDS.archiveSession)
    expect(archive?.accelerator).toBe(UI_ACCELERATORS.archiveSession)
    // Absent, not null: the native chord is real, and the web surface reports
    // it `unreachable` on its own rather than being told to bind nothing.
    expect(archive?.webAccelerator).toBeUndefined()
    expect(claimFor(archive as MenuItem, 'web').holder).toBe('unreachable')
    expect(claimFor(archive as MenuItem, 'desktop').holder).toBe('native')
  })

  it('keeps the chord tiers the map is built on', () => {
    const chords = Object.fromEntries(DEFAULT_ITEMS.map(item => [item.id, item.accelerator]))
    expect(chords['new-window']).toBe(SHELL_ACCELERATORS.newWindow)
    expect(chords['restart-runtime']).toBe(SHELL_ACCELERATORS.restartRuntime)
    expect(chords['idle-suspend']).toBe(SHELL_ACCELERATORS.idleSuspend)
  })

  it('binds Remote Connect to Shift+C natively, swapping to Alt+C in a tab', () => {
    const connect = DEFAULT_ITEMS.find(item => item.id === UI_COMMANDS.remdevConnect)
    expect(connect?.accelerator).toBe(UI_ACCELERATORS.remdevConnect)
    expect(connect?.webAccelerator).toBe(WEB_ACCELERATORS.remdevConnect)
    // ⇧⌘C is Chrome's and Safari's inspect-element chord, so a tab gets the
    // substituted spelling rather than a key the browser may never hand over.
    expect(claimFor(connect as MenuItem, 'desktop').holder).toBe('native')
    expect(claimFor(connect as MenuItem, 'web').holder).toBe('page')
  })

  it('renders the idle setting as a checkbox, because the shell owns its state', () => {
    const idle = DEFAULT_ITEMS.find(item => item.id === 'idle-suspend')
    expect(idle?.checkbox).toBe(true)
  })

  it('claims no chord twice', () => {
    expect([...duplicateAccelerators(buildMenuDocument()).keys()]).toEqual([])
  })

  it('refuses to publish two items claiming one chord', () => {
    expect(() => documentFor({
      items: [
        { id: 'a', label: 'A', section: 'view', command: { kind: 'runtime' }, accelerator: 'CmdOrCtrl+J' },
        { id: 'b', label: 'B', section: 'view', command: { kind: 'runtime' }, accelerator: 'CmdOrCtrl+J' },
      ],
    })).toThrow(/both claim CmdOrCtrl\+J/)
  })

  it('refuses to publish two items sharing an id, which an invocation names', () => {
    expect(() => documentFor({
      items: [
        { id: 'same', label: 'A', section: 'view', command: { kind: 'runtime' } },
        { id: 'same', label: 'B', section: 'help', command: { kind: 'runtime' } },
      ],
    })).toThrow(/share the id same/)
  })

  it('refuses a web binding the browser keeps for itself, rather than shipping a dead key', () => {
    expect(() => documentFor({
      items: [{ id: 'ask', label: 'Ask', section: 'help', command: { kind: 'browser' }, webAccelerator: 'CmdOrCtrl+W' }],
    })).toThrow(/the browser keeps for itself/)
  })

  it('refuses a web binding it cannot read', () => {
    expect(() => documentFor({
      items: [{ id: 'ask', label: 'Ask', section: 'help', command: { kind: 'browser' }, webAccelerator: 'Ctrl+' }],
    })).toThrow(/not an accelerator this listener can read/)
  })

  it('publishes a NATIVE chord the browser keeps, because nothing asked the page for it', () => {
    // The distinction the whole `webAccelerator` field exists for. CmdOrCtrl+N
    // is a fine menu binding and a key a tab is never handed; only writing it
    // into `webAccelerator` is a request that cannot be met.
    expect(() => documentFor({
      items: [{ id: 'open', label: 'Open', section: 'file', command: { kind: 'browser' }, accelerator: 'CmdOrCtrl+N' }],
    })).not.toThrow()
  })

  it('refuses two items binding one chord in the page, even when their native chords differ', () => {
    expect(() => documentFor({
      items: [
        { id: 'a', label: 'A', section: 'view', command: { kind: 'browser' }, accelerator: 'CmdOrCtrl+1', webAccelerator: 'CmdOrCtrl+J' },
        { id: 'b', label: 'B', section: 'view', command: { kind: 'browser' }, accelerator: 'CmdOrCtrl+2', webAccelerator: 'CmdOrCtrl+J' },
      ],
    })).toThrow(/both bind CmdOrCtrl\+J in the page/)
  })

  it('lets two items share a chord when only one of them binds it in the page', () => {
    // A `shell` command has nothing to reach in a tab, so it binds nothing
    // there and cannot collide with what does.
    expect(() => documentFor({
      items: [
        { id: 'native', label: 'Native', section: 'view', command: { kind: 'shell', name: 'reveal-log' }, accelerator: 'CmdOrCtrl+1' },
        { id: 'page', label: 'Page', section: 'view', command: { kind: 'browser' }, webAccelerator: 'CmdOrCtrl+1' },
      ],
    })).not.toThrow()
  })
})

describe('the routes it holds while mounted', () => {
  it('serves the document, and refuses a method that is not a read', async () => {
    const mounted = mount()
    const route = routeAt(mounted, MENU_PATH)

    const read = response()
    await route.handler(request('GET'), read.res)
    expect(read.recorded.status).toBe(200)
    expect((JSON.parse(read.recorded.body) as MenuDocument).items).toHaveLength(DEFAULT_ITEMS.length)

    const written = response()
    await route.handler(request('POST'), written.res)
    expect(written.recorded.status).toBe(405)
  })

  it('runs an item it owns, and refuses one the shell performs itself', async () => {
    const mounted = mount({ items: [...DEFAULT_ITEMS, RUNTIME_ITEM] })
    const route = routeAt(mounted, MENU_INVOKE_PATH)
    let ran = 0
    mounted.shortcut()?.register('say-hello', () => { ran += 1 })

    const mine = response()
    await route.handler(request('POST', JSON.stringify({ id: 'say-hello' })), mine.res)
    expect(mine.recorded.status).toBe(200)
    expect(ran).toBe(1)

    // 'new-window' is the shell's own capability; posting it back would mean
    // the shell misread the document, so the plugin says it owns no such thing.
    const theirs = response()
    await route.handler(request('POST', JSON.stringify({ id: 'new-window' })), theirs.res)
    expect(theirs.recorded.status).toBe(404)
  })

  it('separates "no such command" from "nothing is home"', async () => {
    // The distinction is the whole diagnostic value of the route: a 404 says
    // the document and the shell disagree, and a 503 says they agree and the
    // composition is incomplete. Collapsing them would send whoever reads the
    // log looking in the wrong place.
    const mounted = mount({ items: [RUNTIME_ITEM] })
    const route = routeAt(mounted, MENU_INVOKE_PATH)

    const declared = response()
    await route.handler(request('POST', JSON.stringify({ id: 'say-hello' })), declared.res)
    expect(declared.recorded.status).toBe(503)

    const invented = response()
    await route.handler(request('POST', JSON.stringify({ id: 'nothing-like-it' })), invented.res)
    expect(invented.recorded.status).toBe(404)
  })

  it('refuses an invocation that is not JSON, rather than throwing at the socket', async () => {
    const mounted = mount({ items: [RUNTIME_ITEM] })
    const route = routeAt(mounted, MENU_INVOKE_PATH)
    const { res, recorded } = response()
    await route.handler(request('POST', 'not json'), res)
    expect(recorded.status).toBe(400)
  })

  it('pushes the document to a stream as soon as it opens', async () => {
    const mounted = mount()
    const route = routeAt(mounted, MENU_EVENTS_PATH)
    const { res, recorded } = response()
    await route.handler(request('GET'), res)
    expect(recorded.headers['content-type']).toContain('text/event-stream')
    const pushed = JSON.parse(recorded.body.replace(/^data: /, '').trim()) as MenuDocument
    expect(pushed.items).toHaveLength(DEFAULT_ITEMS.length)
  })

  it('takes the menu away on unmount: an empty document, then no routes at all', async () => {
    const mounted = mount()
    const route = routeAt(mounted, MENU_EVENTS_PATH)
    const { res, recorded } = response()
    await route.handler(request('GET'), res)
    recorded.body = ''

    mounted.unmount()

    // The open stream is told the menu is gone, so the shell drops back to the
    // platform's own menu without waiting for a request to fail.
    const retracted = JSON.parse(recorded.body.replace(/^data: /, '').trim()) as MenuDocument
    expect(retracted.items).toEqual([])
    expect(mounted.routes.size).toBe(0)
  })
})
