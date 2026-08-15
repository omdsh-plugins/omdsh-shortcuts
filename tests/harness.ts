/**
 * The bench every host-half spec runs on: a webserver that records instead of
 * listening, and a context that hands back what the plugin published.
 *
 * Shared rather than restated per spec because the routes are the seam under
 * test in all of them, and two copies of the seam is two chances for a spec to
 * be testing a bench that has drifted from the one next door.
 */

import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SHORTCUT_SERVICE, apply, type IShortcut, type ShortcutContext, type WebServerLike } from '../src/index.ts'

/** One route the plugin registered. */
export interface Route {
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** A recorded response. */
export interface Recorded {
  status: number
  headers: Record<string, string>
  body: string
  /** Whether the handler finished the response. */
  ended: boolean
}

/**
 * Stand in for the response the webserver hands a route.
 * @returns the response object and what it recorded.
 */
export function response(): { res: ServerResponse; recorded: Recorded } {
  const recorded: Recorded = { status: 0, headers: {}, body: '', ended: false }
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      recorded.status = status
      recorded.headers = headers ?? {}
      return res
    },
    write(chunk: string) {
      recorded.body += chunk
      return true
    },
    end(chunk?: string) {
      if (chunk !== undefined) recorded.body += chunk
      recorded.ended = true
      return res
    },
  } as unknown as ServerResponse
  return { res, recorded }
}

/** A request under this bench's control, so a spec can close its stream. */
export type FakeRequest = IncomingMessage & { close: () => void }

/**
 * Stand in for a request the webserver hands a route.
 * @param method - the HTTP method.
 * @param body - the request body, for the routes that read one.
 * @param url - the request target, for the routes that read a query parameter.
 * @returns the request object, with a `close` that fires what the route subscribed to.
 */
export function request(method: string, body?: string, url?: string): FakeRequest {
  const emitter = new EventEmitter() as unknown as FakeRequest & { method: string; url: string }
  emitter.method = method
  emitter.url = url ?? '/'
  emitter.close = () => { emitter.emit('close') }
  Object.defineProperty(emitter, Symbol.asyncIterator, {
    value: async function* () {
      if (body !== undefined) yield body
    },
  })
  return emitter
}

/**
 * Every event a stream has written so far.
 * @param recorded - the recorded response.
 * @returns each `data:` payload, parsed.
 */
export function events<T>(recorded: Recorded): T[] {
  return recorded.body
    .split('\n\n')
    .filter(frame => frame.trim() !== '')
    .map(frame => JSON.parse(frame.replace(/^data: /, '').trim()) as T)
}

/**
 * A settings provider that keeps one namespace in memory.
 *
 * The seam's whole shape in twenty lines: a registration resolves the stored
 * section over the registrant's composition `base`, a write is validated
 * before it is kept, and observers are told after it is. Enough to drive the
 * plugin's own adoption path without a Host.
 */
export class MemorySettings {
  /** The raw user section, as a document would hold it. */
  section: Record<string, unknown> = {}
  /**
   * The composition base the plugin registered.
   *
   * Public because it is an OUTPUT of the registration, not an input to it: the
   * base is what a settings form is seeded from, so what the plugin puts there
   * is a behaviour worth asserting on rather than an implementation detail.
   */
  base: Record<string, unknown> = {}
  private validate: ((value: never) => void) | undefined
  private readonly watchers = new Set<() => void>()

  /**
   * Register one namespace.
   * @param _ns - the namespace, unused: this bench holds exactly one.
   * @param _schema - the schema, unused: resolution here is a shallow merge.
   * @param options - the composition base and the owner's cross-field check.
   * @returns the owner scope.
   */
  register<T>(
    _ns: string,
    _schema: unknown,
    options?: { base?: Partial<T>; validate?: (value: T) => void },
  ): { get: () => T; watch: (callback: (next: T) => void) => () => void } {
    this.base = (options?.base ?? {}) as Record<string, unknown>
    this.validate = options?.validate as ((value: never) => void) | undefined
    return {
      get: () => ({ ...this.base, ...this.section } as T),
      watch: (callback) => {
        const observer = (): void => { callback({ ...this.base, ...this.section } as T) }
        this.watchers.add(observer)
        return () => { this.watchers.delete(observer) }
      },
    }
  }

  /**
   * Write the user section, as `settings.mutate` would.
   * @param next - the complete next user section.
   * @throws whatever the owner's `validate` throws, before anything is kept.
   */
  write(next: Record<string, unknown>): void {
    // Validated BEFORE it is kept, which is the property the plugin relies on
    // to refuse an unusable chord at the write rather than at the next mount.
    this.validate?.({ ...this.base, ...next } as never)
    this.section = next
    this.notify()
  }

  /**
   * Commit a section the owner's `validate` never saw, as a provider reload
   * does when somebody edits the settings document by hand.
   *
   * The seam really has this hole — the real service keeps a namespace's last
   * good value and warns when a published document fails to resolve — so the
   * plugin's own watcher has to survive it.
   * @param next - the complete next user section.
   */
  publish(next: Record<string, unknown>): void {
    this.section = next
    this.notify()
  }

  /** How many observers are attached; zero after the registrant unmounts. */
  watcherCount(): number {
    return this.watchers.size
  }

  private notify(): void {
    for (const observer of [...this.watchers]) observer()
  }
}

/** A mounted plugin, and the handles a spec drives it by. */
export interface Mounted {
  /** The routes it currently holds, by path. */
  routes: Map<string, Route>
  /** The switchboard it published, while it is mounted. */
  shortcut: () => IShortcut | undefined
  /** The settings provider this mount was given, when it was given one. */
  settings: MemorySettings | undefined
  /** Warnings the plugin logged. */
  warnings: unknown[][]
  /** Run its teardown, innermost effect first. */
  unmount: () => void
}

/**
 * Mount the plugin over a recording webserver.
 * @param config - the plugin's configuration.
 * @param settings - a settings provider to compose alongside it, when the spec wants one.
 * @returns the routes it registered, its service, and a disposer running its teardown.
 */
export function mount(
  config: Parameters<typeof apply>[1] = {},
  settings?: MemorySettings,
): Mounted {
  const routes = new Map<string, Route>()
  const disposers: (() => void)[] = []
  const services = new Map<string, unknown>()
  const warnings: unknown[][] = []
  if (settings !== undefined) services.set('settings', settings)
  const webServer: WebServerLike = {
    register: (route) => {
      routes.set(route.path, { path: route.path, handler: route.handler })
      return () => { routes.delete(route.path) }
    },
  }
  const ctx: ShortcutContext = {
    webServer,
    effect: (setup) => { disposers.push(setup()) },
    // The scoped fiber, as far as this bench is concerned: the callback runs
    // only when every named service is present, which is exactly the property
    // that keeps the settings registration optional.
    inject: (deps, callback) => {
      if (deps.some(dependency => !services.has(dependency))) return
      callback(ctx)
    },
    get: serviceName => services.get(serviceName),
    logger: { warn: (...args) => { warnings.push(args) } },
    reflect: {
      provide: (name, value) => {
        services.set(name, value)
        return () => { services.delete(name) }
      },
    },
  }
  apply(ctx, config)
  return {
    routes,
    shortcut: () => services.get(SHORTCUT_SERVICE) as IShortcut | undefined,
    settings,
    warnings,
    unmount: () => { for (const dispose of disposers.reverse()) dispose() },
  }
}

/**
 * Take one route, failing the spec rather than the assertion when it is absent.
 * @param mounted - the mounted plugin.
 * @param path - the route's path.
 * @returns the route.
 */
export function routeAt(mounted: Mounted, path: string): Route {
  const route = mounted.routes.get(path)
  if (route === undefined) throw new Error(`the route ${path} was not registered`)
  return route
}
