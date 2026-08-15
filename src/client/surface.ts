/**
 * Which of the two surfaces this page is.
 *
 * The question being asked is "is there a native menu in front of me that has
 * already claimed these chords", and a sandboxed page has no honest way to find
 * out. `omdsh-desktop` gives its windows no preload on purpose, so there is no
 * bridge to ask across; the runtime cannot answer either, because it serves both
 * kinds of client at once the moment somebody uses `open-in-browser`. What is
 * left is the user agent, which Electron marks.
 *
 * Being wrong is a degradation and not a break, in both directions, which is
 * what makes a sniff acceptable here at all:
 *
 * - a desktop window read as web binds chords the menu also holds. Electron
 *   handles a menu accelerator before the keydown reaches the page, so the
 *   usual result is the menu winning and the page's binding never firing;
 * - a browser tab read as desktop binds nothing and waits for invocations that
 *   never come. Its keys do not work; every button and menu entry still does.
 *
 * Neither loses data and neither throws. The detector is exported and takes its
 * view as an argument so a caller that knows better can say so.
 * @module @omdsh-plugins/omdsh-shortcuts/src/client/surface
 */

import type { Surface } from '../chord.ts'

/** As much of `window` as the detector reads. */
export interface SurfaceView {
  navigator: { userAgent: string }
}

/**
 * The marker Electron adds to its user agent, e.g. `... Electron/43.4.0 ...`.
 *
 * The slash is part of the test on purpose: a bare "Electron" could be anything,
 * including a page whose own title ended up in a custom agent string.
 */
const ELECTRON_MARKER = 'Electron/'

/**
 * Decide which surface a page is running on.
 * @param view - the window to read; its user agent is the whole input.
 * @returns the surface (see {@link Surface}).
 */
export function detectSurface(view: SurfaceView): Surface {
  return view.navigator.userAgent.includes(ELECTRON_MARKER) ? 'desktop' : 'web'
}
