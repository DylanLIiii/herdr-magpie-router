# 实时 Routing 验证

验证日期：2026-11-09。宿主为官方 Herdr App 0.1.10 Linux，独立 Xvfb 显示、`HERDR_APP_HOME`、XDG 路径与 `HC_SESSION`。用户现有终端和桌面设置未用于测试。

## 源码依据

直接读取本地 Git 仓库 `/root/.x-repo/github.com/yetone/magpie` 的提交 `cd0ba05c216c924ef7f962c25111c0293814b45b`。移植对象是 Routing `poll/play/home/stopPlays`、trace 协议，以及 Usage token/cache/series 算术。参考文件和版权声明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 自动化结果

- `npm run check`：通过。
- `npm test`：**58 passed，0 failed**。
- `npm run test:ui`：**6 passed**，使用本机已有 Chromium。
- 源码面板、实际安装面板、复制修改后的 tabs 均通过 `herdr-app check`。
- `git diff --check`：通过。

新增测试覆盖：

- cursor、gateway epoch、retained IDs、首次加载及隐藏后恢复。
- 光点发送后等到 attempt done；成功另等 route done；失败返回再等真实下一次尝试。
- 最多四个并发光点，关闭/重置清理等待者；没有模型目标时仍显示选择状态；Direct requests 单独匹配。
- trace 投影保留状态但不暴露账户标识、会话、提示词或原始错误。
- HTTP `/api/routing` 的参数验证、游标/长轮询转发和断开客户端时取消上游读取。
- **实际 HTTP 上游 fixture**：请求在网关处保持等待，只有发布下一次状态才返回；使用 Magpie Web cookie 通过真实网络读写链路。
- 缓存计入总量、未知缓存排除、堆叠图聚合、缺失值保留。
- 安装时复制原生 tabs、Routing 排在 Changes 后、保护自带文件、迁移旧侧栏、挂载幂等、拒绝不兼容或被编辑的源文件。

## 原生交互和录屏

在默认 `main` 的个人副本上执行完整安装流程。真实鼠标输入依次操作 Files、Changes、Routing、Routing 关闭；截图验证它们共享同一个右侧区域。没有浮层，中央终端保持可见，`herdr-app status` 为 `errors: []`。

Routing demo 端点持续生成带 seq/done 的动态请求生命周期，经桥接、Herdr fetch、原生状态机呈现。录制 26 秒原生窗口并查看多帧，看到等待在目标、完成后返回消失、失败返回及下一模型接手；未使用历史 replay。

- [Routing 实时视图](previews/live-routing/routes-dark.png)
- [实时生命周期 GIF](previews/live-routing/live-routing.gif)
- [Routing 按钮关闭后](previews/live-routing/closed.png)
- [Files 切换](previews/live-routing/files.png)
- [Changes 切换](previews/live-routing/changes.png)
- [Usage 暗色](previews/live-routing/usage-dark.png)
- [Usage 明色 320px](previews/live-routing/usage-light-320.png)：实际点击 With cache 和 Agents。

这些图片均为真实 Herdr 渲染，使用合成数据；GIF 是原生 X11 窗口录屏裁剪。每张截图已打开检查，动效逐帧复查在本会话内完成，没有独立审查代理。截图右下方的更新通知来自 Herdr 宿主。来源记录见 `previews/live-routing/provenance.json`。

## 限制

用户仍未提供目标 Magpie IP、Web 端口和访问密钥，所以尚未验证用户实际远程服务。现在验证的是源码确认的协议、真实 HTTP fixture 和原生动态 demo 的完整链路。

GPUI fetch 不支持 AbortSignal；隐藏会停止下一次轮询，已经等待的一次请求要到响应或超时才释放。超过 35 秒卡住时停止自动积累并要求 Refresh。桥接读取有 30 秒上限，高于 Magpie 25 秒长轮询。

安装器只支持识别出的 Herdr tabs 模板，遇到改变或个人修改拒绝覆盖。已验证 Linux 0.1.10，未运行 macOS/Windows 桌面和屏幕阅读器审查。Demo 与录屏不代表真实网关吞吐量、模型速度或供应商行为。
