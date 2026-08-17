/**
 * The binding document this plugin publishes, and the vocabulary it is written
 * in.
 *
 * A Cordis plugin runs inside the harness runtime, which has no window, no
 * menu bar, and no way to reach either: only the Electron main process can
 * build a native menu or claim an application chord, and only a browser can
 * hear a keystroke that lands in a page. So the work splits three ways. The
 * shell owns a fixed set of native capabilities it knows how to perform; the
 * runtime performs the commands it registered for itself; and a browser client
 * performs the ones that only mean something where the UI is. This document
 * decides which of them appear, where they sit, what they are called, and which
 * chord answers to them.
 *
 * That split is what makes the bindings hot-pluggable. Mounting this plugin
 * makes a menu appear, unmounting it takes the menu away, and editing its
 * config rebuilds it in place, none of which the shell is rebuilt or restarted
 * for.
 *
 * ## Two surfaces, one document
 *
 * The same document serves a desktop window and a browser tab at once —
 * `open-in-browser` literally produces that pair — and the two do not hear
 * keystrokes the same way. The desktop claims a chord natively, before the page
 * exists; a browser tab can only listen inside the page, and the browser keeps
 * a handful of chords for itself no matter what the page asks for. So an item
 * carries a native chord and, when the two must differ, a web one: see
 * {@link MenuItem.accelerator} and {@link MenuItem.webAccelerator}.
 * @module @omdsh-plugins/omdsh-shortcuts/contract
 */

/**
 * Wire version; the shell refuses a document it does not speak.
 *
 * Still 1 after the browser half arrived, deliberately. Everything added for it
 * is either an optional field an older shell ignores or a command kind an older
 * shell drops one item over — both of which leave the rest of the menu
 * standing, which is a better outcome than blanking a menu bar because one
 * entry is from the future.
 */
export const MENU_CONTRACT_VERSION = 1

/** Route the document is served from. */
export const MENU_PATH = '/api/desktop/menu'

/** Route a `runtime` or `browser` command is posted back to. */
export const MENU_INVOKE_PATH = '/api/desktop/menu.invoke'

/**
 * Server-sent event stream carrying the document and its later revisions.
 *
 * A plain route rather than a socket upgrade: the traffic is one small
 * document at a time in one direction, and an `EventSource`-shaped stream is
 * something the shell can read with `fetch` alone. The stream ending is itself
 * the signal that this plugin is gone.
 *
 * This one is the SHELL's. Its payload is a bare {@link MenuDocument}, which is
 * what every shipped desktop build already parses, so it stays exactly that
 * shape forever — the browser clients get {@link CLIENT_EVENTS_PATH} instead,
 * where the payloads are framed and may grow.
 */
export const MENU_EVENTS_PATH = '/api/desktop/menu.events'

/**
 * Server-sent event stream a browser client subscribes to.
 *
 * Separate from {@link MENU_EVENTS_PATH} because the two carry different
 * things: the shell wants a document and nothing else, while a client wants the
 * document AND the invocations that reach it from a native menu it cannot see.
 * Framing the shell's stream to fit both would blank the menu bar of every
 * desktop build already installed, since those parse each payload as a document
 * and read anything else as an empty one.
 *
 * The client names itself with the {@link CLIENT_PARAM} query parameter, which
 * is how a later {@link ClientInvoke} reaches one tab and not all of them.
 */
export const CLIENT_EVENTS_PATH = '/api/desktop/shortcut.events'

/**
 * Route a browser client reports its focus to.
 *
 * Focus is how an invocation finds its window, and it is reported rather than
 * discovered because nothing else can discover it. The desktop shell knows
 * which `BrowserWindow` owns the menu that was just pressed, but its windows
 * carry no preload and stay sandboxed by design, so it has no channel to tell
 * the page inside; and the runtime sees HTTP requests, which say nothing about
 * which tab the person is looking at. The page itself is the only party that
 * knows, so the page says so.
 */
export const CLIENT_FOCUS_PATH = '/api/desktop/shortcut.focus'

/** Query parameter naming the subscribing client on {@link CLIENT_EVENTS_PATH}. */
export const CLIENT_PARAM = 'client'

/**
 * The native capabilities a shell offers.
 *
 * Every one of them needs the main process, which is why they are named rather
 * than implemented here. A shell that does not recognize a name drops the item
 * instead of rendering something that would do nothing when pressed.
 *
 * This list is the one part of the contract a plugin cannot grow: adding a
 * capability means teaching an Electron build to perform it, and that build
 * ships separately. Anything a person can bind at will is a `runtime` or
 * `browser` command instead.
 */
export const SHELL_COMMANDS = [
  /** Open one more window on the running runtime, showing a session of its own. */
  'new-window',
  /** Stop and start the runtime process. */
  'restart-runtime',
  /** Reveal the runtime log file. */
  'reveal-log',
  /** Open the running UI in the user's browser. */
  'open-in-browser',
  /** Turn idle memory release on or off; rendered as a checkbox. */
  'toggle-idle-suspend',
] as const

/** One native capability. */
export type ShellCommand = (typeof SHELL_COMMANDS)[number]

/** The top-level menus an item may join. */
export const MENU_SECTIONS = ['app', 'file', 'view', 'window', 'help'] as const

/** Which top-level menu an item joins. */
export type MenuSection = (typeof MENU_SECTIONS)[number]

/**
 * What pressing one item does.
 *
 * The kind is not a label on the action, it is the address of whoever performs
 * it, and the three are genuinely different places: a process with a menu bar,
 * a process with a filesystem, and a page with a DOM.
 */
export type MenuCommand =
  /** The shell performs it natively. */
  | { kind: 'shell'; name: ShellCommand }
  /** The runtime performs it; a plugin registered a handler under the item's id. */
  | { kind: 'runtime' }
  /**
   * A browser client performs it; something in the UI registered a handler
   * under the item's id.
   *
   * On the web surface this never crosses the wire at all — the page hears its
   * own keystroke and runs its own handler. The kind matters on the desktop,
   * where the chord is claimed natively and the press has to travel: shell to
   * runtime over {@link MENU_INVOKE_PATH}, runtime to page over
   * {@link CLIENT_EVENTS_PATH}.
   */
  | { kind: 'browser' }

/** One binding: a command, what it reads as, and the chords that reach it. */
export interface MenuItem {
  /** Stable identity, unique across the document; what an invocation names. */
  id: string
  /** What the item reads as. */
  label: string
  /** Which top-level menu it joins. */
  section: MenuSection
  /** What pressing it does. */
  command: MenuCommand
  /**
   * Electron accelerator, when the item claims a chord.
   *
   * The native binding, and the default for both surfaces. A shell hands it to
   * Electron; a browser tab binds it in the page unless
   * {@link MenuItem.webAccelerator} says otherwise.
   */
  accelerator?: string
  /**
   * The chord a browser tab binds instead, when the native one will not do.
   *
   * Absent means "the same one": most chords work on both surfaces and saying
   * so twice would be a second place to forget. A string is a different chord
   * for the web surface only. `null` binds nothing there — the item is still on
   * the menu and still reachable by mouse, it simply has no key in a tab.
   *
   * This field exists because the two surfaces are not configurable variants of
   * one mechanism, they are two mechanisms. Electron claims a chord before the
   * page loads and can hold ones a page will never be offered; a tab can only
   * listen from inside the page, and a browser keeps ⌘N, ⌘T, ⌘W and ⌘Q for
   * itself whatever the page asks. `CmdOrCtrl+N` is the honest example: a
   * perfectly good native binding for `new-window`, and a key a tab is never
   * handed.
   */
  webAccelerator?: string | null
  /** Render as a checkbox whose state the shell owns. */
  checkbox?: boolean
  /**
   * A CSS selector for the control this command's chord should be taught on.
   *
   * Someone who found a feature with the mouse should be able to stop using the
   * mouse for it, so the button that performs a command names its chord when it
   * is hovered. Most buttons need nothing here: a plugin's own control teaches
   * its chord from inside the plugin (`chordLabel`), and the harness's own
   * controls are recognized by the browser half's shipped table. This field is
   * for the third case — a command a COMPOSITION added, pointing at a button
   * neither of those knows about.
   *
   * Ignored by the shell, which renders a menu and has no buttons to hover, and
   * ignored on any surface where nothing matches it.
   */
  anchor?: string
}

/** Everything one shell needs to build its menu. */
export interface MenuDocument {
  /** {@link MENU_CONTRACT_VERSION}. */
  version: number
  /** The items, in the order each section renders them. */
  items: MenuItem[]
}

/** What the shell posts to run a `runtime` or `browser` command. */
export interface MenuInvocation {
  /** The item's {@link MenuItem.id}. */
  id: string
}

/**
 * The document, as a client is told it.
 *
 * Sent when the stream opens and again whenever the document changes, so a
 * client that connects late is in the same state as one that was there all
 * along, and neither has a separate read to make.
 */
export interface ClientBindings {
  kind: 'bindings'
  /** The current document; an empty one means this plugin is going away. */
  document: MenuDocument
  /**
   * Whether a page should teach its chords on the buttons that perform them.
   *
   * Carried here rather than on the document because the document is the
   * SHELL's — it stays the shape every installed desktop build already parses —
   * and a native menu has no tooltips to write into. Absent means on: a page
   * served by a runtime older than this field asks for the behaviour the
   * setting defaults to.
   */
  hints?: boolean
}

/**
 * One command, handed to the client that should perform it.
 *
 * Only the desktop surface produces these. On the web the page heard the
 * keystroke itself and never asked anybody.
 */
export interface ClientInvoke {
  kind: 'invoke'
  /** The item's {@link MenuItem.id}. */
  command: string
}

/** Everything {@link CLIENT_EVENTS_PATH} carries. */
export type ClientEvent = ClientBindings | ClientInvoke

/** What a client posts to {@link CLIENT_FOCUS_PATH} when it takes focus. */
export interface FocusReport {
  /** The id the client subscribed under; an unknown one is ignored. */
  client: string
}
