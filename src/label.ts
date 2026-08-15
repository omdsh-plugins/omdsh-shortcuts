/**
 * Spelling a chord for a reader, as opposed to for a parser.
 *
 * `CmdOrCtrl+Shift+E` is the wire spelling: unambiguous, platform-neutral, and
 * not what anybody's keyboard says. A tooltip that repeated it would be
 * teaching the configuration format rather than the key, so this module renders
 * the same chord the way the platform writes it — `⇧⌘E` on a Mac, `Ctrl+Shift+E`
 * everywhere else.
 *
 * Display only. Nothing parses this back, which is what lets it take liberties
 * a round-trippable form could not: Apple's modifier ORDER is fixed here
 * regardless of how the accelerator was typed, because `⌘⇧E` and `⇧⌘E` are the
 * same chord and only one of them is how the platform prints it.
 *
 * This lives in the package that owns chords rather than in each surface that
 * shows one, so every tooltip in the deployment spells a chord the same way.
 * The plugins that display one reach it through the service — see
 * `IShortcutClient.chordLabel` — rather than importing this module, because a
 * cross-plugin value import is a client-bundle purity error.
 * @module @omdsh-plugins/omdsh-shortcuts/label
 */

import { parseAccelerator } from './chord.ts'

/**
 * How a key prints, when its own name is not what a keyboard shows.
 *
 * `[mac, other]`. A key absent here prints upper-cased, which is right for
 * every letter, digit and punctuation mark.
 */
const KEY_LABELS: Readonly<Record<string, readonly [string, string]>> = {
  ' ': ['Space', 'Space'],
  enter: ['↩', 'Enter'],
  escape: ['⎋', 'Esc'],
  backspace: ['⌫', 'Backspace'],
  delete: ['⌦', 'Delete'],
  tab: ['⇥', 'Tab'],
  arrowup: ['↑', '↑'],
  arrowdown: ['↓', '↓'],
  arrowleft: ['←', '←'],
  arrowright: ['→', '→'],
}

/**
 * Whether this platform writes chords the Apple way.
 *
 * Read from the user agent rather than taken as configuration: it decides how a
 * key PRINTS, and the reader is looking at their own keyboard while they read
 * it. `userAgentData.platform` first because `navigator.platform` is deprecated
 * and, on some browsers, frozen at a legacy value.
 * @param nav - as much of `navigator` as the test reads.
 * @returns true on macOS and iPadOS.
 */
export function isMacPlatform(nav: {
  userAgent?: string
  platform?: string
  userAgentData?: { platform?: string }
}): boolean {
  const declared = nav.userAgentData?.platform ?? nav.platform ?? ''
  if (declared !== '') return /mac/i.test(declared)
  return /mac/i.test(nav.userAgent ?? '')
}

/**
 * Render an accelerator the way the platform writes it.
 * @param accelerator - Electron accelerator syntax.
 * @param mac - whether to use the Apple glyphs and their conventional order.
 * @returns the rendered chord, or undefined when the accelerator names none.
 */
export function formatAccelerator(accelerator: string, mac: boolean): string | undefined {
  const chord = parseAccelerator(accelerator)
  if (chord === undefined) return undefined

  const parts: string[] = []
  if (mac) {
    // Apple's order, whatever order the accelerator was typed in.
    if (chord.ctrl) parts.push('⌃')
    if (chord.alt) parts.push('⌥')
    if (chord.shift) parts.push('⇧')
    if (chord.meta || chord.either) parts.push('⌘')
  } else {
    // `CmdOrCtrl` prints as Ctrl here, because that is what it resolves to on
    // every platform that is not the one above.
    if (chord.ctrl || chord.either) parts.push('Ctrl')
    if (chord.meta) parts.push('Meta')
    if (chord.alt) parts.push('Alt')
    if (chord.shift) parts.push('Shift')
  }
  parts.push(KEY_LABELS[chord.key]?.[mac ? 0 : 1] ?? chord.key.toUpperCase())
  return parts.join(mac ? '' : '+')
}
