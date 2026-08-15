/**
 * What the browser half offers the rest of the UI.
 *
 * One service and four methods. It is deliberately not a keybinding framework:
 * a plugin does not get to say which chord it wants, only what it can do. The
 * chord comes from the document, which is configuration, and the split is the
 * whole point — a person who wants ⌘K to open the side chat edits one config
 * and does not go looking for which plugin hard-coded a key.
 *
 * That is also why {@link IShortcutClient.bindings} exists. A registration that
 * has no chord on this surface is a normal, correct state — the item may be
 * native-only, or the browser may keep that key for itself — and a plugin or a
 * settings panel that wants to TELL somebody so needs to be able to ask. A key
 * that does nothing and explains nothing is the failure mode this whole package
 * is arranged against.
 * @module @omdsh-plugins/omdsh-shortcuts/src/client/contract
 */

import type { ChordClaim, Surface } from '../chord.ts'

/** One command as it stands on this surface. */
export interface ShortcutBinding {
  /** The item's id, which is what a handler registers under. */
  command: string
  /** What the item reads as, for a surface that lists bindings. */
  label: string
  /** Who holds its chord here, and whether anyone can. */
  claim: ChordClaim
  /** Whether something in this page has registered to perform it. */
  handled: boolean
}

/**
 * The service this plugin publishes as `ctx.shortcut` in the browser.
 *
 * Its host namesake is a different face under the same name — deliberately, so
 * a command reads the same from either side — and the two never meet: cordis
 * resolves one service per name per process, and only one of them is ever
 * provided in a given one.
 */
export interface IShortcutClient {
  /**
   * Perform one `browser` command in this page.
   *
   * Registering does not claim a key. It says what this plugin can do; whether
   * a chord reaches it, and which, is the document's business. A command the
   * document never declares registers fine and simply never fires, which is the
   * right outcome for a plugin mounted against a config that does not mention
   * it.
   * @param command - the item's id.
   * @param handler - what the press runs.
   * @returns the deregistration.
   * @throws when something in this page already answers to this command.
   */
  register: (command: string, handler: () => void) => () => void
  /**
   * Press one command from here, as though its chord had been struck.
   *
   * The path a mouse takes: a menu entry or a button calls this instead of
   * reaching into whichever plugin owns the behaviour.
   * @param command - the item's id.
   * @returns whether anything performed it.
   */
  invoke: (command: string) => boolean
  /** Every command the current document declares, as it stands here. */
  bindings: () => ShortcutBinding[]
  /**
   * Watch for the document changing under a reader of {@link bindings}.
   *
   * A one-shot read is not enough for anything that DISPLAYS a chord. The
   * document arrives over a stream, so a plugin that reads at mount usually
   * reads before it lands; and a person rebinding a key in the settings panel
   * republishes it, live, with no reload. A tooltip that teaches the wrong key
   * is worse than one that teaches none, so the surfaces which name a chord —
   * `omdsh-sidechat`'s toggle is the shipped example — subscribe instead.
   *
   * The listener takes no argument on purpose: it is a "read again" signal, and
   * `bindings()` is already the read. Passing the document would give callers a
   * second shape to handle and a way to disagree with the service.
   * @param listener - called after each document revision.
   * @returns unsubscribe.
   */
  onBindings: (listener: () => void) => () => void
  /**
   * How one command's chord is spelled for a reader on this surface.
   *
   * The whole of what a tooltip needs, so no surface repeats the three steps
   * behind it: find the binding, decide whether this surface actually has one,
   * and render the accelerator the way the platform writes it (`⇧⌘E`, not
   * `CmdOrCtrl+Shift+E` — that is the wire spelling, and printing it would
   * teach the configuration format instead of the key).
   *
   * A `native` claim counts as much as a `page` one. On the desktop the menu
   * holds the chord and no listener here will ever fire, and the person still
   * presses the same keys — a tooltip going blank on the surface where the
   * chord is MOST reliable would be a falsehood by omission. `unreachable` and
   * `none` both answer undefined: one is a key a tab is never handed and the
   * other is no key at all, and neither is something to name.
   *
   * Pair it with {@link onBindings}. The document arrives over a stream, so the
   * first read is usually empty, and a rebinding in the settings panel
   * republishes with no reload.
   * @param command - the item's id.
   * @returns the chord as the platform writes it, or undefined when none
   * reaches this command here.
   */
  chordLabel: (command: string) => string | undefined
  /** Which surface this page decided it is on. */
  surface: () => Surface
}
