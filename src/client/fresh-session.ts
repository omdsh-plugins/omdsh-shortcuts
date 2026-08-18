/**
 * Honour the address `omdsh-desktop` loads a New Window at.
 *
 * The shell cannot start a conversation itself: its windows are ordinary web
 * content, and the harness UI restores `dsh.sessions.current` from origin-wide
 * localStorage on every load — the same cell every window of that origin
 * shares. So a New Window is asked for by putting `new` on the address, and
 * this page spends it: blank the restored selection before the session list
 * arrives and opens a history window, then drop the parameter so a reload of
 * THIS window is an ordinary restore.
 *
 * Does not start a conversation. New Window means the empty New Session page;
 * ⌘K is still what starts one.
 * @module @omdsh-plugins/omdsh-shortcuts/src/client/fresh-session
 */

/** The query parameter `omdsh-desktop` sets on a New Window load. */
export const NEW_SESSION_PARAM = 'new'

/** As much of `location` as spending the parameter reads. */
export interface LocationView {
  /** The query string, including a leading `?` when one is present. */
  search: string
  /** The path, with no query or hash. */
  pathname: string
  /** The fragment, including a leading `#` when one is present. */
  hash: string
}

/** As much of `history` as spending the parameter writes. */
export interface HistoryView {
  /**
   * Replace this page's address without a navigation.
   * @param state - unused; `replaceState` requires the slot.
   * @param unused - unused; `replaceState` requires the slot.
   * @param url - the address to show.
   */
  replaceState(state: unknown, unused: string, url: string): void
}

/** As much of `ctx.sessions` as a New Window needs: forget the selection. */
export interface SessionsClear {
  /** Clear the current selection into the no-session view state. */
  clear(): void
}

/**
 * Whether this load asked the page to start without the last selected session.
 * @param search - `location.search`.
 * @returns true when the desktop's parameter is present, regardless of value.
 */
export function wantsFreshSession(search: string): boolean {
  return new URLSearchParams(search).has(NEW_SESSION_PARAM)
}

/**
 * Drop the desktop's `new` parameter from this page's address, keeping every
 * other query field and the hash.
 * @param location - the page's address.
 * @param history - the history to rewrite.
 * @returns true when the parameter was present and has been removed.
 */
export function spendFreshSessionParam(location: LocationView, history: HistoryView): boolean {
  const params = new URLSearchParams(location.search)
  if (!params.has(NEW_SESSION_PARAM)) return false
  params.delete(NEW_SESSION_PARAM)
  const query = params.toString()
  history.replaceState(null, '', `${location.pathname}${query === '' ? '' : `?${query}`}${location.hash}`)
  return true
}

/**
 * Honour a New Window load: blank the restored selection, wait for `sessions`
 * if it has not been provided yet, then spend the parameter.
 *
 * `sessions` is resolved lazily for the same reason the built-in commands
 * resolve it lazily: this plugin must mount without it. The parameter is
 * spent either way, so a later inject cannot be defeated by a reload that
 * still carries `new`.
 * @param options - the page, the sessions face, and an optional inject.
 */
export function installFreshSession(options: {
  /** The page's address. */
  location: LocationView
  /** The history to rewrite. */
  history: HistoryView
  /** The sessions face, absent in a composition with no web app. */
  sessions: () => SessionsClear | undefined
  /**
   * Run a callback once `sessions` is provided. Absent on a test bench that
   * has no cordis `inject`; a missing face then stays missing.
   */
  inject?: (deps: string[], callback: () => void) => void
}): void {
  if (!wantsFreshSession(options.location.search)) return
  const clear = (): void => { options.sessions()?.clear() }
  clear()
  if (options.sessions() === undefined) options.inject?.(['sessions'], clear)
  spendFreshSessionParam(options.location, options.history)
}
