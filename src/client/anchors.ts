/**
 * The handful of harness surfaces a chord can only reach through the DOM, and
 * the addresses that make reaching them defensible.
 *
 * ## Why this module exists at all
 *
 * Most of what a keybinding wants to do has a service behind it: the layout
 * columns, the session list, the workspace registry and the mode switch all
 * publish a face a plugin may call. Three do not. The settings dialog's open
 * state and its selected page are, in the harness's own words, "component-local
 * viewing state"; the sidebar's session search is a `useState` inside
 * `ui-workspace`. Those packages ship inside the harness, which this repository
 * does not edit, so there is no seam to add and no version in which asking
 * nicely works.
 *
 * The choice is therefore between driving them from the outside and not binding
 * them at all. This module drives them, and confines every selector to one file
 * so the cost of that choice is countable.
 *
 * ## What makes these addresses better than the usual DOM scraping
 *
 * Every anchor below is a **contract the framework emits**, not a class name or
 * a shape that happens to render today:
 *
 * - `[data-slot="<key>"]` is written by the slot outlet itself
 *   (`dsh-client-web-react`), on every slot, unconditionally. A slot key is
 *   part of the published SlotMap — renaming one is a breaking change the
 *   harness announces.
 * - `data-sidebar-collapsed` / `data-details-collapsed` are the frame's own
 *   state attributes, and are what its stylesheet reads. They cannot drift from
 *   the truth without the layout visibly breaking first.
 * - `role="dialog"` / `aria-modal` / `aria-expanded` / `aria-haspopup` are
 *   accessibility contracts. A refactor that drops them is a bug in its own
 *   right, so depending on them makes this module fail in the same direction as
 *   a screen reader rather than in a direction nobody notices.
 *
 * What is deliberately NOT used: CSS-module class names (hashed per build),
 * visible text (localized), and DOM order within a region (renders in whatever
 * order registrations resolved). The one place order is unavoidable — picking
 * one settings page out of the nav rail — reads its index from the slot
 * registry rather than guessing it, so the id, not the position, is the thing
 * being matched.
 *
 * Every function here answers `undefined` rather than throwing. A surface that
 * is not on screen is the ordinary case: a composition without `ui-workspace`
 * has no search box, and a press before the frame mounts has nothing to press.
 * @module @omdsh-plugins/omdsh-shortcuts/src/client/anchors
 */

/** How long a press waits for a surface it just asked to appear, in ms. */
const APPEAR_TIMEOUT = 1500

/** How often it looks, in ms. One animation frame, near enough. */
const APPEAR_INTERVAL = 16

/**
 * The nearest `<button>` a slot outlet sits inside.
 *
 * Slot outlets render as `display: contents` wrappers, so the trigger a person
 * clicks is the outlet's ANCESTOR, not the outlet itself: the harness puts the
 * slot inside the button so a registrant contributes the label and the shell
 * keeps the press. Walking up is therefore the intended reading of that
 * arrangement rather than a trick played on it.
 * @param slot - the slot key.
 * @param root - the document to search.
 * @returns the button, or undefined when the slot is unoccupied.
 */
export function buttonAroundSlot(slot: string, root: Document = document): HTMLElement | undefined {
  const outlet = root.querySelector(`[data-slot="${slot}"]`)
  return outlet?.closest('button') ?? undefined
}

/**
 * The settings dialog, when it is open.
 *
 * Addressed by its ARIA role rather than by anything of the settings package's
 * own, because it is the only modal the frame renders and `aria-modal` is the
 * assertion that this is so.
 * @param root - the document to search.
 * @returns the dialog element, or undefined while the dialog is closed.
 */
export function settingsDialog(root: Document = document): HTMLElement | undefined {
  return root.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]') ?? undefined
}

/**
 * Whether the sidebar column is folded to its rail.
 *
 * The attribute is only present while true, so its absence is the open state —
 * which is also why this cannot be confused with "the frame has not mounted":
 * a page with no frame answers false and every caller treats false as "nothing
 * to unfold".
 * @param root - the document to search.
 * @returns true while the column is a rail.
 */
export function sidebarCollapsed(root: Document = document): boolean {
  return root.querySelector('[data-sidebar-collapsed]') !== null
}

/**
 * Whether the details column is closed.
 * @param root - the document to search.
 * @returns true while the column is closed.
 */
export function detailsCollapsed(root: Document = document): boolean {
  return root.querySelector('[data-details-collapsed]') !== null
}

/**
 * The sidebar's search control.
 *
 * `aria-expanded` is what distinguishes it from the other buttons in the
 * browsing region: the search toggle is the only one that reports an expansion
 * state, because it is the only one that grows into a text field. Pressing it
 * both expands the field and — through the click bubbling to the container that
 * owns the input ref — puts the caret in it, which is why nothing here has to
 * find the `<input>` separately.
 * @param root - the document to search.
 * @returns the toggle, or undefined when the browsing region is absent.
 */
export function searchToggle(root: Document = document): HTMLElement | undefined {
  const region = root.querySelector('[data-slot="sidebar.workspaces"]')
  return region?.querySelector<HTMLElement>('button[aria-expanded]') ?? undefined
}

/**
 * The settings dialog's page buttons, in the order the rail renders them.
 *
 * The rail projects one button per `settings.section` registration, ordered by
 * the registration's `order`. The buttons carry no id — the section id lives
 * only in React's key — so a caller that wants one page by name resolves its
 * INDEX from the slot registry and reads it out of this list. That keeps the
 * matching on the id, with the DOM supplying nothing but position.
 * @param root - the document to search.
 * @returns the buttons, or an empty list while the dialog is closed.
 */
export function settingsPages(root: Document = document): HTMLElement[] {
  const dialog = settingsDialog(root)
  if (dialog === undefined) return []
  return [...dialog.querySelectorAll<HTMLElement>('nav button')]
}

/**
 * The tab strip the Plugins settings page renders, in the order it renders it.
 *
 * `role="tab"` is the accessibility contract that says these buttons switch the
 * page under them, and the Plugins section is the only settings page that
 * builds one — so this needs no ancestor of its own to scope it.
 * @param root - the document to search.
 * @returns the tab buttons, or an empty list while no tabbed page is showing.
 */
export function settingsTabs(root: Document = document): HTMLElement[] {
  const dialog = settingsDialog(root)
  if (dialog === undefined) return []
  return [...dialog.querySelectorAll<HTMLElement>('[role="tab"]')]
}

/**
 * One tab in that strip, by the id its registrant used.
 *
 * Unlike the nav rail, this one keeps the id in the document: the section
 * composes each tab's element id as `` `${useId()}-tab-${entry.id}` `` and its
 * `aria-controls` as `` `${useId()}-panel-${entry.id}` ``, because ARIA needs
 * the button and the panel to name each other. The `useId()` half is React's
 * and deliberately opaque, so the match is on the suffix — which leaves the
 * registration id, not a position, as the thing being matched, and makes this a
 * better address than {@link settingsPages} rather than a worse one.
 * @param id - the tab's registration id.
 * @param root - the document to search.
 * @returns the tab button, or undefined when nothing registered that id.
 */
export function settingsTab(id: string, root: Document = document): HTMLElement | undefined {
  return settingsTabs(root).find(tab => tab.id.endsWith(`-tab-${id}`))
}

/**
 * Wait for something a press has just asked to appear.
 *
 * A React state change lands on the next paint, so a command that opens the
 * settings dialog and then selects a page inside it cannot do both in one tick.
 * Polling rather than a `MutationObserver` because the wait is bounded, short,
 * and over in one or two frames in every case that succeeds — an observer would
 * be more machinery for the same two frames.
 * @param find - the lookup to retry.
 * @param timeout - how long to keep trying, in ms.
 * @returns what `find` answered, or undefined once the budget is spent.
 */
export async function waitFor<T>(find: () => T | undefined, timeout = APPEAR_TIMEOUT): Promise<T | undefined> {
  const deadline = Date.now() + timeout
  for (;;) {
    const found = find()
    if (found !== undefined) return found
    if (Date.now() >= deadline) return undefined
    await new Promise<void>((resolve) => { setTimeout(resolve, APPEAR_INTERVAL) })
  }
}
