/**
 * Honouring the address `omdsh-desktop` loads a New Window at.
 *
 * The cases that matter are the ones a shared localStorage cell would get
 * wrong: a first window that must keep its restored selection, a new window
 * that must not, a reload of that new window that must not blank again, and a
 * composition that has not provided `sessions` yet.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  NEW_SESSION_PARAM,
  installFreshSession,
  spendFreshSessionParam,
  wantsFreshSession,
  type HistoryView,
  type LocationView,
} from '../src/client/fresh-session.ts'

/** A page address the spec can rewrite. */
function page(search: string, extra: Partial<LocationView> = {}): LocationView {
  return { search, pathname: '/', hash: '', ...extra }
}

/** A history that rewrites the page's search/hash in place. */
function historyFor(location: LocationView): HistoryView {
  return {
    replaceState(_state, _unused, url) {
      const parsed = new URL(url, 'http://127.0.0.1/')
      location.search = parsed.search
      location.pathname = parsed.pathname
      location.hash = parsed.hash
    },
  }
}

describe('wantsFreshSession', () => {
  it('is the presence of the desktop parameter, not a particular value', () => {
    expect(wantsFreshSession('')).toBe(false)
    expect(wantsFreshSession('?fixture=1')).toBe(false)
    expect(wantsFreshSession(`?${NEW_SESSION_PARAM}=1`)).toBe(true)
    expect(wantsFreshSession(`?${NEW_SESSION_PARAM}`)).toBe(true)
    expect(wantsFreshSession(`?fixture=1&${NEW_SESSION_PARAM}=1`)).toBe(true)
  })
})

describe('spendFreshSessionParam', () => {
  it('drops the parameter and keeps every other query field and the hash', () => {
    const location = page(`?fixture=1&${NEW_SESSION_PARAM}=1`, { hash: '#pane' })
    expect(spendFreshSessionParam(location, historyFor(location))).toBe(true)
    expect(location.search).toBe('?fixture=1')
    expect(location.hash).toBe('#pane')
  })

  it('leaves an address that never asked for a fresh session alone', () => {
    const location = page('?fixture=1')
    expect(spendFreshSessionParam(location, historyFor(location))).toBe(false)
    expect(location.search).toBe('?fixture=1')
  })
})

describe('installFreshSession', () => {
  it('does nothing on an ordinary load, so the first window keeps its restore', () => {
    const clear = vi.fn()
    const inject = vi.fn()
    const location = page('')
    installFreshSession({
      location,
      history: historyFor(location),
      sessions: () => ({ clear }),
      inject,
    })
    expect(clear).not.toHaveBeenCalled()
    expect(inject).not.toHaveBeenCalled()
    expect(location.search).toBe('')
  })

  it('blanks the restored selection and spends the parameter', () => {
    const clear = vi.fn()
    const location = page(`?${NEW_SESSION_PARAM}=1`)
    installFreshSession({
      location,
      history: historyFor(location),
      sessions: () => ({ clear }),
    })
    expect(clear).toHaveBeenCalledTimes(1)
    expect(location.search).toBe('')
  })

  it('waits for sessions when this composition has not provided them yet', () => {
    const clear = vi.fn()
    let sessions: { clear: () => void } | undefined
    const inject = vi.fn((deps: string[], callback: () => void) => {
      expect(deps).toEqual(['sessions'])
      sessions = { clear }
      callback()
    })
    const location = page(`?${NEW_SESSION_PARAM}=1`)
    installFreshSession({
      location,
      history: historyFor(location),
      sessions: () => sessions,
      inject,
    })
    expect(inject).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledTimes(1)
    expect(location.search).toBe('')
  })

  it('still spends the parameter when there is no sessions face and no inject', () => {
    const location = page(`?${NEW_SESSION_PARAM}=1`)
    expect(() => installFreshSession({
      location,
      history: historyFor(location),
      sessions: () => undefined,
    })).not.toThrow()
    expect(location.search).toBe('')
  })
})
