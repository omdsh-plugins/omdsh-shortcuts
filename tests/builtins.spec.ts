// @vitest-environment jsdom
/**
 * The commands this package performs itself.
 *
 * Two properties matter more than the happy paths, and most of these cases are
 * about them:
 *
 * - **A missing service is a no-op, never a throw.** These handlers run inside
 *   a global key listener. One that throws on a composition without Chat mode
 *   would take every other chord down with it, which is exactly the failure a
 *   removable keybinding layer exists to avoid.
 * - **The DOM-driven three address contracts, not renderings.** The specs build
 *   the markup the harness actually emits — a slot outlet inside a button, the
 *   frame's state attributes, an `aria-modal` dialog — so a spec passing means
 *   the anchor survives anything but a change to those contracts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detailsCollapsed, sidebarCollapsed, buttonAroundSlot, settingsDialog, settingsPages, settingsTab,
} from '../src/client/anchors.ts'
import {
  installBuiltins, PLUGIN_HUB_TAB_ID, PLUGINS_SECTION_ID, PLUGINS_TAB_SLOT,
  type Register, type Report,
} from '../src/client/builtins.ts'
import { settingsPageIndex, type CommandServices, type SlotEntries } from '../src/client/services.ts'
import { UI_COMMANDS } from '../src/menu.ts'

/** A registry the spec presses commands through, standing in for the client service. */
function registry(): { register: Register; press: (command: string) => void; ids: () => string[] } {
  const handlers = new Map<string, () => void>()
  return {
    register: (command, handler) => {
      if (handlers.has(command)) throw new Error(`${command} already handled`)
      handlers.set(command, handler)
      return () => { handlers.delete(command) }
    },
    press: (command) => {
      const handler = handlers.get(command)
      if (handler === undefined) throw new Error(`${command} is not registered`)
      handler()
    },
    ids: () => [...handlers.keys()],
  }
}

/** Services, all absent unless a case supplies one. */
function services(overrides: Partial<CommandServices> = {}): CommandServices {
  return {
    layout: () => undefined,
    sessions: () => undefined,
    workspaces: () => undefined,
    modes: () => undefined,
    uiWorkspace: () => undefined,
    slots: () => undefined,
    locale: () => undefined,
    ...overrides,
  }
}

/** A session list snapshot carrying one current conversation. */
function sessionsWith(current: string | undefined, extra: Record<string, unknown> = {}): never {
  return { list: { getSnapshot: () => ({ current }) }, ...extra } as never
}

let report: Report & ReturnType<typeof vi.fn>

beforeEach(() => {
  report = vi.fn() as Report & ReturnType<typeof vi.fn>
  document.body.innerHTML = ''
})

afterEach(() => { vi.restoreAllMocks() })

describe('what it registers', () => {
  it('registers every command with no other owner, and none that has one', () => {
    const bench = registry()
    installBuiltins(bench.register, services(), report)
    const registered = new Set(bench.ids())
    for (const id of [
      UI_COMMANDS.newSession, UI_COMMANDS.forkSession, UI_COMMANDS.archiveSession,
      UI_COMMANDS.addWorkspace, UI_COMMANDS.search, UI_COMMANDS.toggleSidebar,
      UI_COMMANDS.toggleDetails, UI_COMMANDS.settings, UI_COMMANDS.settingsPlugins,
      UI_COMMANDS.modeChat, UI_COMMANDS.modeWork, UI_COMMANDS.modeCode,
    ]) expect(registered.has(id)).toBe(true)
    // The four whose behaviour belongs to a plugin that can register for
    // itself. Taking them here would be this package claiming a behaviour it
    // does not own, and would beat the owner to the id.
    for (const id of [UI_COMMANDS.filePanel, UI_COMMANDS.terminal, UI_COMMANDS.sideChat, UI_COMMANDS.remdevConnect]) {
      expect(registered.has(id)).toBe(false)
    }
  })

  it('leaves an id that already has an owner to it, and keeps registering the rest', () => {
    const bench = registry()
    bench.register(UI_COMMANDS.newSession, () => {})
    installBuiltins(bench.register, services(), report)
    expect(bench.ids()).toContain(UI_COMMANDS.toggleSidebar)
    expect(report).toHaveBeenCalledWith(expect.stringContaining('leaving it to its owner'))
  })

  it('takes every registration back on dispose', () => {
    const bench = registry()
    installBuiltins(bench.register, services(), report)()
    expect(bench.ids()).toEqual([])
  })
})

describe('a service that is not there', () => {
  it('reports and does nothing, rather than throwing out of the key listener', () => {
    const bench = registry()
    installBuiltins(bench.register, services(), report)
    for (const id of [UI_COMMANDS.newSession, UI_COMMANDS.toggleSidebar, UI_COMMANDS.toggleDetails]) {
      expect(() => { bench.press(id) }).not.toThrow()
    }
    expect(report).toHaveBeenCalledTimes(3)
  })

  it('presses a mode segment with no registry at all without complaint', () => {
    const bench = registry()
    installBuiltins(bench.register, services(), report)
    // Deliberately silent: a composition without Chat mode has no Code segment
    // to enter, and saying so on every press would be noise about a
    // composition choice rather than a fault.
    expect(() => { bench.press(UI_COMMANDS.modeCode) }).not.toThrow()
    expect(report).not.toHaveBeenCalled()
  })
})

describe('new session', () => {
  it('offers the request to the posture holding the column first', () => {
    const startSession = vi.fn()
    const requestNewSession = vi.fn(() => true)
    const bench = registry()
    installBuiltins(bench.register, services({
      modes: () => ({ enter: vi.fn(), requestNewSession }),
      workspaces: () => ({ startSession } as never),
    }), report)
    bench.press(UI_COMMANDS.newSession)
    expect(requestNewSession).toHaveBeenCalled()
    // Code mode started its own terminal; the frame must not also take the
    // column with a web conversation.
    expect(startSession).not.toHaveBeenCalled()
  })

  it('falls back to the frame when the active posture declines', () => {
    const startSession = vi.fn()
    const bench = registry()
    installBuiltins(bench.register, services({
      modes: () => ({ enter: vi.fn(), requestNewSession: () => false }),
      workspaces: () => ({ startSession } as never),
    }), report)
    bench.press(UI_COMMANDS.newSession)
    expect(startSession).toHaveBeenCalled()
  })
})

describe('the session commands', () => {
  it('opens the child a fork produced, not the source', async () => {
    const open = vi.fn()
    const fork = vi.fn(async () => 'child')
    const bench = registry()
    installBuiltins(bench.register, services({
      sessions: () => sessionsWith('parent', { open, fork }),
    }), report)
    bench.press(UI_COMMANDS.forkSession)
    await vi.waitFor(() => { expect(open).toHaveBeenCalledWith('child') })
    expect(fork).toHaveBeenCalledWith({ sessionId: 'parent' })
  })

  it('declines to archive in the no-session state', () => {
    const archiveSession = vi.fn()
    const bench = registry()
    installBuiltins(bench.register, services({
      sessions: () => sessionsWith(undefined),
      workspaces: () => ({ archiveSession } as never),
    }), report)
    bench.press(UI_COMMANDS.archiveSession)
    expect(archiveSession).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledWith(expect.stringContaining('no current conversation'))
  })

  it('treats a cancelled directory picker as a cancellation, not a failure', async () => {
    const create = vi.fn()
    const bench = registry()
    installBuiltins(bench.register, services({
      workspaces: () => ({ pickDirectory: async () => null, create } as never),
    }), report)
    bench.press(UI_COMMANDS.addWorkspace)
    await vi.waitFor(() => { expect(report).not.toHaveBeenCalled() })
    expect(create).not.toHaveBeenCalled()
  })
})

describe('the details column', () => {
  /**
   * Render the frame's own state attributes.
   * @param attributes - the collapse flags to set.
   */
  const frame = (attributes: string): void => {
    document.body.innerHTML = `<div ${attributes}></div>`
  }

  it('opens a closed column and closes an open one, reading the frame not a stored bit', () => {
    const openDetails = vi.fn()
    const closeDetails = vi.fn()
    const bench = registry()
    installBuiltins(bench.register, services({
      layout: () => ({ toggleSidebar: vi.fn(), openDetails, closeDetails }),
    }), report)

    frame('data-details-collapsed')
    expect(detailsCollapsed()).toBe(true)
    bench.press(UI_COMMANDS.toggleDetails)
    expect(openDetails).toHaveBeenCalledTimes(1)

    frame('')
    expect(detailsCollapsed()).toBe(false)
    bench.press(UI_COMMANDS.toggleDetails)
    expect(closeDetails).toHaveBeenCalledTimes(1)
  })
})

describe('search', () => {
  it('unfolds a railed sidebar before putting the caret in the field', async () => {
    document.body.innerHTML = `
      <div data-sidebar-collapsed>
        <div data-slot="sidebar.workspaces">
          <button aria-expanded="false" id="toggle"></button>
        </div>
      </div>`
    const frame = document.querySelector('[data-sidebar-collapsed]') as HTMLElement
    const clicked = vi.fn()
    document.querySelector('#toggle')?.addEventListener('click', clicked)
    const bench = registry()
    installBuiltins(bench.register, services({
      // The real service flips the frame's attribute; the fake does the same,
      // because the wait is on that attribute and nothing else.
      layout: () => ({
        toggleSidebar: () => { frame.removeAttribute('data-sidebar-collapsed') },
        openDetails: vi.fn(),
        closeDetails: vi.fn(),
      }),
    }), report)

    expect(sidebarCollapsed()).toBe(true)
    bench.press(UI_COMMANDS.search)
    await vi.waitFor(() => { expect(clicked).toHaveBeenCalled() })
    expect(sidebarCollapsed()).toBe(false)
  })

  it('reports a surface with no browsing region instead of pressing something else', async () => {
    document.body.innerHTML = '<div><button aria-expanded="false"></button></div>'
    const bench = registry()
    installBuiltins(bench.register, services(), report)
    bench.press(UI_COMMANDS.search)
    await vi.waitFor(() => {
      expect(report).toHaveBeenCalledWith(expect.stringContaining('no session search'))
    })
  })
})

describe('the settings dialog', () => {
  /** The trigger as the harness renders it: the slot outlet INSIDE the button. */
  const trigger = (): HTMLElement => {
    document.body.innerHTML = `
      <button id="trigger" aria-haspopup="dialog" aria-expanded="false">
        <div data-slot="settings.trigger"></div>
      </button>`
    return document.querySelector('#trigger') as HTMLElement
  }

  /** The dialog and its nav rail, in registration order. */
  const openDialog = (pages: string[]): void => {
    const buttons = pages.map(label => `<button>${label}</button>`).join('')
    document.body.insertAdjacentHTML('beforeend',
      `<div role="dialog" aria-modal="true"><nav>${buttons}</nav></div>`)
  }

  it('finds the trigger by walking up from its slot outlet', () => {
    const button = trigger()
    expect(buttonAroundSlot('settings.trigger')).toBe(button)
  })

  it('presses the trigger once, and not again while the dialog is up', async () => {
    const button = trigger()
    const clicked = vi.fn(() => { openDialog(['General']) })
    button.addEventListener('click', clicked)
    const bench = registry()
    installBuiltins(bench.register, services(), report)

    bench.press(UI_COMMANDS.settings)
    await vi.waitFor(() => { expect(settingsDialog()).toBeDefined() })
    bench.press(UI_COMMANDS.settings)
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('selects the plugins page by the position its id holds in the slot ledger', async () => {
    const button = trigger()
    button.addEventListener('click', () => { openDialog(['General', 'Models', 'Plugins']) })
    // Deliberately out of order and with a gap in `order`: the rail sorts, and
    // so must the lookup, or the wrong page is pressed.
    const slots: SlotEntries = {
      entries: () => [
        { options: { id: PLUGINS_SECTION_ID, order: 15 } },
        { options: { id: 'general', order: 0 } },
        { options: { id: 'models', order: 10 } },
      ],
    }
    expect(settingsPageIndex(slots, PLUGINS_SECTION_ID)).toBe(2)

    const bench = registry()
    installBuiltins(bench.register, services({ slots: () => slots }), report)
    let picked: string | undefined
    bench.press(UI_COMMANDS.settingsPlugins)
    await vi.waitFor(() => {
      const pages = settingsPages()
      expect(pages).toHaveLength(3)
      pages[2]?.addEventListener('click', () => { picked = pages[2]?.textContent ?? undefined })
    })
    // Pressed again now that the listener is attached; the first press already
    // opened the dialog, so this one only selects.
    bench.press(UI_COMMANDS.settingsPlugins)
    await vi.waitFor(() => { expect(picked).toBe('Plugins') })
  })

  it('leaves the dialog on its last page when nothing registered a plugins section', async () => {
    const button = trigger()
    button.addEventListener('click', () => { openDialog(['General']) })
    const bench = registry()
    installBuiltins(bench.register, services({
      slots: () => ({ entries: () => [{ options: { id: 'general', order: 0 } }] }),
    }), report)
    bench.press(UI_COMMANDS.settingsPlugins)
    await vi.waitFor(() => {
      expect(report).toHaveBeenCalledWith(expect.stringContaining('no plugins settings page'))
    })
    expect(settingsDialog()).toBeDefined()
  })
})

describe('the Plugin hub tab', () => {
  /** Which tabs the press pressed, recorded as each strip renders. */
  let pressed: string[]

  beforeEach(() => { pressed = [] })

  /** The trigger, the dialog and its rail, all in one — the state before a press. */
  const shell = (): void => {
    document.body.innerHTML = `
      <button id="trigger" aria-haspopup="dialog" aria-expanded="false">
        <div data-slot="settings.trigger"></div>
      </button>
      <div role="dialog" aria-modal="true">
        <nav><button>General</button><button>Models</button><button>Plugins</button></nav>
      </div>`
  }

  /**
   * The Plugins page's tab strip, as the section composes it.
   *
   * The element id is `useId()` + `-tab-` + the registration id, and the
   * `useId()` half is React's own opaque token — the guillemets are what React
   * 19 emits — so the spec writes one a lookup must not depend on the shape of.
   * @param ids - the tab ids, in the order the strip renders them.
   * @param active - the tab showing, the first by default.
   */
  const renderTabs = (ids: string[], active = ids[0]): void => {
    const buttons = ids.map(id => `
      <button role="tab" id="«r3»-tab-${id}" aria-controls="«r3»-panel-${id}"
        aria-selected="${String(id === active)}"></button>`).join('')
    const dialog = settingsDialog() as HTMLElement
    dialog.insertAdjacentHTML('beforeend', `<div role="tablist">${buttons}</div>`)
    // Attached as the strip is built, not after the press: the handler clicks
    // the tab the moment it appears, so a listener added later would miss it.
    for (const id of ids) {
      settingsTab(id)?.addEventListener('click', () => { pressed.push(id) })
    }
  }

  /**
   * A ledger answering both slots the press reads.
   * @param tabs - the ids registered in the Plugins tab seat.
   * @returns the registry face.
   */
  const ledger = (tabs: string[]): SlotEntries => ({
    entries: (key: string) => (key === PLUGINS_TAB_SLOT
      ? tabs.map((id, index) => ({ options: { id, order: index * 10 } }))
      : [
        { options: { id: 'general', order: 0 } },
        { options: { id: 'models', order: 10 } },
        { options: { id: PLUGINS_SECTION_ID, order: 15 } },
      ]),
  })

  it('finishes on the hub rather than the tab the page opened on', async () => {
    shell()
    // The strip belongs to the Plugins page, so it appears when that page is
    // the one showing — which is the wait the press has to make.
    settingsPages()[2]?.addEventListener('click', () => {
      renderTabs(['configurable', 'all', PLUGIN_HUB_TAB_ID])
    })
    const bench = registry()
    installBuiltins(bench.register, services({
      slots: () => ledger(['configurable', 'all', PLUGIN_HUB_TAB_ID]),
    }), report)

    bench.press(UI_COMMANDS.settingsPlugins)
    await vi.waitFor(() => { expect(pressed).toEqual([PLUGIN_HUB_TAB_ID]) })
    expect(report).not.toHaveBeenCalled()
  })

  it('stops at the Plugins page, silently, in a composition with no hub', async () => {
    shell()
    settingsPages()[2]?.addEventListener('click', () => { renderTabs(['configurable', 'all']) })
    const bench = registry()
    installBuiltins(bench.register, services({ slots: () => ledger(['configurable', 'all']) }), report)

    bench.press(UI_COMMANDS.settingsPlugins)
    await vi.waitFor(() => { expect(document.querySelector('[role="tablist"]')).not.toBeNull() })
    expect(pressed).toEqual([])
    // A Plugins page without the hub is a composition choice, not a fault, and
    // a warning on every press would say otherwise.
    expect(report).not.toHaveBeenCalled()
  })

  it('leaves a hub tab that is already showing alone', async () => {
    shell()
    renderTabs(['configurable', 'all', PLUGIN_HUB_TAB_ID], PLUGIN_HUB_TAB_ID)
    const bench = registry()
    installBuiltins(bench.register, services({
      slots: () => ledger(['configurable', 'all', PLUGIN_HUB_TAB_ID]),
    }), report)

    bench.press(UI_COMMANDS.settingsPlugins)
    await vi.waitFor(() => { expect(settingsTab(PLUGIN_HUB_TAB_ID)).toBeDefined() })
    // Pressing the selected tab would pull focus out of whatever the person is
    // editing in the hub, and select nothing that was not already selected.
    expect(pressed).toEqual([])
  })

  it('says so when the hub is registered and its tab never renders', async () => {
    shell()
    const bench = registry()
    installBuiltins(bench.register, services({
      slots: () => ledger(['configurable', 'all', PLUGIN_HUB_TAB_ID]),
    }), report)

    bench.press(UI_COMMANDS.settingsPlugins)
    await vi.waitFor(
      () => { expect(report).toHaveBeenCalledWith(expect.stringContaining('never rendered')) },
      { timeout: 4000 },
    )
  })
})
