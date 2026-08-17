/**
 * Teaching a chord on the button that performs it, including the buttons this
 * package does not own.
 *
 * Someone who found a feature with the mouse should be able to stop using the
 * mouse for it. A plugin's own control does that from the inside — read
 * `chordLabel`, put the chord in the tooltip, follow `onBindings` — and every
 * omdsh plugin with a button already does. The harness's own controls cannot:
 * New Session, the session search, add workspace, Settings and the sidebar fold
 * live in packages this repository does not edit, and a keybinding layer that
 * arrives from outside the harness is exactly the thing they were never written
 * to ask.
 *
 * So the hint is applied from the outside, and this module is where that choice
 * is confined.
 *
 * ## It writes into somebody else's tooltip rather than raising its own
 *
 * The harness renders a tooltip for most of these buttons already
 * (`ui-primitives`' `Tooltip`, a fixed-position `[role="tooltip"]` plate). A
 * second bubble beside it would be two tooltips for one button, so the chord is
 * APPENDED to theirs: one plate, placed and animated and clamped by the code
 * that owns it, now ending in ` · ⌘K`. Only an appended element is ever added,
 * never a change to the text React already put there, which is the one
 * direction a foreign write to a React subtree is safe in.
 *
 * A few controls have no tooltip at all — the Settings trigger has never had
 * one, New Session drops its when the column is wide enough to carry a visible
 * label — and those get a plate of this package's own, styled from the same
 * theme variables so the two read as one thing. That is the whole of the
 * fallback: it appears only where nothing else would have.
 *
 * ## How a button is recognized
 *
 * By the accessible name it is already wearing, resolved through the SAME
 * dictionary the button resolved it through: `aria-label` compared against
 * `locale.bind('sidebar')('session.new.label')`. That is not text scraping —
 * nothing here reads a rendered string and hopes — it is asking the harness what
 * it calls its own button and looking for the button that answers to it. It
 * follows a locale switch for free, and it fails to an empty hint rather than to
 * a wrong one if a key is ever renamed.
 *
 * Two controls carry no accessible name and are addressed the way
 * {@link ./anchors.ts} addresses everything else: the Settings trigger through
 * the slot outlet inside it, the settings dialog's Plugins row through the slot
 * ledger's ordering. Class names, visible text and render order are used
 * nowhere.
 *
 * A composition that adds a command of its own names its button with
 * {@link MenuItem.anchor}, a CSS selector, and an item's own selector wins over
 * everything shipped here.
 * @module @omdsh-plugins/omdsh-shortcuts/src/client/hints
 */

import type { MenuItem } from '../contract.ts'
import { UI_COMMANDS } from '../menu.ts'
import { buttonAroundSlot, settingsPages } from './anchors.ts'
import { PLUGINS_SECTION_ID, SETTINGS_TRIGGER_SLOT } from './builtins.ts'
import { labelIn, settingsPageIndex, type CommandServices } from './services.ts'

/** What separates a title from its chord, as every omdsh tooltip writes it. */
export const CHORD_SEPARATOR = '·'

/** Marks the node this package appended to a tooltip it does not own. */
export const CHORD_ATTRIBUTE = 'data-omdsh-shortcuts-chord'

/** Marks the plate this package renders where the harness renders none. */
export const HINT_ATTRIBUTE = 'data-omdsh-shortcuts-hint'

/**
 * How long a hover waits for the harness's own tooltip before this package
 * shows one, in ms.
 *
 * Past the 500ms hover delay `ui-primitives` uses, so a control that has a
 * tooltip is always augmented rather than doubled: the wait decides which of
 * the two mechanisms this hover needs, and guessing early would sometimes pick
 * both.
 */
export const HINT_DELAY = 600

/** Gap between a control and a plate this package places, in px; the harness's. */
const BUBBLE_GAP = 10

/** How close to the viewport edge a plate may sit, in px; the harness's. */
const EDGE_MARGIN = 12

/**
 * What counts as a control a chord can be taught on.
 *
 * `<button>` and the ARIA role that stands in for it, because that is what a
 * person presses. A hint on a container would follow the pointer across
 * everything inside it.
 */
export const CONTROL_SELECTOR = 'button, [role="button"]'

/**
 * Whether one event target or node is an element.
 *
 * `instanceof Element` rather than a `nodeType` compare, which is the ordinary
 * reading — and one document is the only realm in play here, so the
 * cross-realm caveat that usually argues for `nodeType` does not apply.
 * @param value - the target or node.
 * @returns true for an element.
 */
function isElement(value: EventTarget | Node | null): value is Element {
  return value instanceof Element
}

/**
 * Whether one event target is a node this document can contain.
 * @param value - the target.
 * @returns true for a node.
 */
function isNode(value: EventTarget | null): value is Node {
  return value instanceof Node
}

/** Locale namespace `@deepseek-ai/dsh-client-ui-sidebar` registers its words under. */
export const SIDEBAR_NS = 'sidebar'

/** Locale namespace `@deepseek-ai/dsh-client-ui-workspace` registers its words under. */
export const WORKSPACE_NS = 'workspace'

/** One label a harness package gives one of its own controls. */
export interface HarnessLabel {
  /** The owning package's locale namespace. */
  ns: string
  /** The dictionary key. */
  key: string
}

/** How one control is recognized, and which command it performs. */
export interface HintAnchor {
  /** The command whose chord this control teaches. */
  command: string
  /**
   * Accessible names that identify it, any one of which is a match.
   *
   * More than one where a control renames itself with its state — the sidebar
   * fold reads "Collapse sidebar" open and "Open sidebar" folded, and it is the
   * same button performing the same command either way.
   */
  labels?: readonly HarnessLabel[]
  /** A slot whose outlet renders inside the control (see {@link buttonAroundSlot}). */
  slot?: string
  /** A settings dialog page, by the id its registrant used. */
  settingsPage?: string
}

/**
 * The harness's own controls, and the command each one performs.
 *
 * Deliberately short. A control belongs here only when nothing else can teach
 * its chord: `omdsh-sidepanel`'s panel switches, `omdsh-sidechat`'s summon and
 * the mode segments all name their own chords from inside the plugins that own
 * them, and adding them here would be two hints racing for one tooltip.
 */
export const HARNESS_ANCHORS: readonly HintAnchor[] = [
  // Two buttons wear this name — the wordmark in the expanded column and the
  // New Session button under it — and both start a conversation. Matching by
  // name rather than by position teaches the chord on both without knowing
  // that there are two.
  { command: UI_COMMANDS.newSession, labels: [{ ns: SIDEBAR_NS, key: 'session.new.label' }] },
  {
    command: UI_COMMANDS.toggleSidebar,
    labels: [{ ns: SIDEBAR_NS, key: 'toggle.collapse' }, { ns: SIDEBAR_NS, key: 'toggle.open' }],
  },
  // One name across both column widths: the rail's 36px circle and the header's
  // expanding field are the same control rendered twice.
  { command: UI_COMMANDS.search, labels: [{ ns: WORKSPACE_NS, key: 'search.sessions.aria' }] },
  { command: UI_COMMANDS.addWorkspace, labels: [{ ns: WORKSPACE_NS, key: 'workspace.add' }] },
  // No accessible name at all: the trigger's content is a slot, and the shell
  // renders the button around it.
  { command: UI_COMMANDS.settings, slot: SETTINGS_TRIGGER_SLOT },
  { command: UI_COMMANDS.settingsPlugins, settingsPage: PLUGINS_SECTION_ID },
]

/** What the matcher needs to decide which command a control performs. */
export interface HintLookup {
  /** The document's items, for a composition-supplied {@link MenuItem.anchor}. */
  items: () => readonly MenuItem[]
  /** The faces the anchors resolve through: the slot ledger and the dictionaries. */
  services: Pick<CommandServices, 'slots' | 'locale'>
  /** The document to search. */
  root: Document
}

/**
 * Whether one element is the control an anchor describes.
 * @param element - the element under the pointer.
 * @param anchor - the anchor to test.
 * @param lookup - the faces and document to resolve against.
 * @returns true when this element is that control.
 */
export function matchesAnchor(element: Element, anchor: HintAnchor, lookup: HintLookup): boolean {
  if (anchor.slot !== undefined) return buttonAroundSlot(anchor.slot, lookup.root) === element
  if (anchor.settingsPage !== undefined) {
    const slots = lookup.services.slots()
    if (slots === undefined) return false
    const at = settingsPageIndex(slots, anchor.settingsPage)
    return at !== undefined && settingsPages(lookup.root)[at] === element
  }
  const name = element.getAttribute('aria-label')
  // An unnamed control matches nothing. A dictionary miss answers with the key
  // itself, so the one way this could mistake a control is if somebody named a
  // button `session.new.label` — which is a good deal safer than matching on an
  // absent name.
  if (name === null || name === '') return false
  const locale = lookup.services.locale()
  return (anchor.labels ?? []).some(label => labelIn(locale, label.ns, label.key) === name)
}

/**
 * The command one control performs, if this page can tell.
 *
 * An item's own {@link MenuItem.anchor} is consulted first. A composition that
 * points a command at a button is saying something specific about ITS
 * composition, and a shipped guess about the harness's furniture should not be
 * able to outrank it.
 * @param element - the element under the pointer.
 * @param lookup - the faces and document to resolve against.
 * @param anchors - the shipped table; overridable for a spec.
 * @returns the command id, or undefined when nothing recognizes this control.
 */
export function commandForControl(
  element: Element,
  lookup: HintLookup,
  anchors: readonly HintAnchor[] = HARNESS_ANCHORS,
): string | undefined {
  for (const item of lookup.items()) {
    const selector = item.anchor
    if (selector === undefined || selector === '') continue
    try {
      if (element.matches(selector)) return item.id
    }
    catch {
      // A selector that does not parse is that one item's mistake. Letting it
      // throw here would take the hint off every other control on the surface,
      // and a hover is not the place to report a configuration fault.
    }
  }
  for (const anchor of anchors) {
    if (matchesAnchor(element, anchor, lookup)) return anchor.command
  }
  return undefined
}

/**
 * What a control calls itself, for a plate this package writes.
 *
 * The accessible name first, because that is the string the harness chose for
 * this control in this locale; its visible text second, for the trigger that
 * has neither. Neither is ever COMPARED against anything — this is what to
 * print, not how to recognize — so reading the rendering is safe here in a way
 * it is not in {@link matchesAnchor}.
 * @param element - the control.
 * @returns its name, or undefined when it has none to show.
 */
export function controlName(element: Element): string | undefined {
  const name = element.getAttribute('aria-label')?.trim()
  if (name !== undefined && name !== '') return name
  const text = element.textContent?.trim()
  return text === undefined || text === '' ? undefined : text
}

/**
 * The line a hint reads.
 * @param name - what the control calls itself, when it says.
 * @param chord - the chord, spelled for this platform.
 * @returns the hint text.
 */
export function hintText(name: string | undefined, chord: string): string {
  return name === undefined ? chord : `${name} ${CHORD_SEPARATOR} ${chord}`
}

/**
 * Write the chord onto a tooltip this package did not render.
 *
 * Appends an element; never touches the text node React put there. React
 * updates that node's contents when the label changes and removes the whole
 * plate when the tooltip hides, and both of those operations are indifferent to
 * an extra child. Rewriting the text would not be.
 * @param bubble - the tooltip plate.
 * @param chord - the chord to teach.
 * @param root - the document to create in.
 */
export function augmentBubble(bubble: Element, chord: string, root: Document): void {
  // A second hover of the same still-open plate must not append twice.
  if (bubble.querySelector(`[${CHORD_ATTRIBUTE}]`) !== null) return
  const suffix = root.createElement('span')
  suffix.setAttribute(CHORD_ATTRIBUTE, '')
  suffix.textContent = ` ${CHORD_SEPARATOR} ${chord}`
  bubble.append(suffix)
}

/**
 * The tooltip the harness is currently showing, if it is showing one.
 * @param root - the document to search.
 * @returns the plate, or undefined when nothing is up.
 */
export function harnessBubble(root: Document): Element | undefined {
  return root.querySelector(`[role="tooltip"]:not([${HINT_ATTRIBUTE}])`) ?? undefined
}

/**
 * A plate of this package's own, for the controls the harness leaves bare.
 *
 * Styled inline from the theme's own variables rather than from a stylesheet
 * this package would have to ship and load: the values are `ui-primitives`'
 * tooltip spec, so the two plates are the same object to a reader, and a
 * composition with no theme falls back to a legible dark plate instead of an
 * invisible one.
 * @param root - the document to create in.
 * @returns the plate, not yet placed or attached.
 */
export function createHintBubble(root: Document): HTMLElement {
  const bubble = root.createElement('span')
  bubble.setAttribute('role', 'tooltip')
  bubble.setAttribute(HINT_ATTRIBUTE, '')
  Object.assign(bubble.style, {
    position: 'fixed',
    zIndex: '100',
    width: 'max-content',
    maxWidth: '50vw',
    padding: '3px 7px',
    borderRadius: '8px',
    background: 'var(--dsw-alias-tooltip-bg, #21242b)',
    color: 'var(--dsw-static-neutral-bluish-00, #fff)',
    fontSize: '13px',
    lineHeight: '20px',
    pointerEvents: 'none',
    transform: 'translateY(-50%)',
  })
  return bubble
}

/**
 * Put a plate beside its control, and back inside the viewport if it fell out.
 *
 * To the right and vertically centred, which is `Tooltip`'s own default side
 * and the one the sidebar column's controls all use.
 * @param bubble - the plate, already attached.
 * @param control - the control it belongs to.
 * @param view - the window, for its edges.
 */
export function placeHintBubble(bubble: HTMLElement, control: Element, view: Window): void {
  const box = control.getBoundingClientRect()
  const left = box.right + BUBBLE_GAP
  bubble.style.left = `${left}px`
  bubble.style.top = `${box.top + box.height / 2}px`
  const overflow = bubble.getBoundingClientRect().right - (view.innerWidth - EDGE_MARGIN)
  if (overflow > 0) bubble.style.left = `${left - overflow}px`
}

/** How the installer reaches everything outside itself. */
export interface HintsOptions extends HintLookup {
  /**
   * How one command's chord is spelled on this surface.
   * @param command - the item id.
   * @returns the chord, or undefined when none reaches it here.
   */
  chordLabel: (command: string) => string | undefined
  /** Whether hints are switched on, read fresh: the setting applies live. */
  enabled: () => boolean
}

/** The control a hint is currently waiting on, or writing about. */
interface Armed {
  /** The control under the pointer or the caret. */
  element: Element
  /** The chord it teaches. */
  chord: string
}

/**
 * Teach every chord this page knows on the controls that perform them, for as
 * long as the returned disposer is unspent.
 *
 * Nothing is claimed and nothing is prevented: the listeners are passive, the
 * only writes are one appended element inside a tooltip that is about to be
 * thrown away anyway and one plate of this package's own, and disposing removes
 * both. A page that unmounts this plugin is left exactly as it was.
 * @param view - the window to listen on.
 * @param options - the faces, the document, and the switch.
 * @returns the removal.
 */
export function installHints(view: Window, options: HintsOptions): () => void {
  const root = view.document
  let armed: Armed | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let own: HTMLElement | undefined

  /** Take down the plate this package raised, if it raised one. */
  const clearOwn = (): void => {
    own?.remove()
    own = undefined
  }

  /** Show this package's own plate for the armed control. */
  const showOwn = (current: Armed): void => {
    own ??= createHintBubble(root)
    own.textContent = hintText(controlName(current.element), current.chord)
    root.body.append(own)
    placeHintBubble(own, current.element, view)
  }

  /**
   * The harness's tooltip arrived while a control was armed, so it is this
   * control's: write the chord into it and take down anything of this
   * package's.
   * @param bubble - the plate that appeared.
   */
  const adopt = (bubble: Element): void => {
    if (armed === undefined) return
    clearOwn()
    augmentBubble(bubble, armed.chord, root)
  }

  const observer = new MutationObserver((records) => {
    if (armed === undefined) return
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!isElement(node)) continue
        // This package's own plate is an addition too; adopting it would append
        // the chord to a plate that already reads as one.
        if (node.hasAttribute(HINT_ATTRIBUTE)) continue
        const bubble = node.matches('[role="tooltip"]') ? node : node.querySelector('[role="tooltip"]')
        if (bubble !== null) {
          adopt(bubble)
          return
        }
      }
    }
  })

  /** Stop waiting on the current control and take down anything showing. */
  const disarm = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    armed = undefined
    observer.disconnect()
    clearOwn()
  }

  /**
   * Start teaching one control's chord, once it is clear which mechanism this
   * hover needs.
   * @param element - the control.
   */
  const arm = (element: Element): void => {
    if (!options.enabled()) return
    const command = commandForControl(element, options)
    if (command === undefined) return
    // No chord on this surface is the ordinary state, not a fault: a tab is
    // never handed some of these keys. The tooltip stays as the harness wrote
    // it, which is the honest rendering of "this button has no chord here".
    const chord = options.chordLabel(command)
    if (chord === undefined) return
    armed = { element, chord }
    observer.observe(root.body, { childList: true, subtree: true })
    timer = setTimeout(() => {
      timer = undefined
      const current = armed
      if (current === undefined || !options.enabled()) return
      // A plate that was already up when the pointer arrived — a fast move
      // between two controls — is only safely this control's once the wait is
      // over; before that it may still be the previous control's, on its way
      // out.
      const bubble = harnessBubble(root)
      if (bubble === undefined) showOwn(current)
      else augmentBubble(bubble, current.chord, root)
    }, HINT_DELAY)
  }

  /**
   * The control an event landed on.
   * @param target - the event target.
   * @returns the button, or undefined for anything else.
   */
  const controlAt = (target: EventTarget | null): Element | undefined =>
    (isElement(target) ? target.closest(CONTROL_SELECTOR) : null) ?? undefined

  const onPointerOver = (event: Event): void => {
    const control = controlAt(event.target)
    if (control !== undefined && control === armed?.element) return
    disarm()
    if (control !== undefined) arm(control)
  }

  const onPointerOut = (event: Event): void => {
    if (armed === undefined) return
    // Moving between two children of the armed control is not leaving it.
    const to = (event as MouseEvent).relatedTarget
    if (isNode(to) && armed.element.contains(to)) return
    disarm()
  }

  const onFocusIn = (event: Event): void => {
    const control = controlAt(event.target)
    if (control !== undefined && control === armed?.element) return
    disarm()
    if (control !== undefined) arm(control)
  }

  // A press changes what the control does next — folding the column renames the
  // toggle, opening the dialog moves the caret — so the hint for what it did a
  // moment ago goes away with it.
  const onPointerDown = (): void => { disarm() }
  const onFocusOut = (): void => { disarm() }
  const onBlur = (): void => { disarm() }

  root.addEventListener('pointerover', onPointerOver, true)
  root.addEventListener('pointerout', onPointerOut, true)
  root.addEventListener('pointerdown', onPointerDown, true)
  root.addEventListener('focusin', onFocusIn, true)
  root.addEventListener('focusout', onFocusOut, true)
  view.addEventListener('blur', onBlur)

  return () => {
    disarm()
    root.removeEventListener('pointerover', onPointerOver, true)
    root.removeEventListener('pointerout', onPointerOut, true)
    root.removeEventListener('pointerdown', onPointerDown, true)
    root.removeEventListener('focusin', onFocusIn, true)
    root.removeEventListener('focusout', onFocusOut, true)
    view.removeEventListener('blur', onBlur)
    // Any chord this package wrote into a tooltip that is still up goes with
    // it: unmounting the plugin must leave the page as it found it.
    for (const suffix of root.querySelectorAll(`[${CHORD_ATTRIBUTE}]`)) suffix.remove()
  }
}
