# omdsh-shortcuts

[English](README.md) | 中文

用一份文档，为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 能做的任何事绑定组合键——两种形态都算。

挂载这个插件，菜单出现、一组键开始生效；卸载它，两者一起消失；改它的配置，两者就地重建。这些都不需要重新构建或重启桌面外壳，也都不是对 harness 的改动。

## 它提供什么

| 界面 | 从哪来 |
|---|---|
| 桌面外壳的原生菜单，以及上面的每一个加速键 | `GET /api/desktop/menu` 提供的那份文档，并在每次修订时经 `GET /api/desktop/menu.events` 再推一遍 |
| 一次原生按键，送达真正在前台的那个页面 | 外壳 `POST /api/desktop/menu.invoke`，再经 `GET /api/desktop/shortcut.events?client=<id>` 下发给最近报告过焦点的客户端 |
| Web 端的页内组合键——那里没有菜单来认领它们 | 浏览器半边自己的按键监听器，按同一份文档绑定本形态的组合键 |
| 运行时和页面里都有的 `shortcut` 服务 | 两个半边各自 `ctx.reflect.provide('shortcut', …)`：`register`、`bindings()`、`onBindings`、`chordLabel` |
| 十五个界面命令里的十二个，由它执行 | [`src/client/builtins.ts`](src/client/builtins.ts)，调用 `layout`、`sessions`、`workspaces` 和 `sessionModes`——另外三个属于拥有它们的插件 |
| 插件中心里的改键表单 | `omdsh-shortcuts` 这个 settings 命名空间：一张扁平的 `id → 组合键` 字典，即时生效 |

## 核心想法

一次按键要从键盘所在的地方出发，到命令真正住着的地方结束，而这是三个不同的地方：

| `command.kind` | 由谁执行 | 怎么到达 |
|---|---|---|
| `shell` | Electron 主进程 | 原生菜单加速键 |
| `runtime` | 宿主插件，在 Node 运行时里 | 本插件的交换机 |
| `browser` | UI 插件，在页面里 | 本插件的浏览器半边 |

插件只说自己**能做什么**。哪个组合键能够到它——或者在当前形态下究竟有没有键——是配置。于是想让 `⌘L` 唤出侧边输入框的人只需要改一份文档，而不必去翻是哪个插件把键写死了。

## 两种形态，一份文档

同一个运行时会同时服务桌面窗口和浏览器标签页——用一次「在浏览器中打开」就正好造出这一对——而两者听键的方式并不相同。

```
  Web 端    ⌘K ─→ 本页面的监听器 ────────────────────→ handler
  桌面端    ⌘K ─→ Electron 菜单 ─→ 运行时 ─→ 本页面 ─→ handler
```

桌面端的组合键是在页面存在之前就被原生认领的，所以一次按键要走完全程：外壳把 id POST 给运行时，运行时再把它交给当前在前台的浏览器客户端。Web 端没有菜单也没有原生认领，页面自己听见自己的按键、自己跑自己的 handler，谁也不用问。

这个差别不是配置项，所以绑定也并非总能通用。**浏览器把 `⌘N`、`⌘T`、`⌘W`、`⌘Q` 留给自己**——页面根本不会被问到，`preventDefault` 也没有东西可拦。`CmdOrCtrl+N` 给 `new-window` 当原生绑定完全没问题，而标签页永远拿不到这个键。

`webAccelerator` 就是允许两者各说各话的地方：

| `webAccelerator` | Web 端的效果 |
|---|---|
| 不写 | 与 `accelerator` 同一个键 |
| 写字符串 | 改用这个键 |
| 写 `null` | 这里完全不绑键；菜单项还在，鼠标仍可达 |

**在 `webAccelerator` 里写一个浏览器保留键，是挂载时报错**，而不是一个默默什么都不做的键：在标签页里要 `⌘W`，是一个页面根本无法兑现的请求，拒绝它是唯一诚实的回答。而只写了原生 `accelerator` 则不算错——Web 端只是把这条绑定报告为 `unreachable`，设置界面可以据此显示「仅桌面端」。

## 它持有的路由

通过 `webServer` 服务上的 `ctx.effect` 注册，所以卸载插件就会移除它们，外壳退回平台自带的菜单底座。

| 路由 | 谁读它 |
|---|---|
| `GET /api/desktop/menu` | 任何人；文档，读一次 |
| `GET /api/desktop/menu.events` | 外壳；连接时给文档，此后每次修订都推 |
| `POST /api/desktop/menu.invoke` | 外壳，把自己不执行的项交回来 |
| `GET /api/desktop/shortcut.events?client=<id>` | 浏览器客户端；绑定表，以及它自己听不见的那些按键 |
| `POST /api/desktop/shortcut.focus` | 浏览器客户端，声明自己在前台 |

外壳的流和客户端的流是刻意分开的。外壳那条流的载荷是一个裸文档，这是每一个已发布的桌面端构建都在解析的形状；给它加帧以便同时承载调用，会让所有已安装外壳的菜单栏变空。

## 桌面端的一次按键给谁

给最近一次报告获得焦点的那个客户端。客户端通常不止一个——多个窗口、多个标签页，或者两者同时连着同一个运行时——而「人正在看的那个界面」是唯一永远正确的答案。

焦点是**上报**的，不是推断的，因为别人都看不见：外壳知道被按的菜单属于哪个窗口，但[它的窗口刻意不带 preload、保持沙箱](https://github.com/omdsh-plugins/omdsh-desktop/blob/HEAD/app/src/windows.ts)，因此没有任何通道能通到页面里；而一个 HTTP 请求完全说不出人的注意力在哪。所以由页面自己说，并且持续地说。

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

`shell` 只能命名主进程会执行的那套固定词汇——`new-window`、`restart-runtime`、`reveal-log`、`open-in-browser`、`toggle-idle-suspend`。这份清单是契约里唯一插件扩不了的部分，因为扩它意味着发一个新的 Electron 构建。凡是用户可以随意绑定的，都是 `runtime` 或 `browser`。

`checkbox: true` 的项会渲染成复选框，但它的状态属于外壳而不属于这份文档：外壳在构建菜单项时读自己存的设置，所以重建不会让勾选状态和它所描述的东西对不上。

以下情况在挂载时就拒绝，而不是照样发布：两项共用一个 id、两项争同一个原生组合键、两项在页面里绑同一个键，以及 `webAccelerator` 写错了或写了浏览器保留键。

## 注册一个命令

在运行时里，注册 `runtime` 命令。服务按名字解析而不是用环境里的 `ctx.shortcut`，因为本包两个半边编译成同一个程序，而只有浏览器半边扩展了 cordis 的 `Context`：

`shortcut` 要在 `apply` 里面拿，绝不能写进顶层 `inject`：本插件在不在 profile
里，是使用者一条条 `dsh plugin add` 装出来的；而 cordis 对被注入的服务无限期等
待，所以顶层写了它的 entry 会一直停在 `pending`，两道启动审计会把**整个页面**判
失败。在 `apply` 里启动的 fiber 不是 loader entry，等多久都没有代价。

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

把 effect 挂在 `sctx` 而不是 `ctx` 上，这样本插件在运行时被卸载时，注册也会随之
撤回。

注册并不认领任何键。文档里从未声明的命令照样能注册，只是永远不会触发——对于挂在一份没提到它的配置上的插件来说，这正是正确的结果。`ctx.shortcut.bindings()` 会报告每个命令在当前形态下的真实状态，包括哪些在这里没有键、以及为什么；`ctx.shortcut.onBindings(fn)` 在每次文档修订后回调，所以**要把组合键显示出来**的界面（tooltip、设置行）能跟着改绑走，不用刷新。

注册要挂在一个**受限 fiber** 上，而不是写进插件自己的 `inject` 列表——否则一个没有键盘层的组装会连功能本身一起失去，而不只是失去它的快捷键：

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

三件事由 `chordLabel` 一并处理，所以没有哪个界面需要自己重做：

- **拼法按平台走**——mac 上是 `⇧⌘E`，别处是 `Ctrl+Shift+E`。`CmdOrCtrl+Shift+E` 是**线上拼法**，把它原样印出来是在教配置格式，不是在教按键。
- **形态说了算**——桌面端显示原生键 `⌘1`，标签页里显示 `⌥⌘1`，因为那才是各自真正能收到的键。
- **没有键就返回 `undefined`**——所以 tooltip 落回纯标题，而不是留一个后面什么都没有的分隔符。浏览器占走了键的那些命令，在标签页里就是这个状态。

配合 `onBindings` 使用：文档是推下来的，所以第一次读通常是空的；改绑之后也要跟着变。仓库里 `omdsh-sidepanel` 的两个面板开关、`omdsh-chatmode` 与 `omdsh-codemode` 的模式段都是这么做的。`omdsh-sidechat` 的召唤图标走的是更下面一层的路——它自己读 `bindings()` 再把 claim 格式化出来，因为它要知道的是这个键**由谁**持有，而不只是怎么把它印出来。

harness 自己的按钮（New Session、搜索、添加工作区、设置、折叠侧栏）不在其中：它们的 tooltip 组件在本仓库不改的包里。桌面端这些键本来就写在菜单栏上。

已经自己绑了键的 UI 插件，把键让出来即可——`setSummonChord(null)` 就是这个协议——然后改为注册一个命令。这样一来，不存在两个 handler 抢同一次按键的情况。仓库里有两个现成的例子：

- [`omdsh-sidepanel`](https://github.com/omdsh-plugins/omdsh-sidepanel/blob/HEAD/src/client/shortcut.ts) 把两个面板交出来。它本来就没绑键，所以只是注册。
- [`omdsh-sidechat`](https://github.com/omdsh-plugins/omdsh-sidechat/blob/HEAD/src/client/shortcut.ts) 交出的是一个**已经在用的**键。它在受限 fiber 里 `setSummonChord(null)` 并注册 `sidechat.open`，然后用 `onBindings` 把文档给这个命令的键读回来喂给 tooltip——交出按键不该意味着不再教人按什么。fiber 卸载时它把内置的 `CmdOrCtrl+L` 还回去，所以移除键盘层不会顺手把召唤功能一起移除。

## 默认项

### 外壳层：`shell` 命令

| 项 | id | 组合键 | 分区 |
|---|---|---|---|
| New Window | `new-window` | `CmdOrCtrl+N` | file |
| Restart Harness Runtime | `restart-runtime` | `CmdOrCtrl+Alt+R` | view |
| Open in Browser | `open-in-browser` | `CmdOrCtrl+Shift+O` | view |
| Reveal Runtime Log | `reveal-log` | `CmdOrCtrl+Shift+L` | view |
| Release Memory When Idle | `idle-suspend` | `CmdOrCtrl+Alt+M` | app |

改键时写的是 id，而 `idle-suspend` 是唯一一个和它的命令名不一样的：菜单项是 `idle-suspend`，它向外壳要的那个能力叫 `toggle-idle-suspend`，它也是这一组里唯一的复选框。

五项全是 `shell` 命令，所以五项全都只在桌面端有效：标签页里没有 Electron 可供组合键抵达。三个层级是让这份映射好记的原因——单修饰键是标准窗口操作，`Shift` 通向外壳的界面或目的地，`Alt` 通向运行时进程，也就是 Electron 自己放开发者工具的那一层。整份映射刻意避开可打印字符，因为窗口里的 harness 界面拥有菜单不占用的每一个键——下面这一层花的正是那些键。

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

**Web 端那一列只有一条规则：把 `Shift`（或什么都没有）换成 `Alt`。** 需要换的都是浏览器给自己留的键——`⌘,` 是偏好设置、`⌘O` 是打开文件、`⌘1..3` 是切标签、`⌘⇧B` 是书签栏、`⌘L` 是地址栏、`⌘⇧D` 是全部加书签。`Alt` 是没有哪个主流浏览器花在窗口控件上的一层，[`isReservedByBrowser`](src/chord.ts) 也认这一点：按住它，一个组合键就整个离开保留集合。所以一个修饰键回答了整类冲突，不需要一张按浏览器分列的例外表。

没换的那些——`⌘⇧F`、`⌘⇧E`、``Ctrl+` ``、`⌘⇧K`——在 Chrome、Safari、Firefox 里都能抵达页面，再写一遍只是多一个要记的键。`remdev.connect` 是相反的情形：它的 `⌘⇧C` 正是 Chrome 和 Safari 分配给「检查元素」的键，所以按规则换成 `⌥⌘C`，而不是和浏览器争一个只有部分标签页会让出来的键。唯一完全没有 Web 键的是 `session.archive`：`⌘W` 的每一种写法都属于浏览器，Safari 上连加了 `Alt` 的也是，所以它诚实地只在桌面端有键，而不是绑一个永远不会响应的。

## 内置命令

上表「由谁执行」写着**本插件**的那些，handler 就在这个包的浏览器半边（[`src/client/builtins.ts`](src/client/builtins.ts)）。这与本插件其余部分的姿态相反，值得解释：

大多数界面动作背后都有服务可调——`ctx.layout` 管两侧栏，`ctx.sessions` 和 `ctx.workspaces` 管会话与工作区，`omdsh-base` 的 `sessionModes` 管模式切换。harness 没有为它们注册快捷键，是因为 harness 里根本没有快捷键服务可注册——这个服务是从外面来的。所以调用总得有人发起，而知道「键被按了」的只有这里。

三个例外只能走 DOM：**设置弹窗**、**Plugins 页**、**侧栏搜索框**。它们的开关状态用 harness 自己的话说是 "component-local viewing state"，住在本仓库不会去改的包里。[`src/client/anchors.ts`](src/client/anchors.ts) 写明了为什么这些地址仍然可辩护——用的全是框架保证的契约（每个 slot 出口都会渲染的 `data-slot`、frame 自己的 `data-sidebar-collapsed` / `data-details-collapsed`、以及 `role="dialog"` 这类无障碍属性），而不是 CSS module 的哈希类名、会被本地化的可见文字、或者渲染顺序。唯一绕不开顺序的地方——从设置导航栏里挑出 Plugins 那一行——是从 slot 注册表里读出它的**下标**，所以被匹配的仍然是 id，DOM 只提供位置。

每个 handler 在它要驱动的东西不存在时都是安静的空操作。模式注册表属于 [`omdsh-base`](https://github.com/omdsh-plugins/omdsh-base)，里面的各个段落则来自各个模式插件：没装 `omdsh-base` 就根本没有注册表，`⌘1` 谁也够不到；装了 `omdsh-base` 但没装 `omdsh-chatmode`，注册表只是少了 Chat 和 Work 两段，`⌘1`、`⌘2` 找不到可进入的对象。两种情况下这次按键都该什么都不发生——不抛异常，也不能把整个按键监听器一起带走。

`panel.files`、`panel.terminal`、`sidechat.open` **不在**这个文件里：这三件事有能自己注册的主人，它们就该自己注册。

## 改一个快捷键

配置分成两层，归属不同的人——正是这条分界让第二层可以放进设置面板里改：

| 字段 | 归属 | 在哪里改 |
|---|---|---|
| `items` | 组装层 | profile 的 `cordis.patch.yml` |
| `bindings` | 使用者 | 设置 → 插件 → OMDSH 插件 |

`items` 说的是有哪些命令、显示成什么、进哪个菜单、由谁执行。`bindings` 是盖在它上面的一张扁平 `id → 快捷键` 映射：

```yaml
- id: omdsh-shortcuts
  config:
    bindings:
      open-in-browser: CmdOrCtrl+Shift+B
      reveal-log: ''            # 留在菜单里，但不绑定按键
```

覆盖只替换菜单项的原生 `accelerator`。`webAccelerator` 保持组装层的原样，因为它陈述的是**形态**的事实——"标签页永远拿不到这个键"——而不是关于选了哪个组合键。

**设置面板打开时不是空的。** 注册时交给 settings 的 `base` 里带的是**每个命令当前生效的键**，不是「已经被改过的那些」。理由很实际：一个由裸覆盖映射生成的表单一开始是空的，而空映射在读它的人看来和「这个插件什么都没绑」没有区别。所以面板里坐着的是一张键盘图而不是一张 diff，改键是编辑一行已经在那儿的记录，而不是先猜一个 id 再把它敲进去。

这一层盖回去是恒等的——它本来就是从 `items` 里读出来的——所以播下这颗种子不会让任何一次全新安装和它自己的默认值产生分歧。组装层如果自己写了 `items`，种子就从**那份** items 读，不是从内置的那份读。

映射里出现文档中没有的 id 时会被忽略而不是拒绝：item 列表属于组装层，它会变，一条过期的覆盖绝不能让这个插件挂不上去。而解析不了的组合键**会**被拒绝，在那次写入时就拒绝——因为再怎么改 item 列表，`Ctrl+` 也不会变得合法。

这个插件把 `bindings` 注册为 settings 命名空间 `omdsh-shortcuts`（见 [omdsh 插件约定](https://omdsh-plugins.github.io/conventions/#rule-1)），这就是 [`omdsh-plughub`](https://github.com/omdsh-plugins/omdsh-plughub) 为它生成配置页所需要的全部。这段注册挂在一个受限 fiber 上，因此一个没有 settings provider 的组装照旧按 entry config 运行。

改绑**即时生效**：文档会被重建并推给已经开着的那几条流，于是每个连着的外壳重建原生菜单、每个连着的页面重绑按键，都不需要重启。

## 可达性

invoke 路由没有信任围栏。约束它的有两点：只接受已发布文档声明过的 id，只能跑已挂载插件注册过的 handler。它**没有**约束的是谁可以 POST——这条路由的可达范围就是 webserver 的监听地址，桌面端是回环，`dsh web` 下则未必。要注册破坏性操作的插件应当知道这一点。若要加围栏，接缝是 `webRuntime`，用法见 [`omdsh-sidepanel`](https://github.com/omdsh-plugins/omdsh-sidepanel/blob/HEAD/src/trust-fence.ts)。

## 安装

它是一个 dsh bundle，不是对 harness 的改动。[`cordis.patch.yml`](cordis.patch.yml) 在 profile 已经组装好的东西之上插入一行：

```sh
dsh plugin --profile web add @omdsh-plugins/omdsh-shortcuts
```

或者从一份检出安装，改这个插件本身时要的就是这种：

```sh
pnpm install && pnpm run build                    # 本地路径安装不会执行 prepare
dsh plugin --profile web add <本包路径>
```

两个半边都在做实事，缺一不可：node 半边发布文档并转接按键，浏览器半边持有注册表并绑定本形态的组合键。没有浏览器的形态下客户端半边根本不会被拉取；而在没有 Electron 的 `dsh web` 上，浏览器半边就是全部。

移除也是同一种写法：

```sh
dsh plugin --profile web remove @omdsh-plugins/omdsh-shortcuts
```

这一行卸载时，每条开着的流都会收到一份空文档，于是外壳立刻退回平台自带的菜单、每个页面立刻解绑按键，而不是等到某个已经没人回答的请求之后。

**旁边不需要装别的东西，它伸手去够的东西也都不是必需的。** 宿主半边只 inject `webServer`，浏览器半边只 inject `slots`；它用到的其他名字——`omdsh-base` 的 `sessionModes`，`omdsh-sidepanel` 和 `omdsh-sidechat` 注册的那些 handler——全都是在 `apply` 里面读的，缺了就自己回答。一个只装了这个插件的 profile 能组装、能启动：菜单在、每个键都绑得上，只是那些主人不在场的命令是安静的空操作。反过来也一样——一个把这个插件拿掉的 profile，`omdsh-sidepanel` 和 `omdsh-sidechat` 都还站着，各自把自己的键拿回去。

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
- **浏览器保留的组合键给不了标签页。** `⌘N`、`⌘T`、`⌘W`、`⌘Q` 永远到不了页面，所以 `webAccelerator` 在挂载时就会拒绝它们。解法是 Web 端换一个键，而不是想办法绕过去。
- **invoke 路由没有信任围栏。** 它的可达范围就是 webserver 的监听地址，桌面端是回环，`dsh web` 下则未必；要注册破坏性操作的插件应当知道这一点。
- **三个内置命令要走 DOM。** 设置弹窗、它的 Plugins 页和侧栏搜索框没有服务可调，只能靠框架保证的契约来驱动——`data-slot`、frame 自己的折叠属性、无障碍 role。上游改了标记，这个包就得跟着改选择器。
- **`items` 属于组装层，不是一个设置项。** 有哪些命令、显示成什么、由谁执行，都在 profile 的 `cordis.patch.yml` 里改；插件中心只提供 `bindings`。往菜单里加一个命令，不是一个人在面板里能做的事。
