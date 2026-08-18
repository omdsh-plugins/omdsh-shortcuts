/**
 * The faces the built-in commands reach, named explicitly instead of read off
 * the ambient cordis `Context`.
 *
 * Two separate reasons, both of which land on the same answer:
 *
 * - **Typing.** The harness deliberately typechecks its browser and host halves
 *   as two programs, because both merge cordis `Context` under the same keys
 *   with different services. A package compiled OUTSIDE that repository has no
 *   such split, so `ctx.sessions` resolves to whichever declaration the
 *   compiler saw first. Naming the face and resolving it by name is what
 *   `omdsh-chatmode` already does for the same reason, and it is fully typed
 *   downstream either way.
 * - **Optionality.** Every one of these is a service some composition may not
 *   have. `layout` and `sessions` ship with the web app, but `sessionModes`
 *   arrives only with `@omdsh-plugins/omdsh-basemode`, and a `dsh web` assembled without it
 *   must still mount this plugin with the rest of its chords working. So the
 *   resolution is per-press and answers `undefined`, rather than an `inject`
 *   list that would keep the whole browser half from mounting.
 *
 * `SessionModes` and `ILayout` are structural mirrors rather than imports, for
 * the same reason `omdsh-codemode` mirrors the first of them: cordis binds
 * services by name at runtime, so depending on those packages for their `.d.ts`
 * would buy nothing but a version to keep in step.
 * @module @omdsh-plugins/omdsh-shortcuts/src/client/services
 */

import type { ClientContext, ISessions, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'

/** The panel-transition face `@deepseek-ai/dsh-client-ui-layout` publishes as `layout`. */
export interface ILayout {
  /** Toggle the sidebar column (rail ⟷ contract default width). */
  toggleSidebar(): void
  /** Open the details column (no-op when already open). */
  openDetails(): void
  /** Close the details column. */
  closeDetails(): void
}

/**
 * As much of `@omdsh-plugins/omdsh-basemode`'s mode-switch registry as a chord
 * needs: press a posture, and offer it a New Session first.
 *
 * A NARROWED mirror, deliberately: this package presses postures and never
 * registers one, so importing the published face would declare a dependency on
 * everything a contributor uses. Two methods is the whole of what a chord
 * reaches.
 */
export interface SessionModes {
  /**
   * Press a segment. Unknown or unavailable ids do nothing, which is what makes
   * `mode.code` safe to bind in a composition that has no Code mode.
   * @param id - the segment pressed.
   */
  enter(id: string): void
  /**
   * Offer a New Session to the segment holding the column, so a posture whose
   * conversations the frame cannot start gets to start its own.
   * @param workspaceId - the project the request named, when it named one.
   * @returns true when the active segment took it.
   */
  requestNewSession(workspaceId?: string): boolean
}

/**
 * As much of the slot registry as {@link settingsPageIndex}'s caller needs.
 *
 * Structural because the key it asks about — `settings.section` — belongs to a
 * harness package this one does not depend on, so the real `SlotRegistry`
 * signature would refuse the string.
 */
export interface SlotEntries {
  /**
   * Registered entries for one slot key.
   * @param key - the slot key.
   * @returns the entries, with their registration options.
   */
  entries(key: string): readonly { options: { id?: string; order?: number } }[]
}

/**
 * As much of the harness's locale registry as a reader of somebody else's
 * label needs.
 *
 * One method, and it is the same door every harness package goes through for
 * its own words. What this package does with it is unusual and worth naming:
 * it resolves ANOTHER package's dictionary entry — `sidebar`'s
 * `session.new.label` — so that a button can be recognized by the accessible
 * name it is already wearing. See {@link ./hints.ts} for why that is the
 * address rather than a class name.
 */
export interface ILocale {
  /**
   * A translate function bound to one namespace.
   * @param ns - the namespace, e.g. `sidebar`.
   * @returns the lookup, which reads the active locale at call time.
   */
  bind(ns: string): (key: string) => string
}

/** Service name `@omdsh-plugins/omdsh-basemode` publishes its mode registry under. */
export const SESSION_MODES = 'sessionModes'

/**
 * Resolve one service by name, tolerating its absence.
 *
 * `ctx.get` is the same door `connection` is resolved through everywhere in the
 * harness's own client packages.
 * @param ctx - client root context.
 * @param name - the service name.
 * @returns the face, or undefined when this composition has no such service.
 */
function face<T>(ctx: ClientContext, name: string): T | undefined {
  return (ctx.get(name) as T | undefined) ?? undefined
}

/** The faces the built-in commands reach, each absent-tolerant. */
export interface CommandServices {
  /** Panel transitions; absent only in a composition with no frame. */
  layout: () => ILayout | undefined
  /** Session selection, search and forking. */
  sessions: () => ISessions | undefined
  /** The workspace registry, New Session, and archiving. */
  workspaces: () => IWorkspaces | undefined
  /** The mode switch; absent without `@omdsh-plugins/omdsh-basemode`. */
  modes: () => SessionModes | undefined
  /** The slot registry, for resolving a settings page's position by its id. */
  slots: () => SlotEntries | undefined
  /** The dictionary registry, for reading the label a harness button wears. */
  locale: () => ILocale | undefined
}

/**
 * Bind lazy resolvers for every face the commands use.
 *
 * Lazy on purpose: a chord may be pressed long after `apply`, by which time a
 * service that was not there at mount may have arrived (or gone). Resolving per
 * press means a command is exactly as available as the thing it drives.
 * @param ctx - client root context.
 * @returns the resolvers (see {@link CommandServices}).
 */
export function resolveServices(ctx: ClientContext): CommandServices {
  return {
    layout: () => face<ILayout>(ctx, 'layout'),
    sessions: () => face<ISessions>(ctx, 'sessions'),
    workspaces: () => face<IWorkspaces>(ctx, 'workspaces'),
    modes: () => face<SessionModes>(ctx, SESSION_MODES),
    slots: () => face<SlotEntries>(ctx, 'slots'),
    locale: () => face<ILocale>(ctx, 'locale'),
  }
}

/**
 * Read one of the harness's own labels, in the locale the page is showing.
 *
 * Answers undefined rather than a guess when the composition has no locale
 * service, so a caller matching against it simply matches nothing — which is
 * the right outcome for a hint, and the wrong one for anything that would act.
 * @param locale - the dictionary registry, when this composition has one.
 * @param ns - the owning package's namespace.
 * @param key - the dictionary key.
 * @returns the label, or undefined with no registry to ask.
 */
export function labelIn(locale: ILocale | undefined, ns: string, key: string): string | undefined {
  return locale?.bind(ns)(key)
}

/**
 * Where one settings page sits in the dialog's nav rail.
 *
 * The rail renders one button per `settings.section` registration in `order`,
 * and the buttons carry no id of their own — so this reads the SAME ledger the
 * rail projects from and answers a position, leaving the id as the thing being
 * matched. Sorting is stable, which is what keeps ties in registration order
 * exactly as the rail resolves them.
 * @param slots - the slot registry.
 * @param id - the section id, e.g. `plugins`.
 * @returns the zero-based position, or undefined when nothing registered it.
 */
export function settingsPageIndex(slots: SlotEntries, id: string): number | undefined {
  const ordered = [...slots.entries('settings.section')]
    .sort((left, right) => (left.options.order ?? 0) - (right.options.order ?? 0))
  const at = ordered.findIndex(entry => entry.options.id === id)
  return at < 0 ? undefined : at
}
