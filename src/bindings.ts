/**
 * The user's own chords, laid over whatever the composition declared.
 *
 * ## Why a separate layer rather than editing the items
 *
 * The item list is a COMPOSITION fact: which commands exist, what they read
 * as, which menu they join, who performs them. Changing that is editing a
 * profile's patch file, and it should be. Which key reaches an item is a
 * PERSON'S fact, and it should be one field in a settings panel.
 *
 * Keeping them apart is what makes the panel possible at all. A settings form
 * generated from a schema can offer `id → chord`, a flat map of strings; it
 * cannot usefully offer an array of five-field objects with a discriminated
 * union in it. So the schema exposes the half a person actually wants to
 * change, and the half they do not stays where it was.
 *
 * ## What an override may say
 *
 * A chord replaces the item's native accelerator. The empty string UNBINDS —
 * the item stays on the menu, reachable by mouse, with no key. An id no item
 * carries is ignored rather than refused, because the item list can change
 * under a stored override (a profile edit, a plugin upgrade) and a stale key
 * must not be able to stop this plugin from mounting.
 *
 * A chord that does not parse IS refused, at the write that stores it. That
 * one cannot be drift: no item list makes `Ctrl+` mean something, so it is
 * always this person, now, making a mistake worth telling them about.
 * @module @omdsh-plugins/omdsh-shortcuts/bindings
 */

import { parseAccelerator } from './chord.ts'
import type { MenuItem } from './contract.ts'

/** The empty string, as an override: the item keeps its place and loses its key. */
export const UNBIND = ''

/** One override this plugin will not store. */
export interface InvalidBinding {
  /** The item id the override named. */
  id: string
  /** What was written. */
  accelerator: string
}

/**
 * Every override whose chord no surface could hold.
 *
 * Deliberately narrow. An unknown id is not here: the item list is
 * composition, it moves, and a stored override for a command that went away
 * must not become a mount failure. A malformed chord is here: nothing about
 * the item list makes it valid later.
 * @param bindings - the user's override map.
 * @returns the offending entries, in key order.
 */
export function invalidBindings(bindings: Readonly<Record<string, string>>): InvalidBinding[] {
  const faults: InvalidBinding[] = []
  for (const [id, accelerator] of Object.entries(bindings)) {
    if (accelerator === UNBIND) continue
    if (parseAccelerator(accelerator) === undefined) faults.push({ id, accelerator })
  }
  return faults
}

/**
 * Lay the user's overrides over a set of items.
 *
 * Only {@link MenuItem.accelerator} is touched. `webAccelerator` is left
 * exactly as composed, because it exists to say something the native chord
 * cannot — "a tab is never handed this key" — and that statement is about the
 * surface, not about which chord was chosen. An override that made a
 * previously-unbindable chord bindable still leaves the web binding where the
 * composition put it, which is the answer this layer can defend; guessing the
 * other way would silently bind a key in every tab that nobody asked for.
 * @param items - the composed items.
 * @param bindings - the user's override map.
 * @returns the items with overrides applied, in the original order.
 */
export function applyBindings(
  items: readonly MenuItem[],
  bindings: Readonly<Record<string, string>> = {},
): MenuItem[] {
  return items.map((item) => {
    const override = bindings[item.id]
    if (override === undefined) return item
    if (override === UNBIND) {
      // Dropped rather than set to empty: `accelerator` is optional, and an
      // item without one is exactly what "on the menu, no key" already means
      // everywhere else in this package.
      const { accelerator: _unbound, ...rest } = item
      return rest
    }
    return { ...item, accelerator: override }
  })
}

/**
 * The overrides a settings form should show as the current state: every item's
 * effective chord, including the ones nobody has changed.
 *
 * A form over a bare override map starts empty, and an empty map is
 * indistinguishable from "this plugin binds nothing" to the person reading it.
 * Seeding the panel with what is actually bound makes the map a picture of the
 * keyboard rather than a picture of the diff.
 * @param items - the composed items.
 * @param bindings - the user's override map.
 * @returns id to effective chord, with unbound items carrying the empty string.
 */
export function effectiveBindings(
  items: readonly MenuItem[],
  bindings: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const effective: Record<string, string> = {}
  for (const item of applyBindings(items, bindings)) {
    effective[item.id] = item.accelerator ?? UNBIND
  }
  return effective
}
