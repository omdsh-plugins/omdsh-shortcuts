/**
 * The chords as a setting.
 *
 * Two halves. `applyBindings` is the pure layering — what an override means
 * over a composed item list. The rest is the seam: that a rebinding reaches
 * every open shell and page WITHOUT a restart, that a chord which could only
 * ever do nothing is refused at the write, and that a stored section which
 * turns unusable underneath the plugin costs the change rather than the menu.
 */

import { describe, expect, it } from 'vitest'
import {
  applyBindings, effectiveBindings, invalidBindings, UNBIND,
  Config, DEFAULT_ITEMS, SETTINGS_NAMESPACE, documentFor,
  MENU_EVENTS_PATH, CLIENT_EVENTS_PATH, CLIENT_PARAM,
  type ClientEvent, type MenuDocument, type MenuItem,
} from '../src/index.ts'
import { MemorySettings, events, mount, request, response, routeAt } from './harness.ts'

/** One item, with only what the assertion cares about spelled out. */
function item(overrides: Partial<MenuItem> = {}): MenuItem {
  return { id: 'a', label: 'A', section: 'view', command: { kind: 'runtime' }, ...overrides }
}

/** The chord one id currently answers to in a document. */
function chordOf(document: MenuDocument, id: string): string | undefined {
  return document.items.find(candidate => candidate.id === id)?.accelerator
}

describe('applyBindings', () => {
  it('replaces an item\'s accelerator', () => {
    const applied = applyBindings([item({ accelerator: 'CmdOrCtrl+A' })], { a: 'CmdOrCtrl+Shift+B' })
    expect(applied[0]?.accelerator).toBe('CmdOrCtrl+Shift+B')
  })

  it('binds a chord to an item the composition gave none', () => {
    expect(applyBindings([item()], { a: 'CmdOrCtrl+K' })[0]?.accelerator).toBe('CmdOrCtrl+K')
  })

  it('drops the accelerator on the unbind value', () => {
    const applied = applyBindings([item({ accelerator: 'CmdOrCtrl+A' })], { a: UNBIND })
    // Dropped, not emptied: an item without an accelerator is already what
    // "on the menu, no key" means everywhere else in this package.
    expect(applied[0]).not.toHaveProperty('accelerator')
    expect(applied[0]?.label).toBe('A')
  })

  it('leaves the web binding exactly as composed', () => {
    // `webAccelerator` says something about the SURFACE — "a tab is never
    // handed this key" — not about which chord was chosen.
    const applied = applyBindings(
      [item({ accelerator: 'CmdOrCtrl+N', webAccelerator: null })],
      { a: 'CmdOrCtrl+Shift+N' },
    )
    expect(applied[0]?.webAccelerator).toBeNull()
  })

  it('ignores an override for an item that is not there', () => {
    // The item list is composition and it moves; a stale override must never
    // be able to stop this plugin from mounting.
    expect(applyBindings([item()], { 'went-away': 'CmdOrCtrl+K' })).toEqual([item()])
  })

  it('leaves untouched items alone, in order', () => {
    const items = [item({ id: 'a' }), item({ id: 'b', accelerator: 'CmdOrCtrl+B' })]
    const applied = applyBindings(items, { a: 'CmdOrCtrl+A' })
    expect(applied.map(candidate => candidate.id)).toEqual(['a', 'b'])
    expect(applied[1]).toBe(items[1])
  })

  it('is the identity with no overrides', () => {
    expect(applyBindings(DEFAULT_ITEMS)).toEqual([...DEFAULT_ITEMS])
  })
})

describe('invalidBindings', () => {
  it('refuses a chord nothing could hold', () => {
    expect(invalidBindings({ a: 'Ctrl+' })).toEqual([{ id: 'a', accelerator: 'Ctrl+' }])
    expect(invalidBindings({ a: 'nonsense' })).toHaveLength(1)
  })

  it('accepts the unbind value and a well-formed chord', () => {
    expect(invalidBindings({ a: UNBIND, b: 'CmdOrCtrl+Shift+K' })).toEqual([])
  })

  it('says nothing about an unknown id, which is drift rather than a mistake', () => {
    expect(invalidBindings({ 'went-away': 'CmdOrCtrl+K' })).toEqual([])
  })
})

describe('effectiveBindings', () => {
  it('shows the whole keyboard, not just the diff', () => {
    // A form seeded from a bare override map starts empty, and an empty map
    // reads as "this plugin binds nothing".
    const effective = effectiveBindings(DEFAULT_ITEMS)
    expect(effective['new-window']).toBe('CmdOrCtrl+N')
    expect(Object.keys(effective)).toHaveLength(DEFAULT_ITEMS.length)
  })

  it('reports an unbound item as the unbind value', () => {
    expect(effectiveBindings([item({ accelerator: 'CmdOrCtrl+A' })], { a: UNBIND })).toEqual({ a: UNBIND })
  })
})

describe('documentFor with bindings', () => {
  it('serves the shipped items under the user\'s chords', () => {
    const document = documentFor({ bindings: { 'new-window': 'CmdOrCtrl+Shift+N' } })
    expect(chordOf(document, 'new-window')).toBe('CmdOrCtrl+Shift+N')
  })

  it('treats an empty item list as "the shipped set"', () => {
    // Which is what an absent settings section resolves to, through the
    // schema default.
    expect(documentFor({ items: [] }).items).toHaveLength(DEFAULT_ITEMS.length)
  })

  it('refuses a chord that is not one', () => {
    expect(() => documentFor({ bindings: { 'new-window': 'Ctrl+' } }))
      .toThrow(/not an accelerator this package can read/)
  })

  it('still refuses two items claiming one chord, however it was claimed', () => {
    expect(() => documentFor({ bindings: { 'new-window': 'CmdOrCtrl+Alt+R' } }))
      .toThrow(/both claim CmdOrCtrl\+Alt\+R/)
  })
})

describe('Config', () => {
  it('resolves an absent section to the shipped behaviour', () => {
    expect(Config({})).toEqual({ items: [], bindings: {}, hints: true })
  })

  it('hides the item list from a generated form and shows the chords', () => {
    const envelope = JSON.parse(JSON.stringify(Config.toJSON())) as {
      uid: number
      refs: Record<string, { meta?: { hidden?: boolean; description?: unknown }; dict?: Record<string, number> }>
    }
    const root = envelope.refs[String(envelope.uid)]
    const nodeOf = (key: string) => envelope.refs[String(root?.dict?.[key])]
    // A five-field object with a discriminated union in it is not something a
    // generated form can offer without writing the wrong shape.
    expect(nodeOf('items')?.meta?.hidden).toBe(true)
    expect(nodeOf('bindings')?.meta?.hidden).toBeUndefined()
    // Localized, so no panel needs a dictionary for this plugin's fields.
    expect(nodeOf('bindings')?.meta?.description).toMatchObject({ zh: expect.any(String) })
  })

  it('names the namespace this package.json declares', () => {
    expect(SETTINGS_NAMESPACE).toBe('omdsh-shortcuts')
  })
})

describe('the settings seam', () => {
  it('seeds the panel with every command\'s chord, not with an empty diff', () => {
    const settings = new MemorySettings()
    const mounted = mount({}, settings)
    const seeded = (settings.base as { bindings?: Record<string, string> }).bindings ?? {}
    // One row per command, so the form opens as a picture of the keyboard and
    // rebinding is editing a row that is already there rather than guessing an
    // id and typing it in.
    expect(Object.keys(seeded).sort()).toEqual(DEFAULT_ITEMS.map(item => item.id).sort())
    expect(seeded['session.new']).toBe('CmdOrCtrl+K')
    expect(seeded['panel.terminal']).toBe('Ctrl+`')
    mounted.unmount()
  })

  it('changes nothing by seeding, because the seed is read off the items', () => {
    const settings = new MemorySettings()
    const seeded = mount({}, settings)
    const bare = mount({})
    // Laying the seed back over the items it was derived from has to be the
    // identity, or every fresh install would quietly differ from its own
    // defaults.
    expect(seeded.shortcut()!.document()).toEqual(bare.shortcut()!.document())
    seeded.unmount()
    bare.unmount()
  })

  it('seeds from the COMPOSED items when a profile named its own', () => {
    const settings = new MemorySettings()
    const items = [item({ id: 'only', accelerator: 'CmdOrCtrl+Alt+J' })]
    const mounted = mount({ items }, settings)
    expect((settings.base as { bindings?: Record<string, string> }).bindings)
      .toEqual({ only: 'CmdOrCtrl+Alt+J' })
    mounted.unmount()
  })

  it('runs without a settings provider, on the composition config alone', () => {
    const mounted = mount({ bindings: { 'new-window': 'CmdOrCtrl+Shift+N' } })
    expect(chordOf(mounted.shortcut()!.document(), 'new-window')).toBe('CmdOrCtrl+Shift+N')
    mounted.unmount()
  })

  it('layers the stored section over the composition entry', () => {
    const settings = new MemorySettings()
    settings.section = { bindings: { 'reveal-log': 'CmdOrCtrl+Shift+G' } }
    const mounted = mount({}, settings)
    expect(chordOf(mounted.shortcut()!.document(), 'reveal-log')).toBe('CmdOrCtrl+Shift+G')
    // Everything the person did not touch stays where the composition put it.
    expect(chordOf(mounted.shortcut()!.document(), 'new-window')).toBe('CmdOrCtrl+N')
    mounted.unmount()
  })

  it('pushes a rebinding to the shells and pages already listening', () => {
    const settings = new MemorySettings()
    const mounted = mount({}, settings)

    const shell = response()
    routeAt(mounted, MENU_EVENTS_PATH).handler(request('GET'), shell.res)
    const page = response()
    routeAt(mounted, CLIENT_EVENTS_PATH).handler(
      request('GET', undefined, `/?${CLIENT_PARAM}=tab-1`),
      page.res,
    )

    settings.write({ bindings: { 'new-window': 'CmdOrCtrl+Shift+N' } })

    // Both audiences hold a stale copy otherwise: the shell has built a
    // native menu and the page has bound keys.
    const shellDocuments = events<MenuDocument>(shell.recorded)
    expect(chordOf(shellDocuments[shellDocuments.length - 1] as MenuDocument, 'new-window')).toBe('CmdOrCtrl+Shift+N')
    const pageEvents = events<ClientEvent>(page.recorded)
    const last = pageEvents[pageEvents.length - 1]
    expect(last?.kind).toBe('bindings')
    expect(chordOf((last as { document: MenuDocument }).document, 'new-window')).toBe('CmdOrCtrl+Shift+N')
    mounted.unmount()
  })

  it('serves the new document to a client that connects afterwards', () => {
    const settings = new MemorySettings()
    const mounted = mount({}, settings)
    settings.write({ bindings: { 'new-window': UNBIND } })
    const late = response()
    routeAt(mounted, MENU_EVENTS_PATH).handler(request('GET'), late.res)
    expect(chordOf(events<MenuDocument>(late.recorded)[0] as MenuDocument, 'new-window')).toBeUndefined()
    mounted.unmount()
  })

  it('refuses the write that would produce an unusable document', () => {
    const settings = new MemorySettings()
    const mounted = mount({}, settings)
    // Refused at the write, not at the next mount: the person is told now,
    // while they are looking at the field they just changed.
    expect(() => settings.write({ bindings: { 'new-window': 'Ctrl+' } })).toThrow(/not an accelerator/)
    expect(chordOf(mounted.shortcut()!.document(), 'new-window')).toBe('CmdOrCtrl+N')
    mounted.unmount()
  })

  it('keeps the last good menu when a stored section turns unusable underneath it', () => {
    const settings = new MemorySettings()
    const mounted = mount({}, settings)
    settings.write({ bindings: { 'new-window': 'CmdOrCtrl+Shift+N' } })
    // `validate` refuses the writes this plugin can see coming; a hand-edited
    // document reaches the watcher without passing it, and the seam's own
    // answer to that is "keep the last good value and warn".
    settings.publish({ bindings: { 'new-window': 'Ctrl+' } })
    expect(chordOf(mounted.shortcut()!.document(), 'new-window')).toBe('CmdOrCtrl+Shift+N')
    expect(mounted.warnings.length).toBeGreaterThan(0)
    mounted.unmount()
  })

  it('lets go of the settings scope on unmount', () => {
    const settings = new MemorySettings()
    const mounted = mount({}, settings)
    expect(settings.watcherCount()).toBe(1)
    mounted.unmount()
    // A menu this plugin no longer serves must not keep rebuilding itself.
    expect(settings.watcherCount()).toBe(0)
  })
})
