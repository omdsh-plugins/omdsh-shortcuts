# omdsh-shortcuts

[English](README.md) | 中文

用一份文档，为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 能做的任何事绑定组合键——两种形态通吃。

挂载这个插件，菜单出现、一组键开始生效；卸载它，两者一起消失；改它的配置，两者就地重建。这些都不需要重新构建或重启桌面外壳，也都不是对 harness 的改动。

## 它提供什么

| 界面 | 从哪来 |
|---|---|
| 桌面外壳的原生菜单，以及上面的每一个加速键 | 这份文档由 `GET /api/desktop/menu` 提供，每次修订时再经 `GET /api/desktop/menu.events` 推一遍 |
| 一次原生按键，送达真正在前台的那个页面 | 外壳经 `POST /api/desktop/menu.invoke` 交回，再由 `GET /api/desktop/shortcut.events?client=<id>` 下发给最近报告过焦点的客户端 |
| Web 端的页内组合键——那里没有菜单来认领它们 | 浏览器半边自己的按键监听器，按同一份文档绑定这一形态的组合键 |
| 运行时和页面里都有的 `shortcut` 服务 | 两个半边各自 `ctx.reflect.provide('shortcut', …)`：`register`、`bindings()`、`onBindings`、`chordLabel` |
| 十五个界面命令里的十二个，由它执行 | [`src/client/builtins.ts`](src/client/builtins.ts)，调用 `layout`、`sessions`、`workspaces` 和 `sessionModes`——另外三个归拥有它们的插件管 |
| 新窗口从空白开始 | 浏览器半边用掉 `?new=1`，那是 [`omdsh-desktop`](https://github.com/omdsh-plugins/omdsh-desktop) 给刚打开的窗口带上的地址参数 |
| 每个快捷键都写在执行它的那个按钮的 tooltip 里，harness 自带的按钮也算 | [`src/client/hints.ts`](src/client/hints.ts)：把组合键追加进 `ui-primitives` 本来就会弹出的那块 tooltip；它不弹的地方，由本包自己画一块 |
| 插件中心里的改键表单 | `omdsh-shortcuts` 这个 settings 命名空间：一张扁平的 `id → 组合键` 字典，加上一个提示开关，即时生效 |

## 核心想法

一次按键，起点是键盘所在的地方，终点是命令真正住着的地方——而这是三个不同的地方：

| `command.kind` | 由谁执行 | 怎么到达 |
|---|---|---|
| `shell` | Electron 主进程 | 原生菜单加速键 |
| `runtime` | 宿主插件，在 Node 运行时里 | 本插件的交换机 |
| `browser` | UI 插件，在页面里 | 本插件的浏览器半边 |

插件只说自己**能做什么**；哪个组合键够得到它——或者当前形态下究竟有没有键——是配置。于是，想让 `⌘L` 唤出侧边输入框的人只需要改一份文档，不必去查是哪个插件把键写死了。

## 两种形态，一份文档

同一个运行时会同时服务桌面窗口和浏览器标签页——用一次「在浏览器中打开」就正好造出这一对——而两者听见按键的方式并不一样。

```
  Web 端    ⌘K ─→ 本页面的监听器 ────────────────────→ handler
  桌面端    ⌘K ─→ Electron 菜单 ─→ 运行时 ─→ 本页面 ─→ handler
```

桌面端的组合键在页面存在之前就被原生层认领了，所以一次按键要走完全程：外壳把 id POST 给运行时，运行时再把它交给当前在前台的浏览器客户端。Web 端没有菜单，也没有原生认领，页面自己听见按键、自己跑 handler，谁也不用问。

这个差别不归配置管，所以绑定也不总能通用。**浏览器把 `⌘N`、`⌘T`、`⌘W`、`⌘Q` 留给自己**——页面根本不会被问到，`preventDefault` 也没有东西可拦。`CmdOrCtrl+N` 给 `new-window` 当原生绑定完全没问题，标签页却永远拿不到这个键。

在桌面端，这个组合键会打开一扇新窗口。外壳给地址带上 `?new=1`，因为不这样，harness UI 就会从 origin 级的 localStorage 里恢复上次选中的会话——同一 origin 下每扇窗共用那一格。页面在挂载时用掉这个参数：赶在会话列表到达、history 窗口打开之前，清掉恢复出来的选择，再把 `new` 从地址里去掉——这样**这一扇窗**再刷新就是一次普通的恢复。它不会自己开一场对话；开对话的仍然是 ⌘K。

`webAccelerator` 就是允许两边各说各话的地方：

| `webAccelerator` | Web 端的效果 |
|---|---|
| 不写 | 与 `accelerator` 同一个键 |
| 写字符串 | 改用这个键 |
| 写 `null` | 这里完全不绑键；菜单项还在，鼠标仍可达 |

**往 `webAccelerator` 里写一个浏览器保留键，会在挂载时报错**，而不是变成一个默默不响应的键：在标签页里讨要 `⌘W`，是页面根本无法兑现的请求，拒绝是唯一诚实的回答。只写原生 `accelerator` 则不算错——Web 端只是把这条绑定报告为 `unreachable`，设置界面可以据此显示「仅桌面端」。

## 它持有的路由

通过 `webServer` 服务上的 `ctx.effect` 注册，所以卸载插件就会移除这些路由，外壳退回平台自带的菜单底座。

| 路由 | 谁读它 |
|---|---|
| `GET /api/desktop/menu` | 任何人；文档，读一次 |
| `GET /api/desktop/menu.events` | 外壳；连接时给文档，此后每次修订都推 |
| `POST /api/desktop/menu.invoke` | 外壳，把自己不执行的项交回来 |
| `GET /api/desktop/shortcut.events?client=<id>` | 浏览器客户端；绑定表，以及它自己听不见的那些按键 |
| `POST /api/desktop/shortcut.focus` | 浏览器客户端，声明自己在前台 |

外壳的流和客户端的流是刻意分开的。外壳那条流的载荷是一个裸文档——每个已发布的桌面端构建解析的都是这个形状；给它加帧、让它同时承载调用，会让所有已安装外壳的菜单栏变空。

## 桌面端的一次按键给谁

给最近一次报告过焦点的那个客户端。客户端通常不止一个——多个窗口、多个标签页，或者两者同时连着同一个运行时——而「人正在看的那个界面」是唯一永远正确的答案。

焦点靠**上报**，不靠推断，因为别人谁都看不见：外壳知道被按下的菜单属于哪个窗口，但[它的窗口刻意不带 preload、保持沙箱](https://github.com/omdsh-plugins/omdsh-desktop/blob/HEAD/app/src/windows.ts)，没有任何通到页面里的通道；一个 HTTP 请求也完全说不出人的注意力在哪。所以只能由页面自己来说，并且一直说。

## 文档

```ts
{
  version: 1,
  items: [
    {
      id: 'new-window',
      label: 'New Window',
      section: 'file',                              // app | file | view | window | help
      command: { kind: 'shell', name: 'new-window' },
      accelerator: 'CmdOrCtrl+N',                   // 仅原生；标签页永远拿不到 ⌘N
    },
    {
      id: 'sidechat.open',
      label: 'Ask Here',
      section: 'view',
      command: { kind: 'browser' },
      accelerator: 'CmdOrCtrl+L',
      webAccelerator: 'CmdOrCtrl+Alt+L',            // 浏览器保留 ⌘L，所以 Web 端换 Alt
    },
    { id: 'say-hello', label: 'Say Hello', section: 'help', command: { kind: 'runtime' } },
  ],
}
```

`shell` 只能点名主进程会执行的那套固定词汇——`new-window`、`restart-runtime`、`reveal-log`、`open-in-browser`、`toggle-idle-suspend`。这份清单是契约里唯一插件扩不了的部分，因为扩它就意味着要发一个新的 Electron 构建。凡是用户能随意绑键的，都是 `runtime` 或 `browser`。

`checkbox: true` 的项会渲染成复选框，但它的状态属于外壳而不属于这份文档：外壳构建菜单项时读的是自己存的设置，所以重建不会让勾选状态和它所描述的东西脱节。

以下情况在挂载时就会被拒绝，而不是照常发布：两项共用一个 id、两项争同一个原生组合键、两项在页面里绑同一个键，以及 `webAccelerator` 写错了或写了浏览器保留键。

## 注册一个命令

在运行时里注册的是 `runtime` 命令。服务按名字解析，不走环境里的 `ctx.shortcut`，因为本包的两个半边编译成同一个程序，只有浏览器半边扩展了 cordis 的 `Context`：

`shortcut` 要在 `apply` 里面拿，绝不能写进顶层 `inject`：本插件在不在 profile
里，取决于使用者一条条 `dsh plugin add`；而 cordis 对被注入的服务会无限期
等下去，顶层写了它的 entry 会一直停在 `pending`，两道启动审计会把**整个
页面**判为失败。在 `apply` 里启动的 fiber 不是 loader entry，等多久都不要紧。

```ts
export function apply(ctx: Context): void {
  ctx.inject(['shortcut'], (sctx) => {
    const shortcut = sctx.get('shortcut') as unknown as IShortcut | undefined
    // 当这个名字由一个未激活的 fiber 提供时，这里是可达的。
    if (shortcut === undefined) return
    sctx.effect(() => shortcut.register('say-hello', () => { /* ... */ }))
  })
}
```

在浏览器里，注册 `browser` 命令：

```ts
export function apply(ctx: ClientContext): void {
  ctx.inject(['shortcut'], (sctx) => {
    if (sctx.get('shortcut') === undefined) return
    sctx.effect(() => sctx.shortcut.register('sidechat.open', () => { panel.open() }))
  })
}
```

把 effect 挂在 `sctx` 上而不是 `ctx` 上，这样本插件在运行时被卸载时，注
册也跟着撤回。

注册不等于认领任何键。文档从未声明的命令照样能注册，只是永远不会触发——对一个挂在没提到它的配置上的插件来说，这正是该有的结果。`ctx.shortcut.bindings()` 报告每个命令在当前形态下的真实状态，包括哪些在这里没有键、为什么没有；`ctx.shortcut.onBindings(fn)` 在每次文档修订后回调，所以**要显示组合键**的界面（tooltip、设置行）能跟着改绑走，不用刷新。

注册要挂在一个**受限 fiber** 上，而不是写进插件自己的 `inject` 列表——否则没有键盘层的组装会连功能本身一起丢掉，而不只是丢掉快捷键：

```ts
ctx.inject(['shortcut'], (sctx) => {
  const shortcut = sctx.get('shortcut') as unknown as IShortcutClient
  sctx.effect(() => shortcut.register('panel.files', () => { geometry.toggleRight() }))
})
```

### 让按钮把快捷键教给人

一个用鼠标找到的功能，应该能让人从此不用鼠标。所以按钮在 tooltip 里显示自己的组合键，取的就是 `chordLabel`：

```ts
// "打开文件面板 · ⇧⌘E"，在浏览器标签页里则是 "打开文件面板 · ⌥⌘E"
const chord = shortcut.chordLabel('panel.files')
const hint = chord === undefined ? t('files.open') : `${t('files.open')} · ${chord}`
```

这三件事由 `chordLabel` 一并处理，界面不用各自重做：

- **拼法按平台走**——mac 上是 `⇧⌘E`，别处是 `Ctrl+Shift+E`。`CmdOrCtrl+Shift+E` 是**线上拼法**，把它原样印出来是在教配置格式，不是在教按键。
- **形态说了算**——桌面端显示原生键 `⌘1`，标签页里显示 `⌥⌘1`，因为那才是各自真正能收到的键。
- **没有键就返回 `undefined`**——所以 tooltip 落回纯标题，而不是留一个后面什么都没有的分隔符。浏览器把键占走的那些命令，在标签页里就是这个状态。

配合 `onBindings` 使用：文档是推下来的，所以第一次读通常是空的；改绑之后也要跟着变。仓库里 `omdsh-sidepanel` 的两个面板开关、`omdsh-chatmode` 与 `omdsh-codemode` 的模式段都是这么做的。`omdsh-sidechat` 的召唤图标走的是更底一层的路——自己读 `bindings()`，再把 claim 格式化出来，因为它要知道这个键**由谁**持有，而不只是怎么印出来。

已经自己绑了键的 UI 插件，把键让出来即可——`setSummonChord(null)` 就是这个协议——然后改为注册一个命令。这样一来，就不会出现两个 handler 抢同一次按键的情况。仓库里有两个现成的例子：

- [`omdsh-sidepanel`](https://github.com/omdsh-plugins/omdsh-sidepanel/blob/HEAD/src/client/shortcut.ts) 把两个面板交出来。它本来就没绑键，所以只是注册。
- [`omdsh-sidechat`](https://github.com/omdsh-plugins/omdsh-sidechat/blob/HEAD/src/client/shortcut.ts) 交出的是一个**已经在用的**键。它在受限 fiber 里 `setSummonChord(null)` 并注册 `sidechat.open`，然后用 `onBindings` 把文档发给这个命令的键读回来喂给 tooltip——交出按键不该意味着从此不再教人按什么。fiber 卸载时它把内置的 `CmdOrCtrl+L` 还回去，所以移除键盘层不会顺手把召唤功能一起移除。

### harness 自带的按钮，从外面教

New Session、会话搜索、添加工作区、设置、折叠侧栏，这几个按钮做不到上面那件事：它们的组件住在本仓库不改的包里，而从 harness 外面来的键盘层，本来就不是它们被写出来时会去问的东西。所以提示由本插件挂上去，鼠标悬停时读到的是 `New session · ⌘K`。

两套机制，用哪一套是当场判断出来的，不是配置出来的：

| harness 自己弹了什么 | 会发生什么 |
|---|---|
| 它自己的 tooltip | 组合键**追加**到那一块上——仍然只有一块，位置、动画、边界收拢都由拥有它的代码负责，只是结尾多了 ` · ⌘K` |
| 什么都没有（设置入口，以及侧栏展开时的 New Session） | 由本插件画一块，样式取自同一套主题变量 |

一次悬停会先等 600ms——晚于 harness 自己的 500ms 悬停延迟——再做判断，所以有 tooltip 的按钮永远是被追加，绝不会出现两块。写进去的只有追加的元素，绝不改动 React 已经放在那里的文本——那是外部代码写入 React 子树唯一安全的方向。卸载插件时，追加的组合键和那块自绘的提示一并撤走。

**按钮是靠它本来就戴着的名字认出来的。**读 `aria-label`，和按钮自己查过的同一条词典项比较——`locale.bind('sidebar')('session.new.label')`——也就是问 harness 自己怎么称呼这个按钮，而不是去刮一个渲染出来的字符串。语言切换天然跟随；万一某个 key 被改名，代价是提示消失，而不是提示出错。有两个控件，名字不是一条可查的词典项——设置入口的名字来自一个 slot，设置页那一行的名字来自它自己的注册——它们按 [`src/client/anchors.ts`](src/client/anchors.ts) 一贯的方式定位：设置入口用它内部的 slot 出口，设置对话框的 Plugins 行用 slot 账本里的次序。类名、可见文本、渲染顺序一概不用。

组装自己加的命令，可以指明它属于哪个按钮，这个选择器优先于本包内置的一切：

```yaml
- id: omdsh-shortcuts
  config:
    items:
      - id: deploy.run
        label: Deploy
        section: view
        command: { kind: runtime }
        accelerator: CmdOrCtrl+Alt+D
        anchor: '[data-slot="conversation.session.header.actions"] button'
```

整套行为就是一个设置项 `hints`，默认开启，即时生效。关掉它，每个组合键照旧绑定，每块 tooltip 也照旧是 harness 自己写的那样。

## 默认项

### 外壳层：`shell` 命令

| 项 | id | 组合键 | 分区 |
|---|---|---|---|
| New Window | `new-window` | `CmdOrCtrl+N` | file |
| Restart Harness Runtime | `restart-runtime` | `CmdOrCtrl+Alt+R` | view |
| Open in Browser | `open-in-browser` | `CmdOrCtrl+Shift+O` | view |
| Reveal Runtime Log | `reveal-log` | `CmdOrCtrl+Shift+L` | view |
| Release Memory When Idle | `idle-suspend` | `CmdOrCtrl+Alt+M` | app |

改键时写的是 id，而 `idle-suspend` 是唯一一个和命令名对不上的：菜单项是 `idle-suspend`，它向外壳要的能力叫 `toggle-idle-suspend`，它也是这一组里唯一的复选框。

五项全是 `shell` 命令，所以全都只在桌面端有效：标签页里没有 Electron 可让组合键抵达。分三个层级是为了让这份映射好记——单修饰键是标准窗口操作，`Shift` 通向外壳的界面或目的地，`Alt` 通向运行时进程，也就是 Electron 自己放开发者工具的那一层。整份映射刻意避开可打印字符，因为窗口里的 harness 界面占有着菜单不用的每一个键——下面这一层花的正是这些键。

### 界面层：`browser` 命令

| 项 | id | 桌面端 | Web 端 | 由谁执行 |
|---|---|---|---|---|
| New Session | `session.new` | `CmdOrCtrl+K` | 同左 | 本插件 |
| Fork Session | `session.fork` | `CmdOrCtrl+Shift+K` | 同左 | 本插件 |
| Archive Session | `session.archive` | `CmdOrCtrl+Shift+W` | **无** | 本插件 |
| Add Workspace | `workspace.add` | `CmdOrCtrl+O` | `CmdOrCtrl+Alt+O` | 本插件 |
| Remote Connect | `remdev.connect` | `CmdOrCtrl+Shift+C` | `CmdOrCtrl+Alt+C` | `omdsh-remdev` |
| Search Sessions | `session.search` | `CmdOrCtrl+Shift+F` | 同左 | 本插件（DOM） |
| Toggle Sidebar | `sidebar.toggle` | `CmdOrCtrl+Shift+B` | `CmdOrCtrl+Alt+B` | 本插件 |
| Toggle File Panel | `panel.files` | `CmdOrCtrl+Shift+E` | 同左 | `omdsh-sidepanel` |
| Toggle Terminal | `panel.terminal` | ``Ctrl+` `` | 同左 | `omdsh-sidepanel` |
| Toggle Details Panel | `details.toggle` | `CmdOrCtrl+Shift+D` | `CmdOrCtrl+Alt+D` | 本插件 |
| Ask Here | `sidechat.open` | `CmdOrCtrl+L` | `CmdOrCtrl+Alt+L` | `omdsh-sidechat` |
| Chat Mode | `mode.chat` | `CmdOrCtrl+1` | `CmdOrCtrl+Alt+1` | 本插件 |
| Work Mode | `mode.work` | `CmdOrCtrl+2` | `CmdOrCtrl+Alt+2` | 本插件 |
| Code Mode | `mode.code` | `CmdOrCtrl+3` | `CmdOrCtrl+Alt+3` | 本插件 |
| Settings | `settings.open` | `CmdOrCtrl+,` | `CmdOrCtrl+Alt+,` | 本插件（DOM） |
| Plugin Settings | `settings.plugins` | `CmdOrCtrl+Shift+P` | `CmdOrCtrl+Alt+P` | 本插件（DOM） |

**Web 端那一列只有一条规则：把 `Shift`（或者什么都不带）换成 `Alt`。** 需要换的都是浏览器留给自己的键——`⌘,` 是偏好设置、`⌘O` 是打开文件、`⌘1..3` 是切标签、`⌘⇧B` 是书签栏、`⌘L` 是地址栏、`⌘⇧D` 是全部加书签。`Alt` 是主流浏览器都不花在窗口控件上的一层，[`isReservedByBrowser`](src/chord.ts) 也认这一点：按住它，组合键就整个跳出保留集合。于是一个修饰键就回答了整类冲突，用不上一张按浏览器分列的例外表。

没换的那些——`⌘⇧F`、`⌘⇧E`、``Ctrl+` ``、`⌘⇧K`——在 Chrome、Safari、Firefox 里都能抵达页面，再写一遍只会多一个要记的键。`remdev.connect` 恰好相反：它的 `⌘⇧C` 正是 Chrome 和 Safari 分给「检查元素」的键，所以按规则换成 `⌥⌘C`，而不是去和浏览器争一个只有部分标签页才肯让出的键。唯一完全没有 Web 键的是 `session.archive`：`⌘W` 的每种写法都属于浏览器，Safari 上连加了 `Alt` 的也算，所以它诚实地只在桌面端有键，而不是绑一个永远不会响应的。

## 内置命令

上表「由谁执行」写着**本插件**的行，handler 就在这个包的浏览器半边（[`src/client/builtins.ts`](src/client/builtins.ts)）。这和本插件其余部分的姿态正好相反，值得解释一下：

大多数界面动作背后都有服务可调——`ctx.layout` 管两侧栏，`ctx.sessions` 和 `ctx.workspaces` 管会话与工作区，`omdsh-basemode` 的 `sessionModes` 管模式切换。harness 不给它们注册快捷键，是因为 harness 里根本没有快捷键服务可注册——这个服务是从外面来的。调用总得有人发起，而知道「键被按了」的只有这里。

三个例外只能走 DOM：**设置弹窗**、**它当前显示的页和标签页**、**侧栏搜索框**。它们的开关状态，用 harness 自己的话说，是 "component-local viewing state"，住在本仓库不去改的包里。[`src/client/anchors.ts`](src/client/anchors.ts) 写明了这些地址为什么站得住脚——用的全是框架保证的契约（每个 slot 出口都会渲染的 `data-slot`、frame 自己的 `data-sidebar-collapsed` / `data-details-collapsed`、以及 `role="dialog"` 这类无障碍属性），而不是 CSS module 的哈希类名、会被本地化的可见文字或渲染顺序。唯一绕不开顺序的地方——从设置导航栏里挑出 Plugins 那一行——是从 slot 注册表里读出它的**下标**，所以匹配的仍然是 id，DOM 只提供位置。

**`⌘⇧P` 最后停在插件中心那一页。** Plugins 页本身是一条标签栏，自带的两页——Configurable、All——只是一份清单；插件中心（[`omdsh-plughub`](https://github.com/omdsh-plugins/omdsh-plughub)）才是人打开 Plugins 真正要去的那一页：安装、更新、卸载，以及每个声明了配置的插件的表单，包括本插件自己那张改键表。所以这次按键先选中那一页，再选中那个标签。标签栏恰好是 DOM 里唯一保留注册 id 的地方——为了让按钮和面板能按 ARIA 的要求互相指认，section 把每个标签的元素 id 拼成 `` `${useId()}-tab-${id}` ``——所以这个地址比它上面那行导航更可靠，而不是更脆。插件中心在不在，是**先**问 slot 注册表、再看 DOM 的：没装它的组装停在 Plugins 页，什么都不说；只有「注册了却没渲染出来」这一种情况，值得往控制台写一行。

每个 handler 在要驱动的东西不存在时，都是安静的空操作。模式注册表属于 [`omdsh-basemode`](https://github.com/omdsh-plugins/omdsh-basemode)，里面的各个段落来自各个模式插件：没装 `omdsh-basemode` 就根本没有注册表，`⌘1` 谁也够不到；装了 `omdsh-basemode` 但没装 `omdsh-chatmode`，注册表只是少了 Chat 和 Work 两段，`⌘1`、`⌘2` 找不到可进入的对象。两种情况下，这次按键都该什么都不发生——不抛异常，也不能把整个按键监听器一起带走。

`panel.files`、`panel.terminal`、`sidechat.open` **不在**这个文件里：它们的主人能自己注册，也确实自己注册。

## 改一个快捷键

配置分成两层，归不同的人所有——正是这条分界让第二层能放进设置面板里改：

| 字段 | 归属 | 在哪里改 |
|---|---|---|
| `items` | 组装层 | profile 的 `cordis.patch.yml` |
| `bindings` | 使用者 | 设置 → 插件 → 插件中心 |
| `hints` | 使用者 | 设置 → 插件 → 插件中心 |

最后那一列自己也有一个键：`⌘⇧P`（标签页里是 `⌥⌘P`）打开设置弹窗并停在插件中心——也就是说，改这两个字段的面板，离它所描述的那副键盘只有一个键的距离。

`items` 说的是有哪些命令、显示成什么、进哪个菜单、由谁执行。`bindings` 是盖在它上面的一张扁平 `id → 快捷键` 映射：

```yaml
- id: omdsh-shortcuts
  config:
    bindings:
      open-in-browser: CmdOrCtrl+Shift+B
      reveal-log: ''            # 留在菜单里，但不绑定按键
```

覆盖只替换菜单项的原生 `accelerator`。`webAccelerator` 保持组装层的原样，因为它说的是**形态**的事实——"标签页永远拿不到这个键"——而不是选了哪个组合键。

**设置面板打开时不是空的。** 注册时交给 settings 的 `base` 里，带的是**每个命令当前生效的键**，而不是「已经被改过的那些」。理由很实际：由裸覆盖映射生成的表单，一打开就是空的；而在读它的人看来，空映射和「这个插件什么都没绑」没有区别。所以面板里坐着的是一张键盘图，而不是一张 diff；改键是编辑一行已经在那儿的记录，而不是先猜一个 id 再敲进去。

把这一层盖回去是恒等操作——它本来就是从 `items` 里读出来的——所以播下这颗种子，不会让任何一次全新安装和自己的默认值产生分歧。组装层如果自己写了 `items`，种子就从**那份** items 读，而不是从内置的那份读。

映射里出现文档中没有的 id 时会被忽略，而不是被拒绝：item 列表属于组装层，它会变，一条过期的覆盖绝不能让这个插件挂不上去。而解析不了的组合键**会**被拒绝，在那次写入时就拒绝——因为再怎么改 item 列表，`Ctrl+` 也不会变得合法。

`hints` 是使用者拥有的另一个字段：一个开关，默认开启，决定指针停在按钮上时它教不教自己的组合键。它走的是客户端那条流，而不是写在文档里——因为那份文档是**外壳**的，原生菜单把加速键写在菜单项旁边，没有需要教东西的 tooltip。

这个插件把两者一起注册为 settings 命名空间 `omdsh-shortcuts`（见 [omdsh 插件约定](https://omdsh-plugins.github.io/conventions/#rule-1)），这就是 [`omdsh-plughub`](https://github.com/omdsh-plugins/omdsh-plughub) 为它生成配置页所需的全部。这段注册挂在受限 fiber 上，所以没有 settings provider 的组装照旧按 entry config 运行。

改绑**即时生效**：文档重建并推给已经开着的那几条流，每个连着的外壳重建原生菜单，每个连着的页面重绑按键，每块写着组合键的 tooltip 换成新键——都不用重启。

## 可达性

invoke 路由没有信任围栏。约束它的有两点：只接受已发布文档声明过的 id，只能跑已挂载插件注册过的 handler。它**没有**约束的是谁可以 POST——这条路由的可达范围就是 webserver 的监听地址，桌面端是回环，`dsh web` 下则未必。要注册破坏性操作的插件应当知道这一点。若要加围栏，接缝是 `webRuntime`，用法见 [`omdsh-sidepanel`](https://github.com/omdsh-plugins/omdsh-sidepanel/blob/HEAD/src/trust-fence.ts)。

## 安装

它是一个 dsh bundle，不是对 harness 的改动。[`cordis.patch.yml`](cordis.patch.yml) 在 profile 已组装好的内容之上加一行。

```sh
npx @omdsh-plugins/omdsh-plughub add omdsh-shortcuts
```

这就是[插件中心](https://github.com/omdsh-plugins/omdsh-plughub)的安装器，只是入
口从按钮换成了 argv。它从这套集合的
[registry](https://github.com/omdsh-plugins/registry) 里解析出这个插件、从它的
GitHub 仓库装上，并把那条 pnpm 构建白名单写好——裸的 `dsh plugin add github:…`
会把这一步留给你，而那条记录带着 pnpm 解析出来的 commit，只能从报错里抄，事先
写不出来。

`dsh plugin --profile web add @omdsh-plugins/omdsh-shortcuts` 现在**还不是**那条命令：这个
包不在 npm 上，pnpm 会回 `ERR_PNPM_FETCH_404`。同一次安装也可以是一个按钮——
只要 profile 里已经有插件中心，它就在**设置 → 插件 → 插件中心**里这个插件的卡片
上。

或者从一份检出安装——改这个插件本身时要的就是这种：

```sh
pnpm install && pnpm run build                    # 本地路径安装不会执行 prepare
dsh plugin --profile web add <本包路径>
```

两个半边都在做实事，缺一不可：node 半边发布文档并转接按键，浏览器半边持有注册表并绑定本形态的组合键。没有浏览器的形态下，客户端半边根本不会被拉取；而在没有 Electron 的 `dsh web` 上，浏览器半边就是全部。

移除也是同一种写法：

```sh
dsh plugin --profile web remove @omdsh-plugins/omdsh-shortcuts
```

这一行卸载时，每条开着的流都会收到一份空文档，外壳立刻退回平台自带的菜单，每个页面立刻解绑按键，而不是等到某个已经没人应答的请求之后。

**旁边不用装别的东西，它伸手去够的东西也都不是必需的。** 宿主半边只 inject `webServer`，浏览器半边只 inject `slots`；其余用到的名字——`omdsh-basemode` 的 `sessionModes`，`omdsh-sidepanel` 和 `omdsh-sidechat` 注册的 handler——全是在 `apply` 里面读的，缺了就自己兜底。只装了这个插件的 profile 能组装、能启动：菜单在、每个键都绑得上，只是主人不在场的命令是安静的空操作。反过来也一样——把这个插件拿掉的 profile 里，`omdsh-sidepanel` 和 `omdsh-sidechat` 都还站着，各自把自己的键拿回去。

## 命令

```sh
pnpm install
pnpm run build       # tsc 出 lib/types，再由 tsdown 打包两个半边
pnpm run typecheck   # 源码与测试
pnpm run test        # vitest
pnpm run harness:local ../../deepseek-harness   # 对着一份 checkout 编译
pnpm run harness:npm                            # 切回提交下来的版本号
pnpm run check:harness-pin                      # 只要还链着就失败
```

## 它从哪里来

从 [`omdsh-desktop`](https://github.com/omdsh-plugins/omdsh-desktop) 拆出，原为 `app/src/menu.ts`。决策记录见 harness fork 的 `legacy/all-in-one` 分支上的 Agent Note `2026-08-13-electron-desktop-application`。

## 已知限制

- **`shell` 那一层只在桌面端。** 那五项都要 Electron 主进程来执行，所以在 `dsh web` 下它们整体不存在——既没有菜单来渲染，也没有哪个组合键能够到任何东西。
- **`session.archive` 没有 Web 键。** `⌘W` 的每一种写法都属于浏览器，加 `Alt` 也一样，所以标签页里它报告为 `unreachable`，而不是绑一个反而会关掉窗口的键。
- **浏览器保留的组合键给不了标签页。** `⌘N`、`⌘T`、`⌘W`、`⌘Q` 永远到不了页面，所以 `webAccelerator` 在挂载时就会拒绝它们。解法是在 Web 端换一个键，而不是想办法绕过去。
- **invoke 路由没有信任围栏。** 它的可达范围就是 webserver 的监听地址，桌面端是回环，`dsh web` 下则未必；要注册破坏性操作的插件应当知道这一点。
- **三个内置命令要走 DOM。** 设置弹窗、它的 Plugins 页和侧栏搜索框没有服务可调，只能靠框架保证的契约来驱动——`data-slot`、frame 自己的折叠属性、无障碍 role。上游改了标记，这个包就得跟着改选择器。
- **挂在 harness 按钮上的提示，是本包要一直跟随的一个地址。** 六个控件靠一条词典 key 或一个 slot id 认出来，而它们都属于本仓库不改的包。上游随时可能改名；一旦改了，提示就此安静——tooltip 退回 harness 自己写的样子，组合键照样能用，但没有任何地方会说明原因。在内置表跟上之前，菜单项上的 `anchor` 就是应急出口。
- **只有已经存在按钮的地方，提示才说得出组合键。** 在当前形态下没有按钮的命令——Fork Session、Archive Session、没装模式插件的组装里的模式段——只能靠菜单和设置表单来教。
- **`items` 属于组装层，不是一个设置项。** 有哪些命令、显示成什么、由谁执行、由哪个按钮来教，都在 profile 的 `cordis.patch.yml` 里改；插件中心提供的是 `bindings` 和 `hints`。往菜单里加一个命令，不是在面板里能做的事。
- **如果本插件挂上时会话列表已经到了，新窗口仍可能先打开上次的会话。** harness 在任何插件运行之前，就从 origin 级 localStorage hydrate `dsh.sessions.current`；本包会尽快清掉那个选择，通常能赶在 history 拉取之前。若组装把本插件拖到第一次 list 快照之后，上一场对话仍会先打开一会儿。
