// @vitest-environment jsdom
/**
 * A global key listener is the most likely thing in this package to become
 * somebody else's bug. These are the rules that keep it from being one, and the
 * negative cases matter more than the positive one: what it does NOT consume is
 * the property that lets a keybinding layer be something you can add to a page
 * you did not write.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAccelerator } from '../src/chord.ts'
import { commandFor, installHotkey, matchesChord, type BoundChord } from '../src/client/hotkey.ts'
import { formatAccelerator, isMacPlatform } from '../src/label.ts'

/**
 * One binding, from the accelerator a document would carry.
 * @param command - the command id.
 * @param accelerator - Electron accelerator syntax.
 * @returns the binding.
 */
function bind(command: string, accelerator: string): BoundChord {
  const chord = parseAccelerator(accelerator)
  if (chord === undefined) throw new Error(`${accelerator} does not parse`)
  return { command, chord }
}

/**
 * A keydown as the browser would deliver it.
 * @param from - the element it starts at.
 * @param key - `KeyboardEvent.key`.
 * @param modifiers - the modifier state.
 * @returns the dispatched event.
 */
function press(from: Element, key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  from.dispatchEvent(event)
  return event
}

let dispose: () => void = () => {}
let dispatch: (command: string) => void
let bindings: BoundChord[]

beforeEach(() => {
  document.body.innerHTML = '<button id="target">x</button>'
  bindings = [bind('ask', 'CmdOrCtrl+K')]
  dispatch = vi.fn()
  dispose = installHotkey(window, () => bindings, dispatch)
})

afterEach(() => { dispose() })

describe('the physical key, when the produced one is not the pressed one', () => {
  /**
   * A keydown whose `key` and `code` disagree, which is the ordinary case the
   * moment a modifier composes or a layout moves a character.
   * @param key - what the keystroke produced.
   * @param code - what was physically pressed.
   * @param modifiers - the modifier state.
   * @returns the event.
   */
  const composed = (key: string, code: string, modifiers: Partial<KeyboardEventInit>): KeyboardEvent =>
    new KeyboardEvent('keydown', { key, code, ...modifiers })

  it('matches an Alt chord macOS composed into another character', () => {
    // ⌥B on macOS produces `∫`. Every web-surface chord this package ships is
    // `CmdOrCtrl+Alt+…`, so reading `key` alone would put a whole tier of
    // bindings on whether the browser happens to strip the composition.
    const chord = bind('toggle', 'CmdOrCtrl+Alt+B').chord
    expect(matchesChord(composed('∫', 'KeyB', { metaKey: true, altKey: true }), chord)).toBe(true)
  })

  it('matches a digit and a punctuation chord the same way', () => {
    expect(matchesChord(
      composed('¡', 'Digit1', { metaKey: true, altKey: true }),
      bind('chat', 'CmdOrCtrl+Alt+1').chord,
    )).toBe(true)
    expect(matchesChord(
      composed('≤', 'Comma', { metaKey: true, altKey: true }),
      bind('settings', 'CmdOrCtrl+Alt+,').chord,
    )).toBe(true)
    expect(matchesChord(
      composed('`', 'Backquote', { ctrlKey: true }),
      bind('terminal', 'Ctrl+`').chord,
    )).toBe(true)
  })

  it('still requires the modifiers to agree exactly', () => {
    // The physical key being right is not a licence to relax anything else:
    // ⌥⌘B must not answer a ⌘B binding just because the code matches.
    const chord = bind('toggle', 'CmdOrCtrl+B').chord
    expect(matchesChord(composed('∫', 'KeyB', { metaKey: true, altKey: true }), chord)).toBe(false)
  })

  it('leaves a code it has no chord spelling for alone', () => {
    const chord = bind('toggle', 'CmdOrCtrl+Alt+B').chord
    expect(matchesChord(composed('∫', 'Lang1', { metaKey: true, altKey: true }), chord)).toBe(false)
  })

  it('reads a plain event exactly as it did before, from `key`', () => {
    // The fallback ADDS a reading; it must not change the one that already
    // worked, including for events carrying no `code` at all.
    const chord = bind('ask', 'CmdOrCtrl+K').chord
    expect(matchesChord(new KeyboardEvent('keydown', { key: 'k', metaKey: true }), chord)).toBe(true)
  })
})

describe('matchesChord', () => {
  it('requires every declared modifier and refuses every undeclared one', () => {
    const chord = bind('ask', 'CmdOrCtrl+K').chord
    expect(matchesChord(new KeyboardEvent('keydown', { key: 'k', metaKey: true }), chord)).toBe(true)
    expect(matchesChord(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }), chord)).toBe(true)
    // ⌥⌘K is not a ⌘K binding's event, and neither is ⌘⇧K.
    expect(matchesChord(new KeyboardEvent('keydown', { key: 'k', metaKey: true, altKey: true }), chord)).toBe(false)
    expect(matchesChord(new KeyboardEvent('keydown', { key: 'k', metaKey: true, shiftKey: true }), chord)).toBe(false)
  })

  it('reads CmdOrCtrl as exactly one of the two, never both', () => {
    const chord = bind('ask', 'CmdOrCtrl+K').chord
    expect(matchesChord(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true }), chord)).toBe(false)
    expect(matchesChord(new KeyboardEvent('keydown', { key: 'k' }), chord)).toBe(false)
  })
})

describe('commandFor', () => {
  it('names the command a keydown means, and nothing when none is bound', () => {
    const table = [bind('ask', 'CmdOrCtrl+K'), bind('other', 'CmdOrCtrl+Alt+J')]
    expect(commandFor(new KeyboardEvent('keydown', { key: 'j', metaKey: true, altKey: true }), table)).toBe('other')
    expect(commandFor(new KeyboardEvent('keydown', { key: 'p', metaKey: true }), table)).toBeUndefined()
  })
})

describe('the installed listener', () => {
  it('runs the command and takes the key', () => {
    const target = document.getElementById('target')
    if (target === null) throw new Error('the fixture is missing')
    const event = press(target, 'k', { metaKey: true })
    expect(dispatch).toHaveBeenCalledWith('ask')
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves an unbound key completely alone', () => {
    // The property that makes this safe to add to a page somebody else wrote:
    // no preventDefault, no dispatch, nothing.
    const target = document.getElementById('target')
    if (target === null) throw new Error('the fixture is missing')
    const event = press(target, 'p', { metaKey: true })
    expect(dispatch).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('binds nothing at all while the table is empty, which is the desktop case', () => {
    bindings = []
    const target = document.getElementById('target')
    if (target === null) throw new Error('the fixture is missing')
    const event = press(target, 'k', { metaKey: true })
    expect(dispatch).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores a held key repeating', () => {
    const target = document.getElementById('target')
    if (target === null) throw new Error('the fixture is missing')
    press(target, 'k', { metaKey: true, repeat: true })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('hears the chord before a handler that stops propagation', () => {
    // Capture phase. Without it a binding would work everywhere except the
    // surfaces most likely to manage their own keys.
    const target = document.getElementById('target')
    if (target === null) throw new Error('the fixture is missing')
    target.addEventListener('keydown', event => { event.stopPropagation() })
    press(target, 'k', { metaKey: true })
    expect(dispatch).toHaveBeenCalledWith('ask')
  })

  it('follows a rebinding without being reinstalled', () => {
    // The document changes under a live page — a plugin mounts, a config is
    // edited — and a listener holding a copy from install time is a key that
    // stops working for no visible reason.
    const target = document.getElementById('target')
    if (target === null) throw new Error('the fixture is missing')
    bindings = [bind('ask', 'CmdOrCtrl+Alt+J')]
    press(target, 'k', { metaKey: true })
    expect(dispatch).not.toHaveBeenCalled()
    press(target, 'j', { metaKey: true, altKey: true })
    expect(dispatch).toHaveBeenCalledWith('ask')
  })

  it('gives the key back when it is disposed', () => {
    dispose()
    const target = document.getElementById('target')
    if (target === null) throw new Error('the fixture is missing')
    const event = press(target, 'k', { metaKey: true })
    expect(dispatch).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('spelling a chord for a reader', () => {
  it('writes the Apple glyphs in Apple order, whatever order was typed', () => {
    // ⌘⇧E and ⇧⌘E are the same chord; only one of them is how macOS prints it.
    expect(formatAccelerator('CmdOrCtrl+Shift+E', true)).toBe('⇧⌘E')
    expect(formatAccelerator('Shift+CmdOrCtrl+E', true)).toBe('⇧⌘E')
    expect(formatAccelerator('CmdOrCtrl+Alt+1', true)).toBe('⌥⌘1')
    expect(formatAccelerator('Ctrl+`', true)).toBe('⌃`')
  })

  it('spells CmdOrCtrl as Ctrl off the Mac, because that is what it resolves to', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+E', false)).toBe('Ctrl+Shift+E')
    expect(formatAccelerator('CmdOrCtrl+Alt+1', false)).toBe('Ctrl+Alt+1')
  })

  it('names a key whose own name is not what a keyboard shows', () => {
    expect(formatAccelerator('CmdOrCtrl+Return', true)).toBe('⌘↩')
    expect(formatAccelerator('CmdOrCtrl+Return', false)).toBe('Ctrl+Enter')
  })

  it('answers undefined for a string that names no chord', () => {
    // The same refusal `parseAccelerator` makes, so a tooltip cannot print a
    // chord the listener would never match.
    expect(formatAccelerator('Ctrl+', true)).toBeUndefined()
    expect(formatAccelerator('Shift+L', true)).toBeUndefined()
  })
})

describe('which platform spells it', () => {
  it('reads the modern hint before the deprecated one', () => {
    expect(isMacPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe(true)
  })

  it('falls back to navigator.platform, then to the user agent', () => {
    expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true)
    expect(isMacPlatform({ platform: 'Win32' })).toBe(false)
    expect(isMacPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe(true)
    expect(isMacPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe(false)
  })
})
