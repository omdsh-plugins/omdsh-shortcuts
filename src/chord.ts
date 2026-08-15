/**
 * Accelerators as values, and the question every binding has to answer: on this
 * surface, who is actually holding this chord?
 *
 * The string vocabulary is **Electron's accelerator syntax** throughout, for
 * the whole document, on both surfaces. It is what a native menu item is
 * spelled in, so a chord can move between the menu bar and an in-page listener
 * without a translation layer, and it is what `omdsh-sidechat`'s
 * `setSummonChord` already reads — meaning a binding written here can be handed
 * to a plugin that never heard of this package.
 *
 * What this module adds on top of the spelling is the part a single accelerator
 * string cannot express: **a chord is not a property of a command, it is a
 * relationship between a command and a surface.** `CmdOrCtrl+N` is a fine
 * native binding and a chord a browser tab is never offered. Pretending
 * otherwise is how a person ends up with a key in a settings dialog that does
 * nothing and says nothing about why, which is the outcome this module exists
 * to make impossible.
 * @module @omdsh-plugins/omdsh-shortcuts/chord
 */

import type { MenuItem } from './contract.ts'

/**
 * Where a binding is being asked about.
 *
 * Not a build target and not a platform — the same runtime serves both at once
 * the moment somebody uses `open-in-browser`. It is a property of one client.
 */
export type Surface =
  /** An Electron window, with a native menu bar in front of it. */
  | 'desktop'
  /** A browser tab, where the page is the only thing that can hear a key. */
  | 'web'

/** A parsed accelerator. */
export interface Chord {
  /** The non-modifier key, normalized to `KeyboardEvent.key` in lower case. */
  key: string
  /** Requires Command / Super / Meta. */
  meta: boolean
  /** Requires Control. */
  ctrl: boolean
  /** Requires Alt / Option. */
  alt: boolean
  /** Requires Shift. */
  shift: boolean
  /**
   * Spelled `CmdOrCtrl`: satisfied by EXACTLY ONE of Command and Control.
   * Both held at once is a chord this parser does not understand, and a
   * modifier it does not understand is not its event.
   */
  either: boolean
}

/**
 * Electron key names that differ from `KeyboardEvent.key`.
 *
 * `Plus` is in here because `+` is the separator and cannot be written
 * literally — the same reason Electron spells it out.
 */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  space: ' ',
  return: 'enter',
  esc: 'escape',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
}

/**
 * Normalize a key name for comparison.
 * @param key - an Electron key name or a `KeyboardEvent.key`.
 * @returns the comparable form.
 */
export function normalizeKey(key: string): string {
  const lower = key.toLowerCase()
  return KEY_ALIASES[lower] ?? lower
}

/**
 * `KeyboardEvent.code` values that are not derivable by pattern.
 *
 * The `Key*` and `Digit*` families are, and are handled below; these are the
 * punctuation and named keys whose code name and Electron spelling differ.
 */
const CODE_NAMES: Readonly<Record<string, string>> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: '\'',
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Space: ' ',
  Enter: 'enter',
  Escape: 'escape',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
}

/**
 * The key a PHYSICAL key press names, independent of layout and modifiers.
 *
 * `KeyboardEvent.key` is what the keystroke produced, which is not always what
 * was pressed. Two cases matter here and both are ordinary:
 *
 * - **macOS composes with Option.** `⌥B` reports `key: '∫'`, not `'b'`. Whether
 *   the composition still applies with Command also held depends on the
 *   browser's reading of `charactersIgnoringModifiers`, and this package binds a
 *   whole tier of `CmdOrCtrl+Alt+…` chords on the web surface — so "it probably
 *   reports the letter" is not a foundation to put them on.
 * - **Layouts move punctuation.** `,` is a shifted key on AZERTY and `;` is
 *   elsewhere entirely on QWERTZ, so a chord spelled for one layout stops
 *   existing on another even though the physical key is right there.
 *
 * `code` answers what was pressed, which is what an accelerator means: Electron
 * resolves `CmdOrCtrl+,` against the physical key too. Reading BOTH — see
 * {@link matchesChord} — keeps every case `key` already got right and adds the
 * ones it cannot.
 * @param code - `KeyboardEvent.code`.
 * @returns the comparable form, or undefined for a code with no chord spelling.
 */
export function keyFromCode(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code.toLowerCase()
  // Numpad digits type the same characters and are as good a way to press one.
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6)
  return CODE_NAMES[code]
}

/**
 * Parse an accelerator into a chord.
 *
 * Returns undefined rather than throwing: the callers differ on how loud a bad
 * accelerator should be. A malformed `webAccelerator` is a document fault this
 * plugin refuses to publish, while a native `accelerator` this parser does not
 * understand is merely a chord the page will not bind — Electron reads more
 * spellings than a browser can act on, and being stricter than Electron about
 * the shell's own menu is not this parser's business.
 * @param accelerator - Electron accelerator syntax, e.g. `CmdOrCtrl+Shift+L`.
 * @returns the chord, or undefined when the string names none.
 */
export function parseAccelerator(accelerator: string): Chord | undefined {
  const tokens = accelerator.split('+').map(token => token.trim()).filter(token => token !== '')
  if (tokens.length === 0) return undefined

  const chord: Chord = { key: '', meta: false, ctrl: false, alt: false, shift: false, either: false }
  let key: string | undefined
  for (const token of tokens) {
    switch (token.toLowerCase()) {
      case 'command': case 'cmd': case 'super': case 'meta': chord.meta = true; break
      case 'control': case 'ctrl': chord.ctrl = true; break
      case 'commandorcontrol': case 'cmdorctrl': chord.either = true; break
      case 'alt': case 'option': chord.alt = true; break
      case 'shift': chord.shift = true; break
      default:
        // Two non-modifier tokens is not a chord anyone meant to write.
        if (key !== undefined) return undefined
        key = normalizeKey(token)
    }
  }
  if (key === undefined || key === '') return undefined
  // A bare key with no modifier would take a letter away from every text
  // surface that does not opt out. Nothing here binds those.
  if (!chord.meta && !chord.ctrl && !chord.either && !chord.alt) return undefined
  return { ...chord, key }
}

/**
 * Keys a browser keeps for itself when the primary modifier is held.
 *
 * New window, new tab, close tab, quit. The page is not asked about these and
 * cannot decline them: they are handled above the document, so no listener
 * fires and `preventDefault` has nothing to prevent.
 *
 * Deliberately short. A chord that is NOT on this list is not thereby promised
 * to work — ⌘M and ⌘H are the platform's on macOS and free on Windows, and half
 * the function keys belong to whatever the user configured. The list holds only
 * what is unavailable on every platform a tab might run on, because its job is
 * to reject bindings that are certainly broken, not to guess at the rest. A
 * false rejection costs somebody a working key; a missing entry costs nothing
 * that was not already the state of the world.
 */
export const BROWSER_RESERVED_KEYS: readonly string[] = ['n', 't', 'w', 'q']

/**
 * Whether a browser tab will never be handed this chord.
 *
 * Shift does not rescue any of them — ⇧⌘N opens a private window, ⇧⌘T reopens a
 * closed tab, ⇧⌘W closes the window, ⇧⌘Q logs out — so it is not consulted.
 * Alt does: ⌥⌘N belongs to nobody and reaches the page.
 * @param chord - the parsed chord.
 * @returns true when no in-page listener can hear it.
 */
export function isReservedByBrowser(chord: Chord): boolean {
  if (chord.alt) return false
  if (!chord.meta && !chord.ctrl && !chord.either) return false
  return BROWSER_RESERVED_KEYS.includes(chord.key)
}

/** Who holds the chord that reaches one item on one surface. */
export type ChordClaim =
  /** The native menu claimed it, before the page existed. */
  | { holder: 'native'; accelerator: string }
  /** The in-page listener binds it. */
  | { holder: 'page'; accelerator: string }
  /** Nothing does: the item names no chord for this surface, or has no way to act here. */
  | { holder: 'none' }
  /**
   * A chord was named and this surface cannot be given it.
   *
   * The receipt that keeps a binding from failing silently. It is not always a
   * fault — `new-window` holding `CmdOrCtrl+N` natively and nothing on the web
   * is exactly right — but it is always worth being able to say out loud, so a
   * settings surface can render "native only" where it would otherwise render
   * a key that does nothing.
   */
  | { holder: 'unreachable'; accelerator: string }

/**
 * The chord a browser tab is asked to bind for one item, before asking whether
 * it can.
 *
 * Absent `webAccelerator` means "the same one", because most chords work on
 * both surfaces and stating that twice would be a second place to forget.
 * @param item - the item.
 * @returns the accelerator, or undefined when the web surface binds nothing.
 */
export function webAcceleratorFor(item: MenuItem): string | undefined {
  if (item.webAccelerator === null) return undefined
  return item.webAccelerator ?? item.accelerator
}

/**
 * Resolve who holds one item's chord on one surface.
 * @param item - the item.
 * @param surface - the surface asking.
 * @returns the claim (see {@link ChordClaim}).
 */
export function claimFor(item: MenuItem, surface: Surface): ChordClaim {
  if (surface === 'desktop') {
    // Every kind is actionable here: the shell performs its own, and the other
    // two travel from the menu press to whoever registered for them.
    return item.accelerator === undefined ? { holder: 'none' } : { holder: 'native', accelerator: item.accelerator }
  }
  // A `shell` command is an Electron capability. In a tab there is no Electron,
  // so there is nothing for a chord to reach and binding one would be a key
  // that swallows itself.
  if (item.command.kind === 'shell') return { holder: 'none' }
  const accelerator = webAcceleratorFor(item)
  if (accelerator === undefined) return { holder: 'none' }
  const chord = parseAccelerator(accelerator)
  if (chord === undefined || isReservedByBrowser(chord)) return { holder: 'unreachable', accelerator }
  return { holder: 'page', accelerator }
}
