# Magpie 原生路由观察台

从空文件夹构建一个真正的 Herdr GPUI JavaScript Mod，用于观察 Magpie 模型路由。界面使用简洁中文，不嵌入网页、iframe、DOM 或 CSS，不执行路由、不编辑配置，不展示密钥、原始提示词或原始响应。错误尝试只显示失败标记，不直接展示其 error 字段。

## 文件与接入

创建 main.js，默认导出继承 gpui-kit 的 View 的类；使用 gpui-kit 的 div、gpui-base 的 h_flex/v_flex 和 herdr 的 theme。创建 mod.json，内容为 { "place": "right", "size": 400 }。不创建 layouts 文件夹，不改用户布局或 Herdr 配置。preview.png 如随包提供，是另行生成的网页伴侣预览，不是原生 GPUI 截图，也不是运行依赖。

init(props, cx) 默认 mode=live，endpoint=http://127.0.0.1:4317/api/snapshot；允许 props.endpoint 指定完整快照接口地址。通过原生 global fetch 请求，保留其他查询参数并替换 mode 参数。演示和实时分别请求 mode=demo 和 mode=live；不要在 Mod 内编造演示数据。服务端负责提供明确标记的数据源。

快照结构：{ mode, connection, updatedAt, source: { label, detail }, error, requests, providers, groups }。requests 的每项包含 id、timestamp、group、requestedModel、model、provider、status（success/error/pending）、durationMs、ttftMs、inputTokens、outputTokens、fallback、attempts；attempts 包含 provider、model、status、durationMs、error。providers 包含 id、name、status、requests、errors。groups 为数组，当前面板通过请求中的 group 展示分组。

## 行为

首次打开立即获取；cx.timer.every(5000, callback) 轻量轮询。所有异步工作在 cx.spawn 中执行，每个回调使用自己的 cx，不保留上下文，不使用浏览器定时器。正常请求串行。读取期间点击刷新只排队一次；切换模式立即清除旧模式数据，旧响应不覆盖新模式，完成后串行获取新模式。看门狗在同一个轮询中检查 15 秒期限，超时后增加请求代次、释放加载状态、明确警告并暂停自动轮询；允许手动重试，忽略旧请求迟到的成功、失败与 finally 状态。GPUI fetch 不支持 signal/timeout 参数，不能伪称取消底层网络请求，超时重试可能暂时重叠。暂停停止后续自动轮询，当前请求可以完成；暂停时仍可手动刷新。继续后立即刷新。隐藏面板按 Herdr 生命周期继续轻量轮询。

验证返回的 mode 与三个数组字段。HTTP 503 仍可携带有效的未配置快照，应展示其 source/error，而不是丢弃。其他 HTTP 错误、网络异常和格式错误显示简洁错误与本机桥接检查提示。同模式刷新失败时保留最近成功快照，清楚标注数据状态和更新时间。缺失指标显示“—”，不用零值冒充数据。首次加载、错误、空列表和暂停均有明确文案。

## 原生外观与信息层次

默认右侧 400 逻辑像素。全高 theme.surface 背景，14px 内边距，紧凑间距；所有颜色来自 theme()，使用 foreground/muted/dim/accent、raised/selected/hover/border 和 done/blocked/working。顶部固定 Magpie 标题、“路由观察台”、实时只读或演示标记；第二行放实时/演示切换、暂停/继续和刷新。底部固定只读说明，中间内容可原生垂直滚动。卡片圆角 7–8px、细边框，正文 11–12px、标题 17px；不强制暗色。

中间显示数据源、中文连接状态和更新时间。最新请求按时间降序，仅显示 16 条，默认选中最新一条，刷新保持选中项直到它离开窗口。选中项详情置于列表前，以独立键值行展示请求分组、实际模型和提供商，显示是否回退、请求模型、耗时/首字耗时、输入/输出 token、数据源返回的每次实际尝试。没有 attempts 时明确说明未提供，fallback 为 null 时显示“回退情况未知”。请求卡片显示实际模型、成功/失败/进行中、分组与提供商、时间、耗时和输出 token。最后展示提供商状态与服务端统计；不从最新 16 条推断全局统计。长模型名和来源文本用字符串截断。每个可点击和可滚动原生元素先设置唯一 id。

## 安装与验收

先阅读目标机器上实际安装的 ~/.config/herdr-app/AGENTS.md 及相关默认 Mod，再按其版本指南安装。可手动把整个 magpie-router 文件夹复制至 ~/.config/herdr-app/mods/magpie-router；首次发现时依 mod.json 右侧停靠，后续位置由现有布局决定。不要覆盖已有同名目录而不先检查。原生渲染无需网页伴侣。

目标机器必须运行：

```sh
herdr-app check ~/.config/herdr-app/mods/magpie-router
```

每次修改后重复。开发目录也可运行 herdr-app check <folder>。该命令应成功加载和渲染 Mod；再手动验收主题切换、实时/演示、暂停/刷新、未配置 503、服务离线、无请求、回退详情和滚动。

已使用校验过 SHA-256 的官方 Herdr App 0.1.10 临时发布包，在独立 XDG 配置目录通过 `herdr-app check`，证明初始加载与渲染。没有原生截图或完整异步操作的人工验收；不能将网页预览当作 GPUI 截图。目标安装机器仍应阅读自己的指南并执行原生检查。

桥接服务仅监听 loopback，并校验 Host。原生 fetch 预计不发送浏览器 Origin；不要要求必须携带网页 Origin 而误拒绝 GPUI 请求。桥接负责清理 error/source 文本中的敏感信息，面板不会读取请求原文或密钥。
