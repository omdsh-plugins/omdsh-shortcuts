/**
 * The commands this package performs itself, and why a keybinding layer ships
 * any at all.
 *
 * The rest of this plugin is deliberately a switchboard: it says which chord
 * reaches which id and nothing about what an id does, so a plugin owns its own
 * behaviour and a person owns the key. That arrangement needs one thing from
 * the other side — someone has to `register` the behaviour — and for most of
 * the UI someone does. `omdsh-sidepanel` registers its panels, `omdsh-sidechat`
 * registers its summon, and neither of them appears in this file.
 *
 * The commands below are the ones with no such owner, in two flavours:
 *
 * - **Reachable through a published service.** New Session, the sidebar and
 *   details columns, the workspace registry, the mode switch. Nothing in the
 *   harness registers a shortcut for these because the harness has no shortcut
 *   service to register with — this one arrives from outside it — so the call
 *   has to be made from somewhere, and here is the only place that knows the
 *   chord was pressed.
 * - **Reachable only through the DOM.** The settings dialog, the page and tab it
 *   is showing, and the sidebar's session search hold their state as
 *   component-local React state inside harness packages, which this repository
 *   does not edit. See
 *   {@link ./anchors.ts} for what makes those addresses defensible; the point
 *   here is that they are confined to three handlers and that each one degrades
 *   to a logged miss rather than a broken page.
 *
 * Every handler is written to be a no-op when the thing it drives is absent. A
 * composition without `@omdsh-plugins/omdsh-base` has no mode switch, and pressing ⌘1
 * there should do nothing at all — not throw, and not take the listener down
 * with it.
 * @module @omdsh-plugins/omdsh-shortcuts/src/client/builtins
 */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { UI_COMMANDS } from '../menu.ts'
import {
  buttonAroundSlot, detailsCollapsed, searchToggle, settingsDialog, settingsPages, settingsTab,
  sidebarCollapsed, waitFor,
} from './anchors.ts'
import { settingsPageIndex, type CommandServices, type SlotEntries } from './services.ts'

/** The settings page `settings.plugins` selects, by the id its registrant used. */
export const PLUGINS_SECTION_ID = 'plugins'

/** The seat the Plugins page's tabs register in. */
export const PLUGINS_TAB_SLOT = 'settings.plugins.tab'

/**
 * The tab `settings.plugins` finishes on: the Plugin hub, when the composition
 * has one.
 *
 * The Plugins page is a strip of tabs owned by whoever registered them, and the
 * shipped pair — Configurable, All — is an inventory. The hub is the page a
 * person actually goes to Plugins FOR: install, update, uninstall, and the
 * settings form for every plugin that declared one, this package's own chord
 * table included. Landing on it is what makes the chord worth a key, and a
 * composition without `@omdsh-plugins/omdsh-plughub` simply arrives at the
 * Plugins page and stops there.
 *
 * The id is that plugin's `TAB_ID`, copied rather than imported: a cross-plugin
 * value import is a client-bundle purity error, and a registration id is a wire
 * name.
 */
export const PLUGIN_HUB_TAB_ID = 'omdsh'

/** Where the settings dialog's own trigger lives, so a chord presses what a mouse would. */
export const SETTINGS_TRIGGER_SLOT = 'settings.trigger'

/** Registration face, structurally: the browser half's own `register`. */
export type Register = (command: string, handler: () => void) => () => void

/** Where a handler reports that it could not reach what it was asked to drive. */
export type Report = (message: string) => void

/**
 * Open the settings dialog if it is closed, and answer whether it is open now.
 *
 * Pressing the trigger while the dialog is already up would not close it — the
 * trigger only ever sets open — but it would move focus, so the check is worth
 * the read.
 * @param report - where an unreachable trigger is noted.
 * @returns whether the dialog is on screen.
 */
async function openSettings(report: Report): Promise<boolean> {
  if (settingsDialog() !== undefined) return true
  const trigger = buttonAroundSlot(SETTINGS_TRIGGER_SLOT)
  if (trigger === undefined) {
    report('settings.open: no settings trigger on this surface')
    return false
  }
  trigger.click()
  return await waitFor(() => settingsDialog()) !== undefined
}

/**
 * Finish a Plugins press on the Plugin hub tab, when this composition has one.
 *
 * The registry is asked FIRST, and the DOM only afterwards. That ordering is
 * what keeps the two outcomes apart: a composition that never registered the
 * hub is not a fault and must not be reported on every press, while a hub that
 * IS registered and whose button never rendered is a fault worth a line —
 * telling them apart from the DOM alone would mean spending the whole
 * appearance budget to learn which case this is.
 * @param slots - the slot registry, when this composition has one.
 * @param report - where a registered tab that never rendered is noted.
 */
async function selectPluginHub(slots: SlotEntries | undefined, report: Report): Promise<void> {
  const registered = slots?.entries(PLUGINS_TAB_SLOT)
    .some(entry => entry.options.id === PLUGIN_HUB_TAB_ID) ?? false
  if (!registered) return
  const tab = await waitFor(() => settingsTab(PLUGIN_HUB_TAB_ID))
  if (tab === undefined) {
    report(`settings.plugins: the ${PLUGIN_HUB_TAB_ID} tab is registered but never rendered`)
    return
  }
  // A second press should not move focus off whatever the person is editing in
  // the hub, and pressing the tab that is already selected would.
  if (tab.getAttribute('aria-selected') === 'true') return
  tab.click()
}

/**
 * Register every command this package performs.
 *
 * @param register - the browser half's registration face.
 * @param services - lazily-resolved service faces.
 * @param report - where a handler notes that it could not reach its target;
 * `console.warn` in the plugin, a spy in a spec.
 * @returns the disposer removing every registration, in one call.
 */
export function installBuiltins(
  register: Register,
  services: CommandServices,
  report: Report,
): () => void {
  const disposers: (() => void)[] = []

  /**
   * Register one handler, letting an async body settle on its own.
   *
   * A press is not a call site that can await, and a rejection inside one must
   * not surface as an unhandled rejection in a page that is otherwise fine.
   * @param command - the item id.
   * @param run - what the press performs.
   */
  const on = (command: string, run: () => void | Promise<void>): void => {
    const handler = (): void => {
      try {
        void Promise.resolve(run()).catch((error: unknown) => {
          report(`${command}: ${String(error)}`)
        })
      } catch (error) {
        report(`${command}: ${String(error)}`)
      }
    }
    try {
      disposers.push(register(command, handler))
    } catch {
      // Something in this page already answers to this id. These are fallbacks
      // for behaviours with no owner, so an id that turns out to HAVE one is
      // the owner winning — the right outcome, and not a reason to drop the ten
      // commands registered either side of it.
      report(`${command}: already handled in this page; leaving it to its owner`)
    }
  }

  /**
   * The conversation a session command acts on.
   * @returns the current session id, or undefined in the no-session state.
   */
  const currentSession = (): SessionId | undefined => services.sessions()?.list.getSnapshot().current

  on(UI_COMMANDS.newSession, () => {
    // Offered to the active posture first: New Session means "another
    // conversation like the one I am in", and in Code mode that is a terminal
    // the frame has never heard of. A posture that declines leaves the request
    // to the frame, which is the shipped behaviour.
    if (services.modes()?.requestNewSession() === true) return
    const workspaces = services.workspaces()
    if (workspaces === undefined) {
      report('session.new: no workspaces service on this surface')
      return
    }
    workspaces.startSession()
  })

  on(UI_COMMANDS.forkSession, async () => {
    const sessions = services.sessions()
    const sessionId = currentSession()
    if (sessions === undefined || sessionId === undefined) {
      report('session.fork: no current conversation to fork')
      return
    }
    // Opened after the fork resolves: until then the child is not in the list
    // store, and `open` fails loud on an id it cannot find.
    sessions.open(await sessions.fork({ sessionId }))
  })

  on(UI_COMMANDS.archiveSession, async () => {
    const workspaces = services.workspaces()
    const sessionId = currentSession()
    if (workspaces === undefined || sessionId === undefined) {
      report('session.archive: no current conversation to archive')
      return
    }
    // Archiving the current session clears the selection into the New Session
    // view state, which the workspaces domain does on its own.
    await workspaces.archiveSession(sessionId)
  })

  on(UI_COMMANDS.addWorkspace, async () => {
    const workspaces = services.workspaces()
    if (workspaces === undefined) {
      report('workspace.add: no workspaces service on this surface')
      return
    }
    const path = await workspaces.pickDirectory()
    // Null is the person cancelling the picker, which is not a failure and gets
    // no report.
    if (path === null) return
    await workspaces.create({ path })
  })

  on(UI_COMMANDS.toggleSidebar, () => {
    const layout = services.layout()
    if (layout === undefined) {
      report('sidebar.toggle: no layout service on this surface')
      return
    }
    layout.toggleSidebar()
  })

  on(UI_COMMANDS.toggleDetails, () => {
    const layout = services.layout()
    if (layout === undefined) {
      report('details.toggle: no layout service on this surface')
      return
    }
    // The face has open and close but no toggle, and the frame's own state
    // attribute is the only honest source for which one this press means —
    // holding a bit here would disagree with the screen the first time somebody
    // closed the column with the mouse.
    if (detailsCollapsed()) layout.openDetails()
    else layout.closeDetails()
  })

  on(UI_COMMANDS.search, async () => {
    // A rail-width column renders the search control as a 28px circle with a
    // zero-width field inside it, so focusing it there would put the caret
    // somewhere invisible. Unfolding first is what makes the chord mean "search
    // sessions" rather than "search sessions, if the sidebar happens to be open".
    if (sidebarCollapsed()) {
      services.layout()?.toggleSidebar()
      await waitFor(() => (sidebarCollapsed() ? undefined : true))
    }
    const toggle = searchToggle()
    if (toggle === undefined) {
      report('session.search: no session search on this surface')
      return
    }
    // One click does both halves: the button expands the field, and the same
    // press reaches the container that owns the input ref and focuses it.
    toggle.click()
  })

  for (const [command, segment] of [
    [UI_COMMANDS.modeChat, 'chat'],
    [UI_COMMANDS.modeWork, 'work'],
    [UI_COMMANDS.modeCode, 'code'],
  ] as const) {
    on(command, () => {
      // An unknown or unavailable segment does nothing, by the registry's own
      // contract — so this is safe to bind in a composition with no Code mode,
      // and safe to press while Code has no directory to start a terminal in.
      services.modes()?.enter(segment)
    })
  }

  on(UI_COMMANDS.settings, async () => { await openSettings(report) })

  on(UI_COMMANDS.settingsPlugins, async () => {
    if (!await openSettings(report)) return
    const slots = services.slots()
    const at = slots === undefined ? undefined : settingsPageIndex(slots, PLUGINS_SECTION_ID)
    if (at === undefined) {
      // The dialog is open on whatever page it last showed, which is a better
      // outcome than a press that did nothing at all.
      report(`settings.plugins: no ${PLUGINS_SECTION_ID} settings page is registered`)
      return
    }
    const page = await waitFor(() => settingsPages()[at])
    if (page === undefined) {
      report('settings.plugins: the settings dialog rendered no page rail')
      return
    }
    page.click()
    await selectPluginHub(slots, report)
  })

  return () => {
    for (const dispose of disposers) dispose()
    disposers.length = 0
  }
}
