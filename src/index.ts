/**
 * `@omdsh-plugins/omdsh-shortcuts` — the binding table, contributed from inside
 * the harness runtime, and the switchboard that gets a press to whoever can
 * perform it.
 *
 * The shell installs no menu of its own. It asks the runtime what its menu
 * should be, and this plugin answers: routes on the webserver, one to read the
 * document, one to push it as it changes, and one the shell posts back to when
 * an item it does not own is pressed.
 *
 * ## Why this half is a switchboard and not a menu
 *
 * A press starts where the keyboard is and has to end where the command lives,
 * and those are three different places:
 *
 * - **shell** commands never arrive here at all. Electron performs them.
 * - **runtime** commands stop here. A host plugin registered a handler under
 *   the item's id through {@link IShortcut.register}, and this is where it runs.
 * - **browser** commands are only passing through. Nothing in a Node process
 *   can open a panel, so the press is handed on to a client over
 *   {@link CLIENT_EVENTS_PATH}.
 *
 * That last hop is the whole reason this file grew. On the web surface it is
 * not needed — the page hears its own keystroke and runs its own handler,
 * without asking anybody — but on the desktop the chord is claimed natively,
 * before the page exists, so the press travels the long way round: Electron to
 * this runtime over HTTP, this runtime to the page over a stream. The
 * alternative was an Electron preload bridge, and `omdsh-desktop` keeps its
 * windows sandboxed with no preload on purpose.
 *
 * ## Which client
 *
 * There is rarely only one. A desktop install can open several windows, a
 * browser several tabs, and `open-in-browser` produces both at once against
 * this same runtime. A press means the surface the person is looking at, so
 * this half routes to the client that most recently reported focus. Focus is
 * reported rather than deduced because no other party can see it: the shell
 * knows which window owns the menu but has no channel into its sandboxed page,
 * and an HTTP request says nothing about where the user's eyes are.
 *
 * ## Reach
 *
 * The invoke route has no trust fence, and this is the release where that
 * starts to mean something: it used to answer 404 to everything, and now it
 * runs handlers. Two things bound it. Only ids the published document declares
 * are accepted, so the document is the allowlist; and only handlers a mounted
 * plugin registered can run, so the set is whatever this runtime composed. What
 * it does NOT bound is who may post — the route is exactly as reachable as the
 * webserver's bind address. On the desktop that is loopback. On a `dsh web`
 * bound wider it is not, and a plugin registering something destructive under
 * {@link IShortcut.register} should know that. The seam if a fence is wanted
 * later is `webRuntime`, the way `omdsh-sidepanel` reads it.
 *
 * Every route is registered through `ctx.effect`, so unmounting the plugin
 * removes them. The shell reads that as "there is no menu" and drops back to
 * the platform's own — which is what makes the menu hot-pluggable rather than
 * something a rebuild delivers.
 * @module @omdsh-plugins/omdsh-shortcuts
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import Schema from '@deepseek-ai/schemastery'
import {
  CLIENT_EVENTS_PATH,
  CLIENT_FOCUS_PATH,
  CLIENT_PARAM,
  MENU_EVENTS_PATH,
  MENU_INVOKE_PATH,
  MENU_PATH,
  type ClientEvent,
  type MenuDocument,
  type MenuItem,
} from './contract.ts'
import { applyBindings, effectiveBindings, invalidBindings } from './bindings.ts'
import {
  buildMenuDocument,
  DEFAULT_ITEMS,
  duplicateAccelerators,
  duplicateIds,
  duplicateWebChords,
  unbindableWebChords,
} from './menu.ts'

export * from './contract.ts'
export {
  claimFor, isReservedByBrowser, keyFromCode, normalizeKey, parseAccelerator, webAcceleratorFor,
  BROWSER_RESERVED_KEYS,
  type Chord, type ChordClaim, type Surface,
} from './chord.ts'
export {
  applyBindings, effectiveBindings, invalidBindings, UNBIND, type InvalidBinding,
} from './bindings.ts'
export { formatAccelerator, isMacPlatform } from './label.ts'
export {
  SHELL_ACCELERATORS, UI_ACCELERATORS, WEB_ACCELERATORS, UI_COMMANDS,
  DEFAULT_ITEMS, buildMenuDocument, duplicateAccelerators, duplicateIds,
  duplicateWebChords, unbindableWebChords, type UnbindableWebChord,
} from './menu.ts'

/** Stable Cordis plugin name. */
export const name = 'omdsh-shortcuts'

/** The route registry this plugin publishes through. */
export const inject = ['webServer']

/** Service name this plugin publishes its switchboard under. */
export const SHORTCUT_SERVICE = 'shortcut'

/**
 * The settings namespace this plugin owns.
 *
 * The omdsh convention: one namespace per plugin, named for its unscoped
 * package name, registered with the schema below. That is the whole of what
 * `omdsh-plughub` needs to render this plugin a configuration page — no code
 * of this plugin's runs in that panel, and no code of that panel's knows
 * anything about chords.
 */
export const SETTINGS_NAMESPACE = 'omdsh-shortcuts'

/** What one shell socket needs to be pushed a document. */
interface Subscriber {
  /** Send one document; failures are the socket's own to report by closing. */
  send: (document: MenuDocument) => void
}

/** What one browser client needs to be reached. */
interface ClientSubscriber {
  /** The id it subscribed under. */
  id: string
  /**
   * When it last held focus, on a counter rather than a clock.
   *
   * A counter because the only question ever asked of it is "which of these is
   * most recent", and a counter answers that without a clock's ways of being
   * wrong.
   */
  focusedAt: number
  /** Send one event. */
  send: (event: ClientEvent) => void
  /** End the stream. */
  end: () => void
}

/** The shape of the service this plugin reaches, as much of it as it uses. */
export interface WebServerLike {
  /**
   * Register an exact-path HTTP route.
   * @param route - the path and its handler.
   * @returns the disposer removing it.
   */
  register: (route: {
    kind: 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }) => () => void
}

/**
 * The plugin context, as much of it as this plugin uses.
 *
 * Structural rather than imported, and notably NOT a `declare module` on
 * cordis's `Context`. The browser half of this same package publishes a
 * `shortcut` service of its own with a different face, and a package compiled
 * outside the harness typechecks both halves as ONE program — two declarations
 * of one `Context` key, where `skipLibCheck` quietly picks whichever the
 * compiler saw first. The augmentation therefore belongs to the half whose
 * consumers are written against an ambient `ctx.shortcut`, which is the browser
 * one; a host plugin resolves this service by name instead.
 */
export interface ShortcutContext {
  webServer: WebServerLike
  /**
   * Hold a disposable for as long as the plugin is mounted.
   * @param setup - produces the disposer.
   * @param label - what the effect owns, for diagnostics.
   */
  effect: (setup: () => () => void, label?: string) => void
  /**
   * Run `callback` while every named service is available.
   *
   * How the settings registration stays OPTIONAL: it rides a scoped fiber, so
   * a composition with no settings provider — a headless run, a bench —
   * simply never enters the callback and this plugin serves its composition
   * config, exactly as it did before it was configurable.
   * @param deps - service names.
   * @param callback - receives a context scoped to their availability.
   */
  inject?: (deps: string[], callback: (ctx: ShortcutContext) => void) => void
  /**
   * Resolve one service by name — never off an ambient `Context`, for the
   * reason this whole interface is structural: a package compiled outside the
   * harness merges its browser and host Context declarations into one program.
   * @param serviceName - the service name.
   * @returns the service, or undefined when nothing provides it.
   */
  get?: (serviceName: string) => unknown
  logger?: { warn: (...args: unknown[]) => void }
  /** Cordis's service registry, as much of it as this plugin uses. */
  reflect: {
    /**
     * Publish one service for as long as the returned disposer is unspent.
     * @param name - the service name.
     * @param value - the service.
     * @returns its removal, which may settle asynchronously.
     */
    provide: (name: string, value: unknown) => () => void | Promise<void>
  }
}

/** What became of one invocation. */
export type InvokeOutcome =
  /** A host handler performed it. */
  | { kind: 'ran'; command: string }
  /** It was handed to a browser client, which performs it on its own time. */
  | { kind: 'delivered'; command: string; client: string }
  /** The document declares no such command, or declares one the shell owns. */
  | { kind: 'unknown'; command: string }
  /**
   * The document declares it and nobody can perform it right now: no host
   * plugin registered a handler, or no browser client is connected.
   *
   * A composition fact rather than a fault in the request, which is why it is
   * distinct from `unknown`. The same press a moment later may well land.
   */
  | { kind: 'unhandled'; command: string }

/** The switchboard, published to the rest of the runtime. */
export interface IShortcut {
  /**
   * Perform one `runtime` command in this process.
   *
   * The id is the item's, so the binding and the behaviour are joined by the
   * document rather than by an import: whoever writes the config decides which
   * chord reaches this handler, and can change it without this plugin knowing.
   * @param command - the item's {@link MenuItem.id}.
   * @param handler - what the press runs; a rejection is reported, never thrown at the socket.
   * @returns the deregistration.
   * @throws when something is already registered under this command.
   */
  register: (command: string, handler: () => void | Promise<void>) => () => void
  /**
   * Press one command from here, by whatever path it needs.
   * @param command - the item's {@link MenuItem.id}.
   * @returns what became of it (see {@link InvokeOutcome}).
   */
  invoke: (command: string) => Promise<InvokeOutcome>
  /** The document currently published. */
  document: () => MenuDocument
  /** How many browser clients are listening. */
  clients: () => number
}

/**
 * How this plugin is configured.
 *
 * Two layers with different owners, and the split is the point:
 *
 * - `items` is COMPOSITION — which commands exist, what they read as, which
 *   menu they join, who performs them. It lives in a profile's patch file and
 *   is hidden from the settings form, because a five-field object with a
 *   discriminated union in it is not something a generated form can offer
 *   without producing controls that write the wrong shape.
 * - `bindings` is the PERSON — which key reaches which command. A flat map of
 *   strings, which is exactly what a generated form draws well.
 *
 * The schema is schemastery rather than an interface because that is what
 * makes it configurable at all: `settings.describe` serializes it onto the
 * wire, and the panel rehydrates the same validator to render and check
 * against. The descriptions are localized here, so no panel needs a dictionary
 * for this plugin's fields.
 */
/**
 * One field's title, in both languages.
 *
 * `omdsh-plughub` titles a control from `meta.extra.label` when a schema wrote
 * one and from the property name when it did not — and a property name is an
 * English identifier, which is how a form in Chinese ends up half translated.
 * A field that also carries a role declares the same map THROUGH the role:
 * `role(text, extra)` writes this slot too, and writes `undefined` into it when
 * called with one argument.
 * @param en - the English title.
 * @param zh - the Chinese title.
 * @returns the metadata payload the hub reads.
 */
function label(en: string, zh: string): { label: Record<string, string> } {
  return { label: { '': en, zh } }
}

export const Config: Schema<ShortcutConfig, Required<ShortcutConfig>> = Schema.object({
  items: Schema.array(Schema.any()).default([]).hidden()
    .description('The menu items this plugin publishes; the shipped set when empty.'),
  bindings: Schema.dict(Schema.string()).default({})
    .extra('extra', label('Key bindings', '快捷键绑定'))
    .description('Keyboard shortcut per command id, as an Electron accelerator (for example CmdOrCtrl+Shift+O). An empty value leaves the command on the menu with no key.'),
  hints: Schema.boolean().default(true)
    .extra('extra', label('Chords in tooltips', '悬浮提示里显示快捷键'))
    .description('Name each chord in the tooltip of the button that performs it, including the buttons the harness itself renders.'),
}).i18n({
  zh: {
    items: '本插件发布的菜单项；留空则使用内置的一组。',
    bindings: '每个命令 id 对应的快捷键，写作 Electron accelerator（例如 CmdOrCtrl+Shift+O）。留空表示该命令保留在菜单里但不绑定按键。',
    hints: '把每个快捷键写进执行该命令的按钮的悬浮提示里，harness 自带的按钮也算。',
  },
})

/** One namespace's owner handle, as much of `SettingsScope` as this plugin uses. */
interface SettingsScopeLike<T> {
  get: () => T
  watch: (callback: (next: T) => void) => () => void
}

/** The settings seam, structurally. */
interface SettingsLike {
  register: <T>(
    ns: string,
    schema: unknown,
    options?: { base?: Partial<T>; applies?: 'live' | 'restart'; validate?: (value: T) => void },
  ) => SettingsScopeLike<T>
}

/** How this plugin is configured, as the schema admits it. */
export interface ShortcutConfig {
  /** The items to publish; the defaults when absent or empty. */
  items?: MenuItem[]
  /** Per-command chord overrides, by item id; an empty value unbinds. */
  bindings?: Record<string, string>
  /**
   * Whether a page teaches each chord on the button that performs it.
   *
   * A page-only setting — the shell's menu writes its accelerators beside its
   * items whatever this says — so it travels on the client stream rather than
   * in the document. On when absent.
   */
  hints?: boolean
}

/**
 * Whether one configuration asks for chord hints.
 *
 * Absent is on: the schema's default is `true`, and a config assembled without
 * it — a test bench, a composition written before the field existed — means the
 * same thing as one that never turned it off.
 * @param config - the plugin's configuration.
 * @returns whether pages should teach their chords on the buttons.
 */
export function hintsFor(config: ShortcutConfig): boolean {
  return config.hints ?? true
}

/**
 * Answer one JSON request.
 * @param res - the response to write.
 * @param status - the HTTP status.
 * @param body - the value to serialize.
 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/**
 * Read one request body, bounded so a runaway upload cannot hold memory.
 * @param req - the request to drain.
 * @param limit - the largest body accepted, in bytes.
 * @returns the body, or `undefined` when it exceeded the limit.
 */
export async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string | undefined> {
  let body = ''
  for await (const chunk of req) {
    body += String(chunk)
    if (body.length > limit) return undefined
  }
  return body
}

/**
 * Read one query parameter off a request.
 * @param req - the request.
 * @param key - the parameter name.
 * @returns the value, or undefined when it is absent or empty.
 */
export function queryParam(req: IncomingMessage, key: string): string | undefined {
  // The base is a placeholder: `req.url` on a server is origin-relative, and
  // `URL` needs one to parse against. Nothing reads the host back.
  const value = new URL(req.url ?? '/', 'http://shortcut.invalid').searchParams.get(key)
  return value === null || value === '' ? undefined : value
}

/**
 * The items one configuration publishes, before any override is laid over them.
 *
 * A composition that names no items — or names an empty list, which is what an
 * absent settings section resolves to through the schema default — gets the
 * shipped set.
 * @param config - the plugin's configuration.
 * @returns the composed items, or the defaults.
 */
export function itemsFor(config: ShortcutConfig): readonly MenuItem[] {
  return config.items === undefined || config.items.length === 0 ? DEFAULT_ITEMS : config.items
}

/**
 * The document this plugin serves, with the faults that make one unusable
 * reported rather than served.
 * @param config - the plugin's configuration.
 * @returns the document.
 */
export function documentFor(config: ShortcutConfig): MenuDocument {
  const [badBinding] = invalidBindings(config.bindings ?? {})
  if (badBinding !== undefined) {
    throw new Error(`omdsh-shortcuts: ${badBinding.id} is bound to ${JSON.stringify(badBinding.accelerator)}, which is not an accelerator this package can read; leave it empty to bind no key.`)
  }
  const document = buildMenuDocument(applyBindings(itemsFor(config), config.bindings))
  const repeatedIds = duplicateIds(document)
  if (repeatedIds.length > 0) {
    throw new Error(`omdsh-shortcuts: two items share the id ${repeatedIds.join(', ')}; an invocation names an id, so it must be unique.`)
  }
  const chords = duplicateAccelerators(document)
  if (chords.size > 0) {
    const [chord, holders] = [...chords][0] as [string, string[]]
    throw new Error(`omdsh-shortcuts: ${holders.join(' and ')} both claim ${chord}; one chord answers to one item.`)
  }
  const webChords = duplicateWebChords(document)
  if (webChords.size > 0) {
    const [chord, holders] = [...webChords][0] as [string, string[]]
    throw new Error(`omdsh-shortcuts: ${holders.join(' and ')} both bind ${chord} in the page; one chord answers to one item.`)
  }
  const unbindable = unbindableWebChords(document)
  const [first] = unbindable
  if (first !== undefined) {
    throw new Error(first.reason === 'malformed'
      ? `omdsh-shortcuts: ${first.id} asks the page to bind ${first.accelerator}, which is not an accelerator this listener can read.`
      : `omdsh-shortcuts: ${first.id} asks the page to bind ${first.accelerator}, which the browser keeps for itself; a page is never handed that key, so the binding could only ever do nothing.`)
  }
  return document
}

/**
 * Serve the binding document, and get every press to whoever can perform it.
 * @param ctx - the plugin context carrying the webServer service.
 * @param config - the validated configuration.
 */
export function apply(ctx: ShortcutContext, config: ShortcutConfig = {}): void {
  // Mutable now, because a chord is a setting: the document is rebuilt when
  // the user changes one and pushed down the streams that are already open.
  // The routes below close over these bindings rather than over their values,
  // so a handler registered at mount serves the current document.
  let document = documentFor(config)
  let hints = hintsFor(config)
  let kinds = new Map(document.items.map(item => [item.id, item.command.kind]))
  const subscribers = new Set<Subscriber>()
  const clients = new Set<ClientSubscriber>()
  const handlers = new Map<string, () => void | Promise<void>>()
  let focusTick = 0

  /**
   * Adopt a new document and tell everyone listening.
   *
   * Both audiences get it, because both hold a stale copy otherwise: a shell
   * has already built a native menu from the old chords, and a page has
   * already bound the old keys. Handlers are untouched — a rebinding changes
   * which key reaches a command, never which code performs it.
   * @param next - the document to publish.
   * @param nextHints - whether pages should teach their chords on the buttons.
   */
  const republish = (next: MenuDocument, nextHints: boolean): void => {
    document = next
    hints = nextHints
    kinds = new Map(next.items.map(item => [item.id, item.command.kind]))
    // The shell gets the bare document it has always got. Hints are a page's
    // business — a native menu writes its accelerators beside its items and has
    // no tooltip to teach anything in — so they ride the client frame only.
    for (const subscriber of subscribers) subscriber.send(next)
    for (const client of clients) client.send({ kind: 'bindings', document: next, hints })
  }

  /** The client a press should reach: the one whose surface was last in front. */
  const focused = (): ClientSubscriber | undefined => {
    let best: ClientSubscriber | undefined
    for (const client of clients) {
      if (best === undefined || client.focusedAt >= best.focusedAt) best = client
    }
    return best
  }

  const invoke = async (command: string): Promise<InvokeOutcome> => {
    const kind = kinds.get(command)
    // A `shell` id posted back means the shell misread the document; saying so
    // is better than a silent 200 it would read as success.
    if (kind === undefined || kind === 'shell') return { kind: 'unknown', command }
    if (kind === 'runtime') {
      const handler = handlers.get(command)
      if (handler === undefined) return { kind: 'unhandled', command }
      // The handler's own failure is its own; it must not become a socket
      // error on a press that did reach the right place.
      await handler()
      return { kind: 'ran', command }
    }
    const client = focused()
    if (client === undefined) return { kind: 'unhandled', command }
    client.send({ kind: 'invoke', command })
    return { kind: 'delivered', command, client: client.id }
  }

  const service: IShortcut = {
    register: (command, handler) => {
      if (handlers.has(command)) {
        throw new Error(`omdsh-shortcuts: ${command} already has a handler; one command answers to one handler.`)
      }
      handlers.set(command, handler)
      return () => { handlers.delete(command) }
    },
    invoke,
    document: () => document,
    clients: () => clients.size,
  }

  ctx.effect(() => {
    const disposeService = ctx.reflect.provide(SHORTCUT_SERVICE, service)
    // provide()'s disposer may settle asynchronously; teardown is synchronous
    // fire-and-forget.
    return () => { void disposeService() }
  }, 'omdsh-shortcuts: switchboard service')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MENU_PATH,
    handler: (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'the menu document is read with GET' })
        return
      }
      sendJson(res, 200, document)
    },
  }), 'omdsh-shortcuts: menu document')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MENU_INVOKE_PATH,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'an invocation is posted' })
        return
      }
      const body = await readBody(req)
      if (body === undefined) {
        sendJson(res, 413, { error: 'the invocation body is too large' })
        return
      }
      let id: unknown
      try {
        id = (JSON.parse(body) as { id?: unknown }).id
      }
      catch {
        sendJson(res, 400, { error: 'the invocation is not JSON' })
        return
      }
      if (typeof id !== 'string') {
        sendJson(res, 400, { error: 'an invocation names an id' })
        return
      }
      let outcome: InvokeOutcome
      try {
        outcome = await invoke(id)
      }
      catch (error) {
        // A handler that threw performed nothing, but it DID exist and the
        // press did find it. Reporting that truthfully is worth more to
        // whoever reads the log than a 404 claiming there was no such command.
        sendJson(res, 500, { error: `${id} failed: ${error instanceof Error ? error.message : String(error)}` })
        return
      }
      switch (outcome.kind) {
        case 'unknown':
          sendJson(res, 404, { error: `no command named ${JSON.stringify(id)} that this runtime performs` })
          return
        case 'unhandled':
          // Declared, and nothing is home. Not the request's fault and not
          // permanent, so it is neither a 404 nor a 500.
          sendJson(res, 503, { error: `${id} has nothing registered to perform it right now` })
          return
        default:
          sendJson(res, 200, outcome)
      }
    },
  }), 'omdsh-shortcuts: menu invocations')

  // The document is static for a given configuration, so this route exists to
  // carry the transitions the shell cannot poll for: it publishes once on
  // connect, and the socket closing is how the shell learns the plugin left.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MENU_EVENTS_PATH,
    handler: (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'the event stream is read with GET' })
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const subscriber: Subscriber = {
        send: (next) => { res.write(`data: ${JSON.stringify(next)}\n\n`) },
      }
      subscribers.add(subscriber)
      subscriber.send(document)
      req.on('close', () => { subscribers.delete(subscriber) })
    },
  }), 'omdsh-shortcuts: menu event stream')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CLIENT_EVENTS_PATH,
    handler: (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'the event stream is read with GET' })
        return
      }
      const id = queryParam(req, CLIENT_PARAM)
      if (id === undefined) {
        // Without a name there is nothing to route to, and a stream that
        // receives the document but never an invocation is a subtler failure
        // than a refusal.
        sendJson(res, 400, { error: `a client names itself with the ${CLIENT_PARAM} parameter` })
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const client: ClientSubscriber = {
        id,
        // The newest connection is the front one until somebody says otherwise:
        // a tab that just opened is a tab somebody just opened.
        focusedAt: ++focusTick,
        send: (event) => { res.write(`data: ${JSON.stringify(event)}\n\n`) },
        end: () => { res.end() },
      }
      clients.add(client)
      client.send({ kind: 'bindings', document, hints })
      req.on('close', () => { clients.delete(client) })
    },
  }), 'omdsh-shortcuts: client event stream')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CLIENT_FOCUS_PATH,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'a focus report is posted' })
        return
      }
      const body = await readBody(req)
      if (body === undefined) {
        sendJson(res, 413, { error: 'the focus report is too large' })
        return
      }
      let id: unknown
      try {
        id = (JSON.parse(body) as { client?: unknown }).client
      }
      catch {
        sendJson(res, 400, { error: 'the focus report is not JSON' })
        return
      }
      for (const client of clients) {
        if (client.id === id) client.focusedAt = ++focusTick
      }
      // Deliberately not a 404 for an unknown client. A report races its own
      // stream — a reconnecting tab can report focus before its new
      // subscription lands — and the answer to a race is to let the next
      // report settle it, not to make the page handle an error it cannot act on.
      sendJson(res, 204, {})
    },
  }), 'omdsh-shortcuts: client focus reports')

  // The chords, as a settings namespace. This is the omdsh convention in
  // full: the composition entry becomes the `base` layer, the person's
  // overrides sit on top, and `omdsh-plughub` renders the form from the schema
  // alone. Nothing about a panel appears in this file, and nothing about
  // chords appears in that one.
  ctx.inject?.(['settings'], (sctx) => {
    const settings = sctx.get?.('settings') as SettingsLike | undefined
    if (settings === undefined) return
    const scope = settings.register<ShortcutConfig>(SETTINGS_NAMESPACE, Config, {
      // The base carries every command's EFFECTIVE chord, not just the ones
      // somebody already overrode. A form over a bare override map opens empty,
      // and an empty map reads as "this plugin binds nothing" to the person
      // looking at it — so the panel is seeded with a picture of the keyboard
      // instead of a picture of the diff, and changing a key is editing a row
      // that is already there rather than guessing an id and typing it in.
      //
      // Safe to lay over the items because it is DERIVED from them: applying
      // this map reproduces the accelerators it was read off, whichever items
      // the composition named.
      base: { ...config, bindings: effectiveBindings(itemsFor(config), config.bindings) },
      // A rebinding reaches every open shell and page over the streams
      // already there, so nothing here waits for a restart.
      applies: 'live',
      // Refuses the WRITE that would produce an unusable document, rather
      // than storing it and reporting the fault at the next mount. This is
      // the same set of checks `documentFor` runs, run one step earlier.
      validate: (value) => { documentFor(value) },
    })
    const adopt = (): void => {
      try {
        const next = scope.get()
        republish(documentFor(next), hintsFor(next))
      } catch (error) {
        // `validate` refuses the writes this plugin can see coming; a stored
        // section can still turn unusable underneath one (a profile edit
        // changing `items` out from under a stored override). Keeping the
        // last good document beats serving none.
        ctx.logger?.warn('omdsh-shortcuts: keeping the last good menu after an unusable settings section')
        ctx.logger?.warn(error)
      }
    }
    adopt()
    sctx.effect(() => scope.watch(() => { adopt() }), 'omdsh-shortcuts: settings adoption')
  })

  ctx.effect(() => () => {
    // Unmounting takes the bindings with it: every open stream is told the
    // document is empty, so the shell drops back to the platform's own menu and
    // the clients unbind their keys at once, rather than after a request that
    // has nothing left to answer it.
    const empty: MenuDocument = { version: document.version, items: [] }
    for (const subscriber of subscribers) subscriber.send(empty)
    subscribers.clear()
    for (const client of clients) {
      client.send({ kind: 'bindings', document: empty, hints })
      client.end()
    }
    clients.clear()
  }, 'omdsh-shortcuts: retract the bindings on unmount')
}
