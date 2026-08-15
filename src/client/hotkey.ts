/**
 * The one key listener this package installs, and the rules that keep it from
 * becoming somebody else's bug.
 *
 * A global keydown handler in a shared page is a liability, so the discipline
 * is stated rather than assumed:
 *
 *   - **it consumes only chords the document bound.** Everything else is left
 *     untouched — no `preventDefault`, no `stopPropagation` — so an unbound key
 *     reaches the app exactly as it would if this plugin were not mounted;
 *   - **every bound chord carries a modifier.** Not by convention but by
 *     construction: `parseAccelerator` refuses a bare key, so there is no
 *     configuration that takes a letter away from a text field;
 *   - **it consumes nothing at all on the desktop.** There the native menu
 *     claimed these chords before the page existed, and a second listener would
 *     be a second handler racing for one keystroke;
 *   - **it reads its bindings through a thunk on every event**, not at install.
 *     The document can change under a live page — a plugin mounts, a config is
 *     edited — and a listener holding a stale copy is a key that stops working
 *     for no visible reason.
 *
 * Capture phase, so a chord is seen before an app-level handler can stop it
 * from propagating. That is what makes a binding hold inside surfaces that
 * manage their own keys.
 * @module @omdsh-plugins/omdsh-shortcuts/src/client/hotkey
 */

import type { Chord } from '../chord.ts'
import { keyFromCode, normalizeKey } from '../chord.ts'

/** One command and the chord that reaches it. */
export interface BoundChord {
  /** The item's id. */
  command: string
  /** The chord, parsed. */
  chord: Chord
}

/**
 * Whether a keydown is this chord.
 *
 * Every modifier is checked in both directions: a declared one must be held and
 * an undeclared one must not. That is what keeps ⌥⌘K from answering to a ⌘K
 * binding, generically, for whatever chord happens to be bound.
 * @param event - the keydown.
 * @param chord - the bound chord.
 * @returns true on an exact match.
 */
export function matchesChord(event: KeyboardEvent, chord: Chord): boolean {
  // AltGr reports as ctrl+alt on Windows and Linux, and every chord this
  // package binds for the page is `CmdOrCtrl+Alt+<key>` — so at the modifier
  // level a command is indistinguishable from a character the layout only
  // produces with AltGr. On a Polish layout AltGr+L is `ł` and AltGr+O is `ó`,
  // and neither is a request to open the side chat or add a workspace. The
  // browser is the one thing that can tell them apart, so ask it.
  //
  // Guarded on ctrl-without-meta, which is exactly the AltGr shape: macOS
  // sends the same chord as cmd+alt with `ctrlKey` false, and some engines set
  // AltGraph for a bare Option there.
  if (event.ctrlKey && !event.metaKey && event.getModifierState('AltGraph')) return false
  // Either reading identifies the key: what the keystroke PRODUCED, and what
  // was physically PRESSED. They agree on an unmodified US layout and diverge
  // exactly where a chord would otherwise go missing — `⌥B` produces `∫` on
  // macOS, and punctuation moves between layouts. See `keyFromCode`.
  if (normalizeKey(event.key) !== chord.key && keyFromCode(event.code) !== chord.key) return false
  if (event.altKey !== chord.alt) return false
  if (event.shiftKey !== chord.shift) return false
  if (chord.either) return event.metaKey !== event.ctrlKey
  return event.metaKey === chord.meta && event.ctrlKey === chord.ctrl
}

/**
 * The command one keydown means, if any.
 *
 * First match wins. The document forbids two items binding one chord in the
 * page, so there is at most one — the order exists to make the tie a decision
 * rather than an accident, not because ties are expected.
 * @param event - the keydown.
 * @param bindings - the chords currently bound.
 * @returns the command, or undefined when nothing is bound to this key.
 */
export function commandFor(event: KeyboardEvent, bindings: readonly BoundChord[]): string | undefined {
  for (const binding of bindings) {
    if (matchesChord(event, binding.chord)) return binding.command
  }
  return undefined
}

/**
 * Listen for the bound chords for as long as the returned disposer is unspent.
 * @param view - the window to listen on.
 * @param bindingsOf - the chords currently bound, read fresh on every event.
 * @param dispatch - runs the command a chord named.
 * @returns the removal.
 */
export function installHotkey(
  view: Window,
  bindingsOf: () => readonly BoundChord[],
  dispatch: (command: string) => void,
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    // A repeat is the same press still held down. Commands here open and toggle
    // things; running one sixty times a second is never what was meant.
    if (event.repeat) return
    const command = commandFor(event, bindingsOf())
    if (command === undefined) return
    event.preventDefault()
    event.stopPropagation()
    dispatch(command)
  }
  view.addEventListener('keydown', onKeyDown, true)
  return () => { view.removeEventListener('keydown', onKeyDown, true) }
}
