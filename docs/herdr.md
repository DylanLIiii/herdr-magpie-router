# Herdr 原生 Mod 接入

当前推荐安装的是支持远程路由与用量、符合 Herdr 默认主题的 [368px 右侧面板](sidebar.md)。本文以下内容仅描述早期 `magpie-router` 400px 面板，保留用于兼容。

mods/magpie-router 是原生 GPUI JavaScript Mod，不是网页嵌入。main.js 默认导出 View，直接使用 gpui-kit、gpui-base 和 herdr 的 theme()。mod.json 首次安装默认右侧停靠，宽度 400 逻辑像素；之后由 Herdr 已有布局控制位置。无需 layouts 文件夹，也不要求修改现有配置。

面板默认实时模式，只读访问 http://127.0.0.1:4317/api/snapshot?mode=live。点击“演示”请求同接口的 mode=demo，并明确标记演示数据。可通过宿主传入 props.endpoint 覆盖接口地址；使用完整快照路径，已有其他查询参数会保留。原生面板没有地址输入框。数据由桥接提供，面板不生成请求或提供商记录。

顶部显示模式、暂停和刷新；主体包含来源、连接状态、更新时间、所选请求的路由详情、最多 16 条最新请求和提供商统计。点击请求查看“分组 → 实际模型 → 提供商”、回退、耗时、首字耗时、token 和实际尝试。未提供的信息显示“—”或明确空状态。失败尝试不直接展示服务端原始错误，避免泄露提示词或凭据；不展示任何原始请求或响应。

每 5 秒用 cx.timer 轮询，cx.spawn 完成 fetch，回调始终使用自己的 cx。正常请求串行；模式切换不会让旧响应覆盖新数据。15 秒应用层看门狗由同一个定时器检测，最晚下一次 5 秒轮询时释放加载状态、忽略迟到结果并暂停自动更新，允许手动重试。Herdr 0.1.10 的 fetch 不接受 signal 或 timeout；看门狗不会取消底层网络请求，重试可能与尚未完成的旧请求短暂重叠。暂停防止自动重试不断累积。暂停时手动刷新仍可用，继续后立即获取。同模式刷新失败保留带更新时间的旧快照。合法的 HTTP 503 未配置快照会继续显示 source 和 error。

## 本机安装

先启动本仓库提供的 loopback 快照桥接，再确认实时数据源配置。桥接监听 127.0.0.1:4317，验证 Host；原生 fetch 预计没有浏览器 Origin，不应仅因缺少 Origin 被拒绝。端点和外部服务配置请按仓库桥接说明执行。

安装前，阅读目标机器上实际安装的 ~/.config/herdr-app/AGENTS.md 和对应版本自带 Mod 示例。确认目标同名目录不存在，或先自行备份已有版本，再手动复制：

```sh
mkdir -p ~/.config/herdr-app/mods
cp -R mods/magpie-router ~/.config/herdr-app/mods/magpie-router
herdr-app check ~/.config/herdr-app/mods/magpie-router
```

以上命令从仓库根目录执行；若已存在同名目标，应先处理旧目录，避免 cp 形成嵌套目录。Herdr 在个人布局中可根据 mod.json 停靠；自带布局受保护，必须先克隆再添加块，详见当前侧栏安装说明。保存文件会触发宿主热重载。这里没有执行复制、修改用户配置或发布操作。

开发时也可以直接检查工作目录：

```sh
herdr-app check /root/projects/herdr-magpie-router/mods/magpie-router
```

原生指南要求每次修改后运行 herdr-app check <folder>。2026-10-31 已下载官方 Herdr App 0.1.10 Linux 发布包，验证 SHA-256 后在临时目录运行，结果为 `check passed`。使用独立的 XDG_CONFIG_HOME/XDG_DATA_HOME，没有安装 App 或修改现有布局。此检查证明初始模块加载和渲染可用，不证明所有异步状态和实际交互均通过。目标机器应按自身版本再次执行。

## 验收与预览边界

在目标 Herdr App 中运行 check 后，人工确认右侧 400px 面板、明暗主题、长模型名、滚动和选中样式。确认实时未配置时展示桥接 source/error，服务离线有错误，空数据没有虚构记录，演示模式明确标记；再检查暂停与手动刷新、快速切换模式、成功/失败/进行中和实际回退尝试。提供商计数来自桥接，不由面板的有限请求列表推算。

仓库网页伴侣和可另行提供的 preview.png 只用于展示视觉方向，是网页伴侣预览，不是 GPUI 原生渲染截图，也不是 Herdr 验收证据。原生 Mod 运行不依赖网页伴侣或该图片。

完整的可重建功能与外观说明见 mods/magpie-router/RECIPE.md。
