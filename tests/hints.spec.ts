// @vitest-environment jsdom
/**
 * Teaching a chord on a button this package does not own.
 *
 * Two properties carry the feature, and nearly every case here is about one of
 * them:
 *
 * - **A control is recognized by what the harness calls it**, resolved through
 *   the harness's own dictionary rather than by a class name, a rendered string
 *   or a position. So the specs below build the markup the harness actually
 *   emits — an `aria-label` the `sidebar` namespace produced, a slot outlet
 *   inside a button, an `aria-modal` dialog's nav rail — and a spec passing
 *   means the anchor survives anything but a change to those.
 * - **The chord rides the harness's own tooltip where there is one.** Two
 *   bubbles for one button is the failure this is arranged against, so the
 *   package's own plate appears only after the wait proves nothing else will.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHORD_ATTRIBUTE, HARNESS_ANCHORS, HINT_ATTRIBUTE, HINT_DELAY, SIDEBAR_NS, WORKSPACE_NS,
  commandForControl, controlName, hintText, installHints, type HintsOptions,
} from '../src/client/hints.ts'
import type { ILocale, SlotEntries } from '../src/client/services.ts'
import { UI_COMMANDS } from '../src/menu.ts'
import type { MenuItem } from '../src/contract.ts'

/** The harness's own words for the controls this package hangs hints on. */
const DICTS: Record<string, Record<string, string>> = {
  [SIDEBAR_NS]: {
    'session.new.label': 'New session',
    'toggle.open': 'Open sidebar',
    'toggle.collapse': 'Collapse sidebar',
  },
  [WORKSPACE_NS]: {
    'workspace.add': 'Add workspace',
    'search.sessions.aria': 'Search sessions',
  },
}

/** The locale registry, answering the way the harness's does: a miss is the key. */
function locale(dicts: Record<string, Record<string, string>> = DICTS): ILocale {
  return { bind: (ns: string) => (key: string) => dicts[ns]?.[key] ?? key }
}

/** A slot ledger holding the settings pages one composition registered. */
function ledger(ids: readonly string[]): SlotEntries {
  return { entries: () => ids.map((id, order) => ({ options: { id, order } })) }
}

/**
 * One button, in the body.
 * @param attributes - what it carries.
 * @param text - its visible text.
 * @returns the button.
 */
function button(attributes: Record<string, string> = {}, text = ''): HTMLButtonElement {
  const element = document.createElement('button')
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  element.textContent = text
  document.body.append(element)
  return element
}

/** The lookup every recognition case resolves against. */
function lookup(overrides: Partial<HintsOptions> = {}) {
  return {
    items: () => [] as readonly MenuItem[],
    services: { slots: () => undefined, locale: () => locale() },
    root: document,
    ...overrides,
  }
}

/** A menu item, as a composition writes one. */
function item(id: string, anchor?: string): MenuItem {
  return { id, label: id, section: 'view', command: { kind: 'browser' }, ...anchor === undefined ? {} : { anchor } }
}

describe('which command a control performs', () => {
  it('recognizes New Session by the name the sidebar gives it', () => {
    expect(commandForControl(button({ 'aria-label': 'New session' }), lookup()))
      .toBe(UI_COMMANDS.newSession)
  })

  it('recognizes the fold toggle under both of its names, because it renames itself with its state', () => {
    for (const name of ['Collapse sidebar', 'Open sidebar']) {
      expect(commandForControl(button({ 'aria-label': name }), lookup())).toBe(UI_COMMANDS.toggleSidebar)
    }
  })

  it('recognizes session search and add workspace by the workspace region\'s words', () => {
    expect(commandForControl(button({ 'aria-label': 'Search sessions' }), lookup())).toBe(UI_COMMANDS.search)
    expect(commandForControl(button({ 'aria-label': 'Add workspace' }), lookup())).toBe(UI_COMMANDS.addWorkspace)
  })

  it('recognizes the settings trigger through the slot outlet inside it', () => {
    // The outlet renders `display: contents` INSIDE the button the shell owns,
    // so the control is the outlet's ancestor.
    const trigger = button({}, '')
    const outlet = document.createElement('span')
    outlet.setAttribute('data-slot', 'settings.trigger')
    trigger.append(outlet)
    expect(commandForControl(trigger, lookup())).toBe(UI_COMMANDS.settings)
  })

  it('recognizes the dialog\'s Plugins row by its place in the slot ledger, not by its text', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const nav = document.createElement('nav')
    // Rows carry no id in the DOM: the id lives in React's key, so the position
    // comes from the ledger and the DOM supplies nothing but order.
    const rows = ['General', 'Models', 'Plugins'].map((text) => {
      const row = document.createElement('button')
      row.textContent = text
      nav.append(row)
      return row
    })
    dialog.append(nav)
    document.body.append(dialog)
    const services = { slots: () => ledger(['general', 'models', 'plugins']), locale: () => locale() }
    expect(commandForControl(rows[2] as HTMLElement, lookup({ services }))).toBe(UI_COMMANDS.settingsPlugins)
    expect(commandForControl(rows[0] as HTMLElement, lookup({ services }))).toBeUndefined()
  })

  it('teaches nothing on a control no anchor describes', () => {
    expect(commandForControl(button({ 'aria-label': 'Send' }), lookup())).toBeUndefined()
    expect(commandForControl(button(), lookup())).toBeUndefined()
  })

  it('matches nothing at all without a locale service, rather than guessing', () => {
    const services = { slots: () => undefined, locale: () => undefined }
    expect(commandForControl(button({ 'aria-label': 'New session' }), lookup({ services }))).toBeUndefined()
  })

  it('lets a composition point its own command at a button, ahead of everything shipped here', () => {
    const control = button({ 'aria-label': 'New session', 'data-mine': '' })
    const items = () => [item('composed.command', '[data-mine]')]
    expect(commandForControl(control, lookup({ items }))).toBe('composed.command')
  })

  it('ignores a selector that does not parse instead of losing the rest of the surface', () => {
    const control = button({ 'aria-label': 'New session' })
    const items = () => [item('broken', ':::'), item('composed.command', '[data-nothing]')]
    expect(commandForControl(control, lookup({ items }))).toBe(UI_COMMANDS.newSession)
  })

  it('names every command it anchors exactly once', () => {
    const commands = HARNESS_ANCHORS.map(anchor => anchor.command)
    expect(new Set(commands).size).toBe(commands.length)
  })
})

describe('what a hint reads', () => {
  it('joins a name to its chord the way every omdsh tooltip does', () => {
    expect(hintText('New session', '⌘K')).toBe('New session · ⌘K')
  })

  it('is the chord alone when the control has no name to show', () => {
    expect(hintText(undefined, '⌘K')).toBe('⌘K')
  })

  it('prefers the accessible name and falls back to the visible text', () => {
    expect(controlName(button({ 'aria-label': 'New session' }, 'New Session'))).toBe('New session')
    expect(controlName(button({}, ' Settings '))).toBe('Settings')
    expect(controlName(button())).toBeUndefined()
  })
})

describe('hovering a control', () => {
  let dispose: () => void = () => {}

  /**
   * Install the hints against a controllable set of faces.
   * @param overrides - what this case changes.
   * @returns nothing; the disposer is taken down after each case.
   */
  function install(overrides: Partial<HintsOptions> = {}): void {
    dispose = installHints(window, {
      chordLabel: () => '⌘K',
      enabled: () => true,
      ...lookup(),
      ...overrides,
    })
  }

  /**
   * Move the pointer onto one control.
   * @param control - what the pointer entered.
   */
  function hover(control: Element): void {
    control.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
  }

  /**
   * Move the pointer off it again.
   * @param control - what the pointer left.
   */
  function leave(control: Element): void {
    control.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }))
  }

  /**
   * Render the tooltip the harness would, for a control being hovered.
   * @param label - what the harness wrote in it.
   * @returns the plate.
   */
  function harnessTooltip(label: string): HTMLElement {
    const bubble = document.createElement('span')
    bubble.setAttribute('role', 'tooltip')
    bubble.textContent = label
    document.body.append(bubble)
    return bubble
  }

  /** The plate this package raised, if it raised one. */
  const ownPlate = (): HTMLElement | null => document.body.querySelector(`[${HINT_ATTRIBUTE}]`)

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    dispose()
    vi.useRealTimers()
  })

  it('writes the chord into the tooltip the harness raised, rather than beside it', async () => {
    install()
    const control = button({ 'aria-label': 'New session' })
    hover(control)
    const bubble = harnessTooltip('New session')
    // The observer delivers on a microtask, before any timer.
    await Promise.resolve()
    expect(bubble.textContent).toBe('New session · ⌘K')
    expect(ownPlate()).toBeNull()
  })

  it('appends once, however many times the same plate is noticed', async () => {
    install()
    const control = button({ 'aria-label': 'New session' })
    hover(control)
    const bubble = harnessTooltip('New session')
    await Promise.resolve()
    vi.advanceTimersByTime(HINT_DELAY)
    expect(bubble.querySelectorAll(`[${CHORD_ATTRIBUTE}]`)).toHaveLength(1)
  })

  it('raises a plate of its own only where the harness raises none', () => {
    install()
    const control = button({ 'aria-label': 'Add workspace' })
    hover(control)
    expect(ownPlate()).toBeNull()
    vi.advanceTimersByTime(HINT_DELAY)
    expect(ownPlate()?.textContent).toBe('Add workspace · ⌘K')
  })

  it('takes its own plate down when the pointer leaves', () => {
    install()
    const control = button({ 'aria-label': 'Add workspace' })
    hover(control)
    vi.advanceTimersByTime(HINT_DELAY)
    leave(control)
    expect(ownPlate()).toBeNull()
  })

  it('drops its own plate when the harness tooltip arrives late', async () => {
    install()
    const control = button({ 'aria-label': 'Add workspace' })
    hover(control)
    vi.advanceTimersByTime(HINT_DELAY)
    expect(ownPlate()).not.toBeNull()
    const bubble = harnessTooltip('Add workspace')
    await Promise.resolve()
    expect(ownPlate()).toBeNull()
    expect(bubble.textContent).toBe('Add workspace · ⌘K')
  })

  it('teaches nothing for a command no chord reaches on this surface', () => {
    install({ chordLabel: () => undefined })
    hover(button({ 'aria-label': 'Add workspace' }))
    vi.advanceTimersByTime(HINT_DELAY)
    expect(ownPlate()).toBeNull()
  })

  it('teaches nothing while the setting is off', async () => {
    install({ enabled: () => false })
    const control = button({ 'aria-label': 'New session' })
    hover(control)
    const bubble = harnessTooltip('New session')
    await Promise.resolve()
    vi.advanceTimersByTime(HINT_DELAY)
    expect(bubble.textContent).toBe('New session')
    expect(ownPlate()).toBeNull()
  })

  it('leaves a control nothing recognizes exactly as it found it', async () => {
    install()
    hover(button({ 'aria-label': 'Send' }))
    const bubble = harnessTooltip('Send')
    await Promise.resolve()
    vi.advanceTimersByTime(HINT_DELAY)
    expect(bubble.textContent).toBe('Send')
    expect(ownPlate()).toBeNull()
  })

  it('follows the pointer from one control to the next', () => {
    install()
    const first = button({ 'aria-label': 'New session' })
    const second = button({ 'aria-label': 'Add workspace' })
    hover(first)
    hover(second)
    vi.advanceTimersByTime(HINT_DELAY)
    expect(ownPlate()?.textContent).toBe('Add workspace · ⌘K')
  })

  it('gives the page back everything it wrote when the plugin unmounts', async () => {
    install()
    const control = button({ 'aria-label': 'New session' })
    hover(control)
    const bubble = harnessTooltip('New session')
    await Promise.resolve()
    dispose()
    dispose = () => {}
    expect(bubble.textContent).toBe('New session')
    expect(ownPlate()).toBeNull()
    // And it is deaf afterwards: a hover the disposed listener still heard
    // would be a plate nobody can take down.
    hover(control)
    vi.advanceTimersByTime(HINT_DELAY)
    expect(ownPlate()).toBeNull()
  })

  it('teaches a chord to the keyboard too, on focus', () => {
    install()
    const control = button({ 'aria-label': 'Add workspace' })
    control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    vi.advanceTimersByTime(HINT_DELAY)
    expect(ownPlate()?.textContent).toBe('Add workspace · ⌘K')
  })

  it('takes the hint down when the control is pressed', () => {
    install()
    const control = button({ 'aria-label': 'Add workspace' })
    hover(control)
    vi.advanceTimersByTime(HINT_DELAY)
    control.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(ownPlate()).toBeNull()
  })
})
