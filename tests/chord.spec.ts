/**
 * The rule the whole two-surface design rests on: a chord belongs to a
 * (command, surface) pair, not to a command.
 *
 * The cases that matter here are the asymmetric ones — a binding that is
 * perfectly good on one surface and impossible on the other — because those are
 * the ones a single accelerator field would silently get wrong.
 */

import { describe, expect, it } from 'vitest'
import { claimFor, isReservedByBrowser, parseAccelerator, webAcceleratorFor } from '../src/chord.ts'
import type { MenuItem } from '../src/contract.ts'

/**
 * One browser-performed item.
 * @param extra - the fields under test.
 * @returns the item.
 */
function browserItem(extra: Partial<MenuItem> = {}): MenuItem {
  return { id: 'ask', label: 'Ask', section: 'help', command: { kind: 'browser' }, ...extra }
}

describe('parseAccelerator', () => {
  it('reads the modifiers Electron spells, in any order', () => {
    expect(parseAccelerator('CmdOrCtrl+Shift+K')).toEqual({
      key: 'k', meta: false, ctrl: false, alt: false, shift: true, either: true,
    })
    expect(parseAccelerator('Shift+CmdOrCtrl+K')).toEqual(parseAccelerator('CmdOrCtrl+Shift+K'))
    expect(parseAccelerator('Option+Cmd+K')).toEqual({
      key: 'k', meta: true, ctrl: false, alt: true, shift: false, either: false,
    })
  })

  it('normalizes the key names that differ from KeyboardEvent.key', () => {
    expect(parseAccelerator('CmdOrCtrl+Return')?.key).toBe('enter')
    expect(parseAccelerator('CmdOrCtrl+Space')?.key).toBe(' ')
    expect(parseAccelerator('CmdOrCtrl+Plus')?.key).toBe('+')
  })

  it('refuses a bare key, which would take a letter from every text field', () => {
    expect(parseAccelerator('K')).toBeUndefined()
    expect(parseAccelerator('Shift+K')).toBeUndefined()
  })

  it('refuses what is not a chord at all', () => {
    expect(parseAccelerator('')).toBeUndefined()
    expect(parseAccelerator('CmdOrCtrl+')).toBeUndefined()
    expect(parseAccelerator('CmdOrCtrl+K+J')).toBeUndefined()
  })
})

describe('what a browser will not hand a page', () => {
  it.each(['CmdOrCtrl+N', 'CmdOrCtrl+T', 'CmdOrCtrl+W', 'CmdOrCtrl+Q', 'Cmd+W', 'Ctrl+T'])(
    'keeps %s for itself',
    (accelerator) => {
      const chord = parseAccelerator(accelerator)
      expect(chord).toBeDefined()
      expect(chord !== undefined && isReservedByBrowser(chord)).toBe(true)
    },
  )

  it('still keeps them when Shift is added, because those are taken too', () => {
    // ⇧⌘N opens a private window and ⇧⌘T reopens a closed tab; Shift is not an
    // escape hatch.
    const chord = parseAccelerator('CmdOrCtrl+Shift+T')
    expect(chord !== undefined && isReservedByBrowser(chord)).toBe(true)
  })

  it('lets Alt through, which genuinely does reach the page', () => {
    const chord = parseAccelerator('CmdOrCtrl+Alt+N')
    expect(chord !== undefined && isReservedByBrowser(chord)).toBe(false)
  })

  it('leaves an unmodified-primary chord on an ordinary letter alone', () => {
    const chord = parseAccelerator('CmdOrCtrl+K')
    expect(chord !== undefined && isReservedByBrowser(chord)).toBe(false)
  })
})

describe('which chord the page is asked for', () => {
  it('falls back to the native one, so the common case is stated once', () => {
    expect(webAcceleratorFor(browserItem({ accelerator: 'CmdOrCtrl+K' }))).toBe('CmdOrCtrl+K')
  })

  it('takes the override when the two surfaces cannot agree', () => {
    expect(webAcceleratorFor(browserItem({ accelerator: 'CmdOrCtrl+N', webAccelerator: 'CmdOrCtrl+Alt+N' })))
      .toBe('CmdOrCtrl+Alt+N')
  })

  it('takes null as "no key here", which is not the same as no opinion', () => {
    expect(webAcceleratorFor(browserItem({ accelerator: 'CmdOrCtrl+K', webAccelerator: null }))).toBeUndefined()
  })
})

describe('claimFor', () => {
  it('gives the desktop chord to the native menu, never to the page', () => {
    // The reason the in-page listener can be installed unconditionally: on the
    // desktop it is handed an empty table, because the menu got there first.
    const item = browserItem({ accelerator: 'CmdOrCtrl+K' })
    expect(claimFor(item, 'desktop')).toEqual({ holder: 'native', accelerator: 'CmdOrCtrl+K' })
    expect(claimFor(item, 'web')).toEqual({ holder: 'page', accelerator: 'CmdOrCtrl+K' })
  })

  it('calls a native-only chord unreachable on the web rather than binding it', () => {
    // The receipt. `new-window` is not misconfigured; it simply has no key in a
    // tab, and a settings surface should be able to say so.
    const item = browserItem({ accelerator: 'CmdOrCtrl+N' })
    expect(claimFor(item, 'desktop')).toEqual({ holder: 'native', accelerator: 'CmdOrCtrl+N' })
    expect(claimFor(item, 'web')).toEqual({ holder: 'unreachable', accelerator: 'CmdOrCtrl+N' })
  })

  it('binds nothing in a tab for a capability only Electron has', () => {
    const item: MenuItem = {
      id: 'new-window',
      label: 'New Window',
      section: 'file',
      command: { kind: 'shell', name: 'new-window' },
      accelerator: 'CmdOrCtrl+Alt+9',
    }
    // Reachable as a chord, and there is nothing behind it here.
    expect(claimFor(item, 'web')).toEqual({ holder: 'none' })
    expect(claimFor(item, 'desktop')).toEqual({ holder: 'native', accelerator: 'CmdOrCtrl+Alt+9' })
  })

  it('binds a runtime command in a tab, which is the web surface getting it for free', () => {
    const item: MenuItem = { id: 'say-hello', label: 'Hello', section: 'help', command: { kind: 'runtime' }, accelerator: 'CmdOrCtrl+Alt+H' }
    expect(claimFor(item, 'web')).toEqual({ holder: 'page', accelerator: 'CmdOrCtrl+Alt+H' })
  })

  it('holds nothing for an item that named no chord', () => {
    expect(claimFor(browserItem(), 'desktop')).toEqual({ holder: 'none' })
    expect(claimFor(browserItem(), 'web')).toEqual({ holder: 'none' })
  })
})
