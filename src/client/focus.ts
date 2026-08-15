/**
 * Telling the runtime which surface the person is actually looking at.
 *
 * A press has to reach one client, and there is usually more than one: several
 * desktop windows, several tabs, or both at once against the same runtime.
 * "The one in front" is the only answer that is ever right, and this page is
 * the only party that knows it — the shell's windows are sandboxed with no
 * preload, and an HTTP request carries nothing about where somebody's attention
 * is. So the page says so, and keeps saying so.
 *
 * Reports are sent, never asked for. A poll would be both chattier and staler
 * than the two events that actually change the answer.
 * @module @omdsh-plugins/omdsh-shortcuts/src/client/focus
 */

import { CLIENT_FOCUS_PATH, type FocusReport } from '../contract.ts'

/** As much of the page as the reporter reads. */
export interface FocusView {
  /**
   * Subscribe to a window event.
   * @param type - the event name.
   * @param listener - the handler.
   */
  addEventListener: (type: string, listener: () => void) => void
  /**
   * Unsubscribe.
   * @param type - the event name.
   * @param listener - the handler.
   */
  removeEventListener: (type: string, listener: () => void) => void
  /** Whether this page currently holds focus. */
  hasFocus: () => boolean
}

/**
 * Send one report.
 * @param path - the route to post to.
 * @param body - the report.
 */
export type PostReport = (path: string, body: FocusReport) => void

/**
 * Report this client's focus for as long as the returned disposer is unspent.
 *
 * Reported once at install when the page already has focus, and on every later
 * `focus` event. The initial report matters more than it looks: a page that
 * loaded focused and is never touched again would otherwise sit behind whoever
 * connected after it, and the first press would open a panel in a window nobody
 * is looking at.
 * @param view - the page's focus surface; an adapter over `window`'s events and `document.hasFocus`.
 * @param client - this client's id.
 * @param post - sends the report.
 * @returns the removal.
 */
export function installFocusReports(view: FocusView, client: string, post: PostReport): () => void {
  const report = (): void => { post(CLIENT_FOCUS_PATH, { client }) }
  view.addEventListener('focus', report)
  if (view.hasFocus()) report()
  return () => { view.removeEventListener('focus', report) }
}
