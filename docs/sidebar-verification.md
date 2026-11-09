# 右侧面板验证

本文保留早期快照面板的验证记录。当前版本已有 Files / Changes 后的 Routing 按钮、实时长轮询状态机和 Usage 趋势图，参见 [最新实时验证](live-routing-verification.md)。

2026-11-09，在官方 Herdr App 0.1.10 Linux 二进制、隔离 Xvfb 显示、独立 `HERDR_APP_HOME` / XDG / `HC_SESSION` 下验证。使用的是默认 `main` 的个人副本 `main-magpie`，只添加右侧面板，没有独立页面导航。

## 结果

- `npm run check` 通过。
- `npm test`：**45 passed，0 failed**（包含新增路由光点和权重数据测试）。
- 源码及安装后的 `magpie-panel` 均通过 `herdr-app check`。
- 既有网页伴侣回归：**6 passed**。首次运行因默认 Playwright Chromium 未安装而失败，使用本机已有 Chromium 重新执行后全部通过。
- 准备公开的文件与 Git 历史经 Gitleaks 8.30.1 扫描，无泄漏发现；未包含 `.env` 或用户的账户参考截图。
- 原生 `herdr-app status` 返回 `errors: []`，没有浮层。
- 真实执行 `install:panel`、`layout.clone`、`attach:panel` 后，面板停靠于中央终端右侧；再次执行挂载返回 already exists，没有重复添加。
- 路由、用量和请求回退详情在原生窗口中展示；通过实际 X11 键盘事件选中请求并用 Enter 展开详情。
- 默认 368px 暗色和 320px 明色均检查了文本、选中状态、滚动区域、对齐和溢出。主题与自带 Files / Changes 的颜色、字体及外框规范一致。
- 实时未配置状态清楚提示服务地址和凭据配置，不显示假请求。
- 路由动效使用实际 Herdr 原生窗口录制为 [GIF](previews/sidebar/routing-motion.gif)，并检查多帧：小光点沿纵向细线移动、进入模型节点、随后到达另一个目的地。数据是 3:1 权重的合成回放，标签明确标为 Demo replay。静态偏好可取消动效。
- `git diff --check` 通过。

测试验证：侧栏详情/返回、隐藏后停止轮询、面板重命名后的可见性识别、安装不覆盖设置或快捷键、拒绝目录穿越/凭据 URL/悬空符号链接，以及挂载只增加右侧块、保留工作区和主题、备份文件、拒绝编辑自带布局、重复执行不增添副本。新增动效测试覆盖策略/权重映射、分组与真实目标过滤、回退顺序、四节点上限、首次历史静态显示、重复观察去重、路径阶段与隐藏/关闭时取消回调。原有远程认证、数据脱敏、响应竞争和超时测试仍通过。

## 发现并解决的宿主行为

最初尝试依靠 `mod.json` 的 `place: right` 自动加入自带 `main`，没有成功。上游 `src/window.rs::sync_folders` 明确跳过对自带布局的结构扩展；重新启动也不会解除此保护。`mod.open` 只打开浮层，同样不适合本需求。

最终步骤使用 Herdr 自身的 `layout.clone` 复制默认布局，再在副本的 `work-body` 行追加侧栏块。原生窗口验证了这个流程。安装文档已移除“只复制 Mod 就会出现在默认布局”的错误假设。

## 原生截图

截图由 `herdr-app shot` 捕获并逐一打开检查；全部数据均为明确标识的合成演示数据，或真实的未配置状态。此轮视觉复查在当前会话内完成，没有派发独立审查代理。没有对 GPUI 代码运行只适用于 HTML/CSS 的检测器。

- [暗色路由侧栏](previews/sidebar/routes-dark.png)：默认工作区、终端和 368px 路由面板同时可见。
- [暗色用量侧栏](previews/sidebar/usage-dark.png)：对齐的用量和模型统计。
- [请求回退详情](previews/sidebar/request-detail.png)：先失败后成功的两个尝试及返回入口。
- [320px 明色侧栏](previews/sidebar/usage-light-320.png)：跟随 Herdr 明色主题，统计在窄宽度下完整显示。
- [320px 明色路由动效区域](previews/sidebar/routing-light-320.png)：平铺节点、细线和主题光点。
- [关闭动效](previews/sidebar/routing-static.png)：实际点击 Motion off 后保留静态目标。
- [未配置状态](previews/sidebar/unconfigured.png)：无伪造数据，提示连接设置。

截图中右下方的更新提示来自 Herdr 宿主，不是本面板内容。来源记录见 `previews/sidebar/provenance.json`。

## 未完成的环境验证

用户尚未提供目标 Magpie IP/主机名、Web 端口及本地配置的访问密钥，尚未验证其实际远程服务连接。远程适配器已通过源代码确认的接口结构和带认证的本地 HTTP fixture 验证。目标桌面应按其 Herdr 版本再次运行 mod check；macOS、Windows 与完整屏幕阅读器验收未运行。
