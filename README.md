# omdsh-shortcuts

English | [中文](README.zh.md)

Bind a chord to anything the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) can do, from
one document, across both surfaces it runs on.

Mounting this plugin makes a menu appear and a set of keys start working;
unmounting it takes both away; editing its configuration rebuilds them in
place. None of that rebuilds or restarts the desktop shell, and none of it is a
harness edit.

## What it adds

| Surface | Where it comes from |
|---|---|
| The desktop shell's native menu, and every accelerator on it | The document served over `GET /api/desktop/menu`, pushed again on `GET /api/desktop/menu.events` at every revision |
| A native press arriving in the page that is actually in front | `POST /api/desktop/menu.invoke` from the shell, then `GET /api/desktop/shortcut.events?client=<id>` down to the client that last reported focus |
| In-page chords on the web, where there is no menu to claim them | The browser half's own key listener, binding this surface's chords from the same document |
| The `shortcut` service, in the runtime and in the page alike | `ctx.reflect.provide('shortcut', …)` on both halves: `register`, `bindings()`, `onBindings`, `chordLabel` |
| Twelve of the fifteen UI commands, performed | [`src/client/builtins.ts`](src/client/builtins.ts), calling `layout`, `sessions`, `workspaces` and `sessionModes` — the other three belong to the plugins that own them |
| A rebinding form in the plugin hub | The `omdsh-shortcuts` settings namespace: a flat `id → chord` dictionary, applied live |

## The idea

A keystroke has to start where the keyboard is and end where the command lives,
and those are three different places:

| `command.kind` | Performed by | Reached how |
|---|---|---|
| `shell` | The Electron main process | Native menu accelerator |
| `runtime` | A host plugin, in the Node runtime | This plugin's switchboard |
| `browser` | A UI plugin, in the page | This plugin's browser half |

A plugin says only what it can do. Which chord reaches it — or whether one does
at all on this surface — is configuration, so a person who wants `⌘L` to open
the side chat edits one document and never goes looking for which plugin
hard-coded a key.

## Two surfaces, one document

The same runtime serves a desktop window and a browser tab at once — using
`open-in-browser` produces exactly that pair — and the two do not hear
keystrokes the same way.

```
  web       ⌘K ─→ this page's listener ──────────────────→ handler
  desktop   ⌘K ─→ Electron menu ─→ runtime ─→ this page ──→ handler
```

On the desktop the chord is claimed natively, before the page exists, so a
press travels: the shell posts the id to the runtime, and the runtime hands it
to the browser client in front. On the web there is no menu and no native
claim, so the page hears its own keystroke and runs its own handler without
asking anybody.

That difference is not configurable, so bindings are not always transferable
either. **A browser keeps `⌘N`, `⌘T`, `⌘W` and `⌘Q` for itself** — the page is
not asked and `preventDefault` has nothing to prevent. `CmdOrCtrl+N` is a
perfectly good native binding for `new-window` and a key a tab is never handed.

`webAccelerator` is where the two are allowed to disagree:

| `webAccelerator` | On the web |
|---|---|
| absent | the same chord as `accelerator` |
| a string | that chord instead |
| `null` | no chord at all; still on the menu, still reachable by mouse |

Writing a chord the browser reserves into `webAccelerator` is a **fault at
mount**, not a key that quietly does nothing: asking for `⌘W` in a tab is a
request the page cannot honour, and refusing it is the only honest answer.
Leaving a native-only `accelerator` alone is not a fault — the web surface
simply reports that binding as `unreachable`, which a settings surface can
render as "native only".

## The routes it holds

Registered through `ctx.effect` on the `webServer` service, so unmounting the
plugin removes them and the shell falls back to the platform's floor.

| Route | Who reads it |
|---|---|
| `GET /api/desktop/menu` | anyone; the document, read once |
| `GET /api/desktop/menu.events` | the shell; the document on connect and on every revision |
| `POST /api/desktop/menu.invoke` | the shell, handing back an item it does not perform |
| `GET /api/desktop/shortcut.events?client=<id>` | a browser client; bindings, and the presses it could not hear |
| `POST /api/desktop/shortcut.focus` | a browser client, saying it is the one in front |

The shell's stream and the client's are separate on purpose. The shell's
payload is a bare document, which is what every shipped desktop build already
parses; framing it to carry invocations as well would blank the menu bar of
every installed shell.

## Which client gets a desktop press

The one that most recently reported focus. There is usually more than one
client — several windows, several tabs, or both against the same runtime — and
"the surface the person is looking at" is the only answer that is ever right.

Focus is reported rather than deduced because nobody else can see it: the shell
knows which window owns the menu that was pressed, but [its windows carry no
preload and stay sandboxed](https://github.com/omdsh-plugins/omdsh-desktop/blob/HEAD/app/src/windows.ts) by design, so
it has no channel into the page; and an HTTP request says nothing about where
somebody's attention is. So the page says so, and keeps saying so.

## The document

```ts
{
  version: 1,
  items: [
    {
      id: 'new-window',
      label: 'New Window',
      section: 'file',                              // app | file | view | window | help
      command: { kind: 'shell', name: 'new-window' },
      accelerator: 'CmdOrCtrl+N',                   // native only; a tab never gets ⌘N
    },
    {
      id: 'sidechat.open',
      label: 'Ask Here',
      section: 'view',
      command: { kind: 'browser' },
      accelerator: 'CmdOrCtrl+L',
      webAccelerator: 'CmdOrCtrl+Alt+L',            // the browser keeps ⌘L; the web gets Alt
    },
    { id: 'say-hello', label: 'Say Hello', section: 'help', command: { kind: 'runtime' } },
  ],
}
```

`shell` names one of a fixed vocabulary the main process performs —
`new-window`, `restart-runtime`, `reveal-log`, `open-in-browser`,
`toggle-idle-suspend`. That list is the one part of the contract a plugin
cannot grow, because growing it means shipping a new Electron build. Anything a
person can bind at will is `runtime` or `browser`.

A `checkbox: true` item renders as one, but its state belongs to the shell, not
to this document: the shell reads its own stored setting when it builds the
entry, so a rebuild cannot make the tick drift from what it describes.

Refused at mount rather than served: two items sharing an id, two items
claiming one native chord, two items binding one chord in the page, and a
`webAccelerator` that is malformed or that the browser reserves.

## Registering a command

In the runtime, for a `runtime` command. The service is resolved by name rather
than through an ambient `ctx.shortcut`, because both halves of this package
compile as one program and only the browser half augments cordis's `Context`:

`shortcut` is reached from inside `apply`, never from a top-level `inject`:
whether this plugin is in the profile is a person's `dsh plugin add` decision,
and cordis's inject wait has no timeout, so a top-level entry naming it sits at
`pending` and both boot audits fail the WHOLE page. A fiber started inside
`apply` is not a loader entry, so waiting forever costs nothing.

```ts
export function apply(ctx: Context): void {
  ctx.inject(['shortcut'], (sctx) => {
    const shortcut = sctx.get('shortcut') as unknown as IShortcut | undefined
    // Reachable when the name is provided by a fiber that is not active.
    if (shortcut === undefined) return
    sctx.effect(() => shortcut.register('say-hello', () => { /* ... */ }))
  })
}
```

In the browser, for a `browser` command:

```ts
export function apply(ctx: ClientContext): void {
  ctx.inject(['shortcut'], (sctx) => {
    if (sctx.get('shortcut') === undefined) return
    sctx.effect(() => sctx.shortcut.register('sidechat.open', () => { panel.open() }))
  })
}
```

Hang the effects on `sctx` rather than `ctx`, so unloading this plugin at
runtime withdraws the registrations with it.

Registering claims no key. A command the document never declares registers fine
and simply never fires, which is the right outcome for a plugin mounted against
a configuration that does not mention it. `ctx.shortcut.bindings()` reports how
each command actually stands on this surface, including the ones with no chord
here and why; `ctx.shortcut.onBindings(fn)` fires after each revision, so a
surface that DISPLAYS a chord — a tooltip, a settings row — follows a rebinding
without a reload.

Register on a RESTRICTED fiber rather than in the plugin's own `inject` list, or
a composition with no keybinding layer loses the behaviour itself instead of
merely losing its chord:

```ts
ctx.inject(['shortcut'], (sctx) => {
  const shortcut = sctx.get('shortcut') as unknown as IShortcutClient
  sctx.effect(() => shortcut.register('panel.files', () => { geometry.toggleRight() }))
})
```

### Letting a button teach its chord

Someone who found a feature with the mouse should be able to stop using the
mouse for it, so a button names its chord in its tooltip. `chordLabel` is the
whole of what that takes:

```ts
// "Show the file panel · ⇧⌘E", or "· ⌥⌘E" in a browser tab
const chord = shortcut.chordLabel('panel.files')
const hint = chord === undefined ? t('files.open') : `${t('files.open')} · ${chord}`
```

Three things it settles, so no surface redoes them:

- **The platform's spelling** — `⇧⌘E` on a Mac, `Ctrl+Shift+E` elsewhere.
  `CmdOrCtrl+Shift+E` is the WIRE spelling, and printing it would teach the
  configuration format instead of the key.
- **The surface's chord** — the native `⌘1` on the desktop, `⌥⌘1` in a tab,
  because those are the keys each one actually receives.
- **`undefined` when no chord reaches it** — so the tooltip falls back to the
  bare title rather than a separator with nothing after it. That is the ordinary
  state in a tab for a command whose key the browser kept.

Pair it with `onBindings`: the document is pushed, so the first read is usually
empty, and a rebinding has to reach the tooltip too. `omdsh-sidepanel`'s two panel
switches and `omdsh-justchat`'s and `omdsh-code`'s mode segments all do exactly
this. `omdsh-sidechat`'s summon icon reaches the same place by the lower road —
it reads `bindings()` itself and formats the claim, because it wants to know
WHO holds the chord and not only how to print it.

The harness's own buttons — New Session, search, add workspace, settings,
collapse sidebar — are deliberately not among them: their tooltip components
live in packages this repository does not edit, and on the desktop those chords
are already written on the menu bar.

A UI plugin that already binds its own key hands it over by unbinding — the
protocol `setSummonChord(null)` names — and registers a command instead. Between
the two there is no case where two handlers race for one keystroke. Two worked
examples ship in this repository:

- [`omdsh-sidepanel`](https://github.com/omdsh-plugins/omdsh-sidepanel/blob/HEAD/src/client/shortcut.ts) hands over its two
  panels. It bound no key of its own, so it only registers.
- [`omdsh-sidechat`](https://github.com/omdsh-plugins/omdsh-sidechat/blob/HEAD/src/client/shortcut.ts) hands over a key
  it was ALREADY using: on a restricted fiber it calls `setSummonChord(null)`,
  registers `sidechat.open`, and then feeds its tooltip from `onBindings` —
  giving a key up must not mean it stops being teachable. Unloading the fiber
  gives the built-in `CmdOrCtrl+L` back, so removing a keybinding layer does not
  quietly remove the summon with it.

## The defaults

### The shell tier: `shell` commands

| Item | id | Chord | Section |
|---|---|---|---|
| New Window | `new-window` | `CmdOrCtrl+N` | file |
| Restart Harness Runtime | `restart-runtime` | `CmdOrCtrl+Alt+R` | view |
| Open in Browser | `open-in-browser` | `CmdOrCtrl+Shift+O` | view |
| Reveal Runtime Log | `reveal-log` | `CmdOrCtrl+Shift+L` | view |
| Release Memory When Idle | `idle-suspend` | `CmdOrCtrl+Alt+M` | app |

The id is what a rebinding names, and `idle-suspend` is the one that does not
read like its command: the item is `idle-suspend`, the capability it asks the
shell for is `toggle-idle-suspend`, and it is the only checkbox in the set.

All five are `shell` commands, so all five are desktop-only: there is no
Electron in a tab for a chord to reach. The tiers are what keep the map
memorable — the bare modifier is the standard window operations, `Shift`
reaches a shell surface or destination, and `Alt` reaches the runtime process,
the tier Electron itself puts the developer tools on. Printable characters are
deliberately left alone, because the harness UI inside the window owns every key
the menu does not — and the tier below is that UI spending them.

### The UI tier: `browser` commands

| Item | id | Desktop | Web | Performed by |
|---|---|---|---|---|
| New Session | `session.new` | `CmdOrCtrl+K` | same | this plugin |
| Fork Session | `session.fork` | `CmdOrCtrl+Shift+K` | same | this plugin |
| Archive Session | `session.archive` | `CmdOrCtrl+Shift+W` | **none** | this plugin |
| Add Workspace | `workspace.add` | `CmdOrCtrl+O` | `CmdOrCtrl+Alt+O` | this plugin |
| Remote Connect | `remdev.connect` | `CmdOrCtrl+Shift+C` | `CmdOrCtrl+Alt+C` | `omdsh-remdev` |
| Search Sessions | `session.search` | `CmdOrCtrl+Shift+F` | same | this plugin (DOM) |
| Toggle Sidebar | `sidebar.toggle` | `CmdOrCtrl+Shift+B` | `CmdOrCtrl+Alt+B` | this plugin |
| Toggle File Panel | `panel.files` | `CmdOrCtrl+Shift+E` | same | `omdsh-sidepanel` |
| Toggle Terminal | `panel.terminal` | ``Ctrl+` `` | same | `omdsh-sidepanel` |
| Toggle Details Panel | `details.toggle` | `CmdOrCtrl+Shift+D` | `CmdOrCtrl+Alt+D` | this plugin |
| Ask Here | `sidechat.open` | `CmdOrCtrl+L` | `CmdOrCtrl+Alt+L` | `omdsh-sidechat` |
| Chat Mode | `mode.chat` | `CmdOrCtrl+1` | `CmdOrCtrl+Alt+1` | this plugin |
| Work Mode | `mode.work` | `CmdOrCtrl+2` | `CmdOrCtrl+Alt+2` | this plugin |
| Code Mode | `mode.code` | `CmdOrCtrl+3` | `CmdOrCtrl+Alt+3` | this plugin |
| Settings | `settings.open` | `CmdOrCtrl+,` | `CmdOrCtrl+Alt+,` | this plugin (DOM) |
| Plugin Settings | `settings.plugins` | `CmdOrCtrl+Shift+P` | `CmdOrCtrl+Alt+P` | this plugin (DOM) |

**The web column follows one rule: swap `Shift` — or nothing — for `Alt`.** The
ones that need it are the chords a browser keeps: `⌘,` is Preferences, `⌘O` is
Open File, `⌘1..3` switch tabs, `⌘⇧B` toggles the bookmarks bar, `⌘L` focuses
the address bar, `⌘⇧D` bookmarks every tab. `Alt` is the tier no mainstream
browser spends on window chrome, and [`isReservedByBrowser`](src/chord.ts)
agrees — holding it takes a chord out of the reserved set entirely — so one
modifier answers the whole class of collisions without a table of per-browser
exceptions.

The ones NOT restated — `⌘⇧F`, `⌘⇧E`, ``Ctrl+` ``, `⌘⇧K` — reach a page in
Chrome, Safari and Firefox alike, and a second spelling would be a second key to
remember for no gain. `remdev.connect` is the reverse case: its `⌘⇧C` is the
chord Chrome and Safari give inspect-element, so it is restated as `⌥⌘C`
rather than racing the browser for a key only some tabs would hand over. The
one item with no web chord at all is `session.archive`: every `⌘W` spelling
belongs to the browser, `Alt` included in Safari, so it is honestly
native-only rather than dishonestly bound.

## The built-in commands

The rows above marked **this plugin** are handled by this package's own browser
half ([`src/client/builtins.ts`](src/client/builtins.ts)). That is the opposite
of the posture the rest of this package takes, and worth the explanation:

most UI actions have a service behind them — `ctx.layout` for the columns,
`ctx.sessions` and `ctx.workspaces` for conversations and projects,
`omdsh-base`'s `sessionModes` for the switch. Nothing in the harness
registers a shortcut for them because the harness has no shortcut service to
register with; this one arrives from outside it. So the call has to be made from
somewhere, and here is the only place that knows the chord was pressed.

Three are reachable only through the DOM: the **settings dialog**, its
**Plugins page**, and the **sidebar's session search**. Their open state is, in
the harness's own words, "component-local viewing state", inside packages this
repository does not edit. [`src/client/anchors.ts`](src/client/anchors.ts)
records what makes those addresses defensible: every one is a framework
contract — the `data-slot` every outlet emits, the frame's own
`data-sidebar-collapsed` / `data-details-collapsed`, and ARIA roles — rather
than a hashed CSS-module class, localized visible text, or render order. The one
place order is unavoidable, picking the Plugins row out of the settings nav,
reads its INDEX from the slot registry, so the id stays the thing being matched
and the DOM supplies nothing but position.

Every handler is a quiet no-op when the thing it drives is absent. The mode
registry belongs to [`omdsh-base`](https://github.com/omdsh-plugins/omdsh-base),
and the segments it holds arrive from the mode plugins: without `omdsh-base`
there is no registry at all and `⌘1` reaches nothing, and with it but without
`omdsh-justchat` the registry is simply missing the Chat and Work segments, so
`⌘1` and `⌘2` find nobody to enter. Either way the press should do nothing at
all — not throw, and not take the whole key listener down with it.

`panel.files`, `panel.terminal` and `sidechat.open` are deliberately NOT in that
file: those behaviours have owners that can register for themselves, and do.

## Rebinding a chord

The configuration has two layers with different owners, and the split is what
makes the second one editable in a settings panel:

| Field | Owner | Where it is edited |
|---|---|---|
| `items` | The composition | A profile's `cordis.patch.yml` |
| `bindings` | The person | Settings → Plugins → OMDSH Plugins |

`items` says which commands exist, what they read as, which menu they join, and
who performs them. `bindings` is a flat map of `id → chord` laid over it:

```yaml
- id: omdsh-shortcuts
  config:
    bindings:
      open-in-browser: CmdOrCtrl+Shift+B
      reveal-log: ''            # stays on the menu, binds no key
```

An override replaces the item's native `accelerator`. `webAccelerator` is left
exactly as composed, because it says something about the SURFACE — "a tab is
never handed this key" — rather than about which chord was chosen.

**The panel does not open empty.** The `base` handed to settings at registration
carries every command's EFFECTIVE chord, not just the ones somebody already
changed. The reason is practical: a form generated over a bare override map
starts empty, and an empty map is indistinguishable from "this plugin binds
nothing" to the person reading it. So the panel is seeded with a picture of the
keyboard rather than a picture of the diff, and rebinding is editing a row that
is already there instead of guessing an id and typing it in.

Laying that layer back over the items is the identity — it was read off them —
so seeding changes nothing about a fresh install. A composition that names its
own `items` is seeded from THOSE, not from the shipped set.

An id no item carries is ignored rather than refused: the item list is
composition, it moves, and a stale override must never be able to stop this
plugin from mounting. A chord that does not parse IS refused, at the write that
would store it, because no item list makes `Ctrl+` valid later.

This plugin registers `bindings` as the settings namespace `omdsh-shortcuts`
(see [the omdsh conventions](https://omdsh-plugins.github.io/conventions/?lang=en#rule-1)), which is the whole of what
[`omdsh-plughub`](https://github.com/omdsh-plugins/omdsh-plughub) needs to render it a configuration page.
The registration rides a scoped fiber, so a composition with no settings
provider runs on its entry config exactly as before.

A rebinding applies **live**: the document is rebuilt and pushed down the
streams already open, so every connected shell rebuilds its native menu and
every connected page rebinds its keys without a restart.

## Reach

The invoke route has no trust fence. Two things bound it: only ids the
published document declares are accepted, and only handlers a mounted plugin
registered can run. What it does not bound is who may post — the route is
exactly as reachable as the webserver's bind address, which is loopback on the
desktop and may not be under `dsh web`. A plugin registering something
destructive should know that. The seam if a fence is wanted is `webRuntime`,
the way [`omdsh-sidepanel`](https://github.com/omdsh-plugins/omdsh-sidepanel/blob/HEAD/src/trust-fence.ts) reads it.

## Install

A dsh bundle, not a harness edit. [`cordis.patch.yml`](cordis.patch.yml) adds
one row over whatever the profile already composed:

```sh
dsh plugin --profile web add @omdsh-plugins/omdsh-shortcuts
```

Or from a checkout, when you are working on the plugin itself:

```sh
pnpm install && pnpm run build                    # a local path install never runs prepare
dsh plugin --profile web add <path-to-this-package>
```

Both halves do real work and neither is sufficient alone: the node half serves
the document and switches presses, the browser half holds the registry and
binds this surface's chords. On a surface with no browser the client half is
never fetched; on a `dsh web` with no Electron the browser half is the whole
story.

Remove it the same way:

```sh
dsh plugin --profile web remove @omdsh-plugins/omdsh-shortcuts
```

Every open stream is told the document is empty as the row unloads, so the
shell drops back to the platform's own menu and every page unbinds its keys at
once, rather than after a request there is nothing left to answer.

**Nothing else has to be installed beside it, and nothing it reaches for is
required.** The host half injects `webServer` alone and the browser half
`slots`; every other name it uses — `sessionModes` from `omdsh-base`, the
handlers `omdsh-sidepanel` and `omdsh-sidechat` register — is read from inside
`apply` and answered for when it is missing. A profile with only this plugin
composes and boots: the menu is there, every chord binds, and the commands whose
owners are absent are quiet no-ops. The same holds in the other direction — a
profile that drops this plugin leaves `omdsh-sidepanel` and `omdsh-sidechat`
standing, each with its own key back.

## Commands

```sh
pnpm install
pnpm run build       # tsc to lib/types, then tsdown for both halves
pnpm run typecheck   # sources and tests
pnpm run test        # vitest
pnpm run harness:local ../../deepseek-harness   # build against a checkout
pnpm run harness:npm                            # back to the committed pin
pnpm run check:harness-pin                      # fails while anything is linked
```

## Where it came from

Split out of [`omdsh-desktop`](https://github.com/omdsh-plugins/omdsh-desktop), originally `app/src/menu.ts`.
The decision record is the Agent Note `2026-08-13-electron-desktop-application`
on the harness fork's `legacy/all-in-one` branch.

## Known limitations

- **The `shell` tier is desktop-only.** All five of those items need the
  Electron main process to perform them, so under `dsh web` they are absent from
  the page entirely — there is no menu to render them on and no chord that would
  reach anything.
- **`session.archive` has no web chord.** Every `⌘W` spelling belongs to the
  browser, `Alt` included, so a tab reports it `unreachable` rather than binding
  a key that would close the window instead.
- **A chord the browser reserves cannot be given to a tab.** `⌘N`, `⌘T`, `⌘W`
  and `⌘Q` never reach the page, so `webAccelerator` refuses them at mount. The
  answer is a different chord on the web, not a workaround.
- **The invoke route carries no trust fence.** It is as reachable as the
  webserver's bind address, which is loopback on the desktop and may not be
  under `dsh web`; a plugin registering something destructive should know it.
- **Three built-ins reach through the DOM.** The settings dialog, its Plugins
  page and the sidebar's session search have no service to call, so they are
  driven through framework contracts — `data-slot`, the frame's collapse
  attributes, ARIA roles. A markup change upstream is a selector this package
  has to follow.
- **`items` is composition, not a setting.** Which commands exist, what they
  read as and who performs them are edited in a profile's `cordis.patch.yml`;
  the hub offers only `bindings`. Adding a command to the menu is not something
  a person can do from a panel.
