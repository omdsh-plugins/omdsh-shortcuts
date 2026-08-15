/**
 * The menu this plugin contributes, and the chord each item answers to.
 *
 * The tiers are what keep the map memorable and collision-free: the bare
 * modifier is the standard window operations, `Shift` reaches a shell surface
 * or destination, and `Alt` reaches the runtime process — the tier Electron
 * itself puts the developer tools on. Printable characters are left alone,
 * because the harness UI inside the window owns every key the menu does not.
 * @module @omdsh-plugins/omdsh-shortcuts/menu
 */

import { claimFor, isReservedByBrowser, parseAccelerator } from './chord.ts'
import { MENU_CONTRACT_VERSION, type MenuDocument, type MenuItem } from './contract.ts'

/**
 * The chord each contributed item answers to.
 *
 * `CmdOrCtrl` is Command on macOS and Control elsewhere, so one entry states
 * both platforms.
 */
export const SHELL_ACCELERATORS = {
  /** Open one more window on the running runtime, showing a session of its own. */
  newWindow: 'CmdOrCtrl+N',
  /** Stop and start the runtime process — one step past the `forceReload` role. */
  restartRuntime: 'CmdOrCtrl+Alt+R',
  /** Turn idle memory release on or off. */
  idleSuspend: 'CmdOrCtrl+Alt+M',
  /** Open the running UI in the user's browser. */
  openInBrowser: 'CmdOrCtrl+Shift+O',
  /** Reveal the runtime log file. */
  openLog: 'CmdOrCtrl+Shift+L',
} as const

/**
 * The chords the UI commands answer to on a desktop window.
 *
 * These read like an editor's rather than like the shell tier above, because
 * that is what they are: the shell tier deliberately avoids printable
 * characters so the UI inside the window can have them, and this is the UI
 * inside the window spending them. Nothing here reaches Electron — every one
 * is a `browser` command performed in the page.
 */
export const UI_ACCELERATORS = {
  /** Start a conversation, in whatever posture the column is holding. */
  newSession: 'CmdOrCtrl+K',
  /** Put the caret in the sidebar's session search. */
  search: 'CmdOrCtrl+Shift+F',
  /** Fold the navigation column to its rail, or unfold it. */
  toggleSidebar: 'CmdOrCtrl+Shift+B',
  /** Show or hide the file tree beside the conversation. */
  filePanel: 'CmdOrCtrl+Shift+E',
  /** Show or hide the terminal under the conversation. */
  terminal: 'Ctrl+`',
  /** Open the settings dialog. */
  settings: 'CmdOrCtrl+,',
  /** Open the settings dialog on its Plugins page. */
  settingsPlugins: 'CmdOrCtrl+Shift+P',
  /** Register a directory as a workspace. */
  addWorkspace: 'CmdOrCtrl+O',
  /** Enter Chat mode. */
  modeChat: 'CmdOrCtrl+1',
  /** Enter Work mode. */
  modeWork: 'CmdOrCtrl+2',
  /** Enter Code mode. */
  modeCode: 'CmdOrCtrl+3',
  /** Show or hide the tool-details column. */
  toggleDetails: 'CmdOrCtrl+Shift+D',
  /** Fork the current conversation at its last completed turn. */
  forkSession: 'CmdOrCtrl+Shift+K',
  /** Archive the current conversation. */
  archiveSession: 'CmdOrCtrl+Shift+W',
  /** Summon the side chat. */
  sideChat: 'CmdOrCtrl+L',
} as const

/**
 * The chord a browser tab binds instead, for the items whose native chord a
 * browser keeps for itself.
 *
 * The rule is one substitution, applied consistently: **swap `Shift` (or
 * nothing) for `Alt`**. `Alt` is the tier no mainstream browser spends on
 * window chrome, and {@link isReservedByBrowser} agrees — holding it takes a
 * chord out of the reserved set entirely — so one modifier answers the whole
 * class of collisions without a table of per-browser exceptions.
 *
 * Only the genuinely-claimed ones are listed. `CmdOrCtrl+Shift+F`, `Shift+E`,
 * `Ctrl+\`` and `Shift+K` reach a page in Chrome, Safari and Firefox alike, so
 * restating them here would be a second key to remember for no gain. The one
 * item with no web chord at all is `session.archive`: every `⌘W` spelling
 * belongs to the browser, `Alt` included in Safari, so it is honestly
 * native-only rather than dishonestly bound.
 */
export const WEB_ACCELERATORS = {
  toggleSidebar: 'CmdOrCtrl+Alt+B',
  settings: 'CmdOrCtrl+Alt+,',
  settingsPlugins: 'CmdOrCtrl+Alt+P',
  addWorkspace: 'CmdOrCtrl+Alt+O',
  modeChat: 'CmdOrCtrl+Alt+1',
  modeWork: 'CmdOrCtrl+Alt+2',
  modeCode: 'CmdOrCtrl+Alt+3',
  toggleDetails: 'CmdOrCtrl+Alt+D',
  sideChat: 'CmdOrCtrl+Alt+L',
} as const

/**
 * The ids of the UI commands this package ships defaults for.
 *
 * Named here because three different audiences write them down and they must
 * agree: this file declares them, the browser half registers handlers under
 * them, and a plugin owning one of the behaviours (`omdsh-sidepanel`'s panels,
 * `omdsh-sidechat`'s summon) registers its own handler by the same string. That
 * third audience copies the literal rather than importing this constant, on
 * purpose — a cross-plugin value import is a client-bundle purity error, and an
 * id is a wire name, not a shared symbol.
 */
export const UI_COMMANDS = {
  newSession: 'session.new',
  search: 'session.search',
  forkSession: 'session.fork',
  archiveSession: 'session.archive',
  addWorkspace: 'workspace.add',
  toggleSidebar: 'sidebar.toggle',
  toggleDetails: 'details.toggle',
  filePanel: 'panel.files',
  terminal: 'panel.terminal',
  settings: 'settings.open',
  settingsPlugins: 'settings.plugins',
  modeChat: 'mode.chat',
  modeWork: 'mode.work',
  modeCode: 'mode.code',
  sideChat: 'sidechat.open',
} as const

/** The items this plugin contributes when its config names no others. */
export const DEFAULT_ITEMS: readonly MenuItem[] = [
  {
    id: 'new-window',
    label: 'New Window',
    section: 'file',
    command: { kind: 'shell', name: 'new-window' },
    accelerator: SHELL_ACCELERATORS.newWindow,
  },
  {
    id: 'restart-runtime',
    label: 'Restart Harness Runtime',
    section: 'view',
    command: { kind: 'shell', name: 'restart-runtime' },
    accelerator: SHELL_ACCELERATORS.restartRuntime,
  },
  {
    id: 'open-in-browser',
    label: 'Open in Browser',
    section: 'view',
    command: { kind: 'shell', name: 'open-in-browser' },
    accelerator: SHELL_ACCELERATORS.openInBrowser,
  },
  {
    id: 'reveal-log',
    label: 'Reveal Runtime Log',
    section: 'view',
    command: { kind: 'shell', name: 'reveal-log' },
    accelerator: SHELL_ACCELERATORS.openLog,
  },
  {
    id: 'idle-suspend',
    label: 'Release Memory When Idle',
    section: 'app',
    command: { kind: 'shell', name: 'toggle-idle-suspend' },
    accelerator: SHELL_ACCELERATORS.idleSuspend,
    checkbox: true,
  },
  {
    id: UI_COMMANDS.newSession,
    label: 'New Session',
    section: 'file',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.newSession,
  },
  {
    id: UI_COMMANDS.forkSession,
    label: 'Fork Session',
    section: 'file',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.forkSession,
  },
  {
    id: UI_COMMANDS.archiveSession,
    label: 'Archive Session',
    section: 'file',
    command: { kind: 'browser' },
    // No `webAccelerator`: every ⌘W spelling belongs to the browser, so a tab
    // reports this one `unreachable` rather than binding a key that a person
    // would find had closed their window instead.
    accelerator: UI_ACCELERATORS.archiveSession,
  },
  {
    id: UI_COMMANDS.addWorkspace,
    label: 'Add Workspace',
    section: 'file',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.addWorkspace,
    webAccelerator: WEB_ACCELERATORS.addWorkspace,
  },
  {
    id: UI_COMMANDS.search,
    label: 'Search Sessions',
    section: 'view',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.search,
  },
  {
    id: UI_COMMANDS.toggleSidebar,
    label: 'Toggle Sidebar',
    section: 'view',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.toggleSidebar,
    webAccelerator: WEB_ACCELERATORS.toggleSidebar,
  },
  {
    id: UI_COMMANDS.filePanel,
    label: 'Toggle File Panel',
    section: 'view',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.filePanel,
  },
  {
    id: UI_COMMANDS.terminal,
    label: 'Toggle Terminal',
    section: 'view',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.terminal,
  },
  {
    id: UI_COMMANDS.toggleDetails,
    label: 'Toggle Details Panel',
    section: 'view',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.toggleDetails,
    webAccelerator: WEB_ACCELERATORS.toggleDetails,
  },
  {
    id: UI_COMMANDS.sideChat,
    label: 'Ask Here',
    section: 'view',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.sideChat,
    webAccelerator: WEB_ACCELERATORS.sideChat,
  },
  {
    id: UI_COMMANDS.modeChat,
    label: 'Chat Mode',
    section: 'view',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.modeChat,
    webAccelerator: WEB_ACCELERATORS.modeChat,
  },
  {
    id: UI_COMMANDS.modeWork,
    label: 'Work Mode',
    section: 'view',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.modeWork,
    webAccelerator: WEB_ACCELERATORS.modeWork,
  },
  {
    id: UI_COMMANDS.modeCode,
    label: 'Code Mode',
    section: 'view',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.modeCode,
    webAccelerator: WEB_ACCELERATORS.modeCode,
  },
  {
    id: UI_COMMANDS.settings,
    label: 'Settings',
    section: 'app',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.settings,
    webAccelerator: WEB_ACCELERATORS.settings,
  },
  {
    id: UI_COMMANDS.settingsPlugins,
    label: 'Plugin Settings',
    section: 'app',
    command: { kind: 'browser' },
    accelerator: UI_ACCELERATORS.settingsPlugins,
    webAccelerator: WEB_ACCELERATORS.settingsPlugins,
  },
]

/**
 * Build the document one shell reads.
 * @param items - the items to publish; the defaults when none are named.
 * @returns the document.
 */
export function buildMenuDocument(items: readonly MenuItem[] = DEFAULT_ITEMS): MenuDocument {
  return { version: MENU_CONTRACT_VERSION, items: [...items] }
}

/**
 * Every chord the document claims, so a duplicate is a fault the plugin
 * reports rather than a key one of two items silently wins.
 * @param document - the document to check.
 * @returns the chords claimed more than once, and the ids claiming them.
 */
export function duplicateAccelerators(document: MenuDocument): Map<string, string[]> {
  const claims = new Map<string, string[]>()
  for (const item of document.items) {
    if (item.accelerator === undefined) continue
    const holders = claims.get(item.accelerator) ?? []
    holders.push(item.id)
    claims.set(item.accelerator, holders)
  }
  for (const [chord, holders] of claims) {
    if (holders.length < 2) claims.delete(chord)
  }
  return claims
}

/**
 * Every id the document claims more than once. An invocation names an id, so
 * two items sharing one would make the request ambiguous.
 * @param document - the document to check.
 * @returns the repeated ids.
 */
export function duplicateIds(document: MenuDocument): string[] {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const item of document.items) {
    if (seen.has(item.id)) repeated.add(item.id)
    seen.add(item.id)
  }
  return [...repeated]
}

/** One web binding that was asked for and cannot exist. */
export interface UnbindableWebChord {
  /** The item that asked. */
  id: string
  /** The chord it named. */
  accelerator: string
  /** Why no listener can hold it. */
  reason:
    /** Not a chord this package's parser recognizes. */
    | 'malformed'
    /** A chord the browser handles above the page, so no listener is offered it. */
    | 'reserved'
}

/**
 * Every explicit `webAccelerator` no in-page listener could ever hold.
 *
 * Only the EXPLICIT ones. An item whose native `accelerator` happens to be
 * unreachable on the web — `new-window` holding `CmdOrCtrl+N` — has not asked
 * for anything impossible; it has a native binding and no web one, which is the
 * ordinary case and the reason `webAccelerator` is optional rather than
 * required. But writing `webAccelerator: 'CmdOrCtrl+W'` is a request, and the
 * only way to answer it is a key that quietly does nothing forever. That is the
 * failure this package exists to prevent, so it is a fault at mount rather than
 * a discovery six weeks later.
 * @param document - the document to check.
 * @returns the offending items, in document order.
 */
export function unbindableWebChords(document: MenuDocument): UnbindableWebChord[] {
  const faults: UnbindableWebChord[] = []
  for (const item of document.items) {
    const accelerator = item.webAccelerator
    if (accelerator === undefined || accelerator === null) continue
    const chord = parseAccelerator(accelerator)
    if (chord === undefined) faults.push({ id: item.id, accelerator, reason: 'malformed' })
    else if (isReservedByBrowser(chord)) faults.push({ id: item.id, accelerator, reason: 'reserved' })
  }
  return faults
}

/**
 * Every chord two items would both bind in the page, and the ids binding it.
 *
 * The web counterpart of {@link duplicateAccelerators}, and a separate check
 * because the two surfaces resolve differently: items that collide natively may
 * not collide in a tab, and items that agree natively may collide there once one
 * of them carries a `webAccelerator`. Only claims the page actually holds are
 * counted — a `shell` command binds nothing in a tab and so can collide with
 * nothing.
 * @param document - the document to check.
 * @returns the chords claimed more than once, and the ids claiming them.
 */
export function duplicateWebChords(document: MenuDocument): Map<string, string[]> {
  const claims = new Map<string, string[]>()
  for (const item of document.items) {
    const claim = claimFor(item, 'web')
    if (claim.holder !== 'page') continue
    const holders = claims.get(claim.accelerator) ?? []
    holders.push(item.id)
    claims.set(claim.accelerator, holders)
  }
  for (const [chord, holders] of claims) {
    if (holders.length < 2) claims.delete(chord)
  }
  return claims
}
