/**
 * Shortcuts, browser half: the registry a UI plugin registers a command with,
 * the key listener that reaches those commands on the web, and the subscription
 * that reaches them on the desktop.
 *
 * ## The two surfaces, side by side
 *
 * ```
 *   web       ⌘K ─→ this page's listener ──────────────────→ handler
 *   desktop   ⌘K ─→ Electron menu ─→ runtime ─→ this page ──→ handler
 * ```
 *
 * Same command, same handler, same accelerator string in the same document. The
 * difference is who was allowed to hear the key, and that is not a preference:
 * a desktop chord is claimed natively before the page exists, and a tab can
 * only listen from inside the page, where the browser has already kept ⌘N, ⌘T,
 * ⌘W and ⌘Q for itself. So the document carries one binding and, where the two
 * genuinely cannot agree, a `webAccelerator` beside it — and this half resolves
 * which of them, if either, it is entitled to bind.
 *
 * Everything a plugin has to know is `ctx.shortcut.register('some-id', fn)`.
 * Which chord that is, whether it has one at all on this surface, and how a
 * press got here are all questions it never asks.
 *
 * ## Nothing is claimed on this plugin's own authority
 *
 * No slot, no locale namespace, no service beyond `ctx.shortcut`, and no key
 * that the document did not name. Unmounting removes the listener, the
 * subscription and the registry together, and the page goes back to hearing
 * every keystroke it heard before. That is the property that lets a keybinding
 * layer be a plugin at all: it has to be as removable as it was addable, or the
 * first bad binding is permanent.
 * @module @omdsh-plugins/omdsh-shortcuts/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { claimFor, parseAccelerator, type Surface } from '../chord.ts'
import { MENU_INVOKE_PATH, type MenuDocument, type MenuItem } from '../contract.ts'
import { formatAccelerator, isMacPlatform } from '../label.ts'
import { installBuiltins } from './builtins.ts'
import type { IShortcutClient, ShortcutBinding } from './contract.ts'
import { installFocusReports } from './focus.ts'
import { installHints } from './hints.ts'
import { installHotkey, type BoundChord } from './hotkey.ts'
import { installFreshSession } from './fresh-session.ts'
import { resolveServices } from './services.ts'
import { followBindings } from './stream.ts'
import { detectSurface } from './surface.ts'

export type { BoundChord } from './hotkey.ts'
export type { IShortcutClient, ShortcutBinding } from './contract.ts'
export { commandFor, matchesChord } from './hotkey.ts'
export { detectSurface } from './surface.ts'
export { followBindings, parseClientEvent, streamUrl } from './stream.ts'
export { installFocusReports } from './focus.ts'
export {
  installBuiltins, PLUGIN_HUB_TAB_ID, PLUGINS_SECTION_ID, PLUGINS_TAB_SLOT, SETTINGS_TRIGGER_SLOT,
} from './builtins.ts'
export { formatAccelerator, isMacPlatform } from '../label.ts'
export {
  augmentBubble, commandForControl, controlName, createHintBubble, harnessBubble, hintText,
  installHints, matchesAnchor, placeHintBubble,
  CHORD_ATTRIBUTE, CHORD_SEPARATOR, HARNESS_ANCHORS, HINT_ATTRIBUTE, HINT_DELAY, SIDEBAR_NS, WORKSPACE_NS,
  type HarnessLabel, type HintAnchor, type HintLookup, type HintsOptions,
} from './hints.ts'
export {
  installFreshSession, spendFreshSessionParam, wantsFreshSession, NEW_SESSION_PARAM,
  type HistoryView, type LocationView, type SessionsClear,
} from './fresh-session.ts'
export { resolveServices, settingsPageIndex, SESSION_MODES, labelIn, type CommandServices, type ILayout, type ILocale, type SessionModes, type SlotEntries } from './services.ts'
export {
  buttonAroundSlot, detailsCollapsed, searchToggle, settingsDialog, settingsPages, settingsTab, settingsTabs,
  sidebarCollapsed, waitFor,
} from './anchors.ts'
export { claimFor, isReservedByBrowser, keyFromCode, parseAccelerator, webAcceleratorFor, type Chord, type ChordClaim, type Surface } from '../chord.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The outward face only.
     *
     * The host half of this same package publishes a service under this name
     * too, with a different face, and does NOT augment `Context` — because a
     * package compiled outside the harness typechecks both halves as one
     * program, and two declarations of one key are resolved by whichever the
     * compiler happened to see first. The browser is where consumers write
     * `ctx.shortcut` and expect it to mean something, so the browser gets the
     * declaration.
     */
    shortcut: IShortcutClient
  }
}

/** Required services (cordis fiber inject): none. */
export const inject: string[] = []

/**
 * A name for this client, unique among the clients of one runtime.
 *
 * Not `crypto.randomUUID`, which is restricted to secure contexts: a `dsh web`
 * served to a LAN address over plain HTTP is not one, and reaching for it
 * unconditionally would throw during `apply` and take the plugin down in
 * exactly the deployment where the browser half is the whole story.
 *
 * This id is routing, not a secret. It travels between a page and the runtime
 * serving it, names nothing but a subscription, and buys nothing by being
 * unguessable.
 * @returns the id.
 */
export function clientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Post one small JSON body, without caring when or whether it lands.
 * @param path - the route.
 * @param body - the value to send.
 */
function post(path: string, body: unknown): void {
  void fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  // A press that could not be reported is a press that did not happen, and
  // there is nothing useful to do about it in a page. It must not become an
  // unhandled rejection.
  }).catch(() => {})
}

/**
 * Mount the registry, the listener, and the subscription that feeds them.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const surface: Surface = detectSurface(window)
  // Read once: the platform a page is rendered on does not change under it,
  // and this only decides how a chord PRINTS.
  const mac = isMacPlatform(window.navigator)
  const client = clientId()
  const handlers = new Map<string, () => void>()

  let items: readonly MenuItem[] = []
  let bound: readonly BoundChord[] = []
  // Until the first revision lands, the setting's own default: a page that is
  // still waiting for the document has no reason to have hints off.
  let hints = true
  const watchers = new Set<() => void>()
  const services = resolveServices(ctx)
  // Before anything else this page does: a New Window is already on the
  // last session if we wait for the list. `inject` is the late path for a
  // composition that has not provided `sessions` yet; it is not added to
  // this plugin's own `inject` list, because a page without a web app
  // must still mount the rest of the chords.
  installFreshSession({
    location,
    history,
    sessions: services.sessions,
    inject: (deps, callback) => { void ctx.inject(deps, () => { callback() }) },
  })

  /**
   * Recompute what this page binds.
   *
   * Only claims this surface actually holds become listeners. On the desktop
   * that is none of them — `claimFor` answers `native` there, because the menu
   * took the chord first — which is why the listener below can be installed
   * unconditionally: the emptiness is enforced in one place rather than by a
   * branch here that could disagree with it.
   */
  const rebind = (): void => {
    const next: BoundChord[] = []
    for (const item of items) {
      const claim = claimFor(item, surface)
      if (claim.holder !== 'page') continue
      const chord = parseAccelerator(claim.accelerator)
      // `claimFor` only answers `page` for an accelerator that parses; the
      // check is the compiler's, not a case that occurs.
      if (chord !== undefined) next.push({ command: item.id, chord })
    }
    bound = next
  }

  /**
   * Run one command by whatever path it needs from here.
   * @param command - the item's id.
   * @returns whether anything performed it.
   */
  const dispatch = (command: string): boolean => {
    const item = items.find(candidate => candidate.id === command)
    if (item === undefined) return false
    if (item.command.kind === 'shell') return false
    if (item.command.kind === 'runtime') {
      // A `runtime` command bound in a tab: the page heard the key and the
      // process that performs it is one POST away. This is the web surface
      // getting for free what the desktop needed a whole menu for.
      post(MENU_INVOKE_PATH, { id: command })
      return true
    }
    const handler = handlers.get(command)
    if (handler === undefined) {
      // The document declares it and nothing in this page answers to it. Almost
      // always a plugin that is configured but not mounted, and silence would
      // make that look like a broken key.
      console.warn(`omdsh-shortcuts: ${command} is bound but nothing in this page registered to perform it`)
      return false
    }
    handler()
    return true
  }

  const service: IShortcutClient = {
    register: (command, handler) => {
      if (handlers.has(command)) {
        throw new Error(`omdsh-shortcuts: ${command} already has a handler in this page; one command answers to one handler.`)
      }
      handlers.set(command, handler)
      return () => { handlers.delete(command) }
    },
    invoke: dispatch,
    bindings: (): ShortcutBinding[] => items.map(item => ({
      command: item.id,
      label: item.label,
      claim: claimFor(item, surface),
      handled: handlers.has(item.id),
    })),
    onBindings: (listener) => {
      watchers.add(listener)
      return () => { watchers.delete(listener) }
    },
    chordLabel: (command) => {
      const item = items.find(candidate => candidate.id === command)
      if (item === undefined) return undefined
      const claim = claimFor(item, surface)
      if (claim.holder !== 'native' && claim.holder !== 'page') return undefined
      return formatAccelerator(claim.accelerator, mac)
    },
    surface: () => surface,
  }

  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('shortcut', service)
    // provide()'s disposer settles asynchronously; teardown is synchronous
    // fire-and-forget.
    return () => { void disposeService() }
  }, 'omdsh-shortcuts: client service')

  ctx.effect(() => followBindings(url => new EventSource(url), client, {
    onBindings: (document: MenuDocument, teachChords: boolean) => {
      items = document.items
      hints = teachChords
      rebind()
      // After the rebind, so a watcher reading `bindings()` from inside the
      // notification sees the state this revision produced rather than the
      // previous one. A watcher that throws is its own problem and must not
      // stop the rest from hearing about the revision.
      for (const watcher of watchers) {
        try {
          watcher()
        } catch (error) {
          console.warn('omdsh-shortcuts: a bindings watcher threw', error)
        }
      }
    },
    // Only the desktop produces these: on the web the listener below heard the
    // key itself and never asked anybody.
    onInvoke: (command) => { dispatch(command) },
  }), 'omdsh-shortcuts: bindings subscription')

  ctx.effect(() => installFocusReports({
    addEventListener: (type, listener) => { window.addEventListener(type, listener) },
    removeEventListener: (type, listener) => { window.removeEventListener(type, listener) },
    hasFocus: () => document.hasFocus(),
  }, client, post), 'omdsh-shortcuts: focus reports')

  ctx.effect(() => installHotkey(window, () => bound, (command) => { dispatch(command) }), 'omdsh-shortcuts: bound chords')

  // The commands with no other owner. Registered through the same `register`
  // any other plugin uses — no privileged path — and an id that turns out to
  // have an owner is left to it rather than fought over. `panel.files`,
  // `panel.terminal` and `sidechat.open` are not here at all: those behaviours
  // belong to plugins that can register for themselves, and do.
  ctx.effect(() => installBuiltins(
    service.register,
    services,
    (message) => { console.warn(`omdsh-shortcuts: ${message}`) },
  ), 'omdsh-shortcuts: built-in commands')

  // The other half of a keybinding layer: a chord nobody can find is a chord
  // nobody presses. The plugins' own buttons teach theirs from the inside; this
  // reaches the harness's, which have no way to ask.
  ctx.effect(() => installHints(window, {
    chordLabel: command => service.chordLabel(command),
    items: () => items,
    services,
    root: document,
    enabled: () => hints,
  }), 'omdsh-shortcuts: chord hints')
}
