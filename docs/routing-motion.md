# 实时 Routing：从 Magpie 源码移植

本轮直接阅读本地 Git 仓库 `/root/.x-repo/github.com/yetone/magpie`，固定提交 **`cd0ba05c216c924ef7f962c25111c0293814b45b`**，将 Routing 的实时协议和请求动画状态机适配成原生 Herdr Mod。

![Herdr 实时 Routing 原生录屏；演示服务的动态 trace](previews/live-routing/live-routing.gif)

## 对应源码

| Magpie 本地源码 | 移植内容 |
| --- | --- |
| `internal/gui/assets/plugins/routing/client.js`：`poll()` | `seq` 游标长轮询、首次加载、隐藏后追赶、网关身份切换 |
| 同文件：`play()`、`home()`、`stopPlays()` | 发送、等待、成功返回、失败返回、继续下一次尝试、取消 |
| `internal/gui/trace.go` | `/api/gateway/trace?after=…&wait=1`，最多等待 25 秒 |
| `internal/gateway/trace.go` | route/try 的 `done`、`seq`、`ids`、`by` 等协议字段 |
| `internal/gui/assets/plugins/usage/page.js`：`renderUsage()` | 周期选择、缓存计入开关、输入/输出堆叠趋势、模型和 Agent 用量 |
| `internal/gui/assets/app.js`：`cacheHitOf()` | 从分母排除缓存信息未知的请求，避免夸大命中率 |

许可证和原作者声明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 实时数据链路

Herdr → 本机桥接 `/api/routing` → Magpie `/api/gateway/trace`。每次响应合并变化并推进 `seq`，随后立即建立下一次长轮询。该链路独立于 Usage/配置的十秒刷新，不再用快照回放模拟实时路由。

首次加载只播放尚在进行的请求，已结束的历史进入列表。隐藏 Routing、切换 Files/Changes/Usage、查看详情或暂停后，不再发起新的 trace 请求；已经等待中的一次请求最多再存活至其超时。Herdr 0.1.10 的 fetch 没有 AbortSignal，因此不宣称隐藏时能立即取消宿主内已有的网络请求。桥接会在客户端连接关闭时取消它的上游请求。

再次显示面板时读取隐藏期间的变化，只恢复尚未结束的请求。`ids` 清理已被网关丢弃的未完成记录；网关重启或更换进程时清空游标并读取完整 trace。连接错误明确显示，约三秒后重试。若本机桥接的 fetch 卡住超过 35 秒，会停止自动积累请求，提示手动 Refresh。

## 光点状态

1. **Selecting**：请求到了路由器，尚未收到选中的模型。
2. **Sending**：沿公共细线下行，再进入实际尝试的模型节点。
3. **Held**：光点停在模型处，轻微明暗变化，直到该 attempt 的 `done` 变为 true。
4. **Success**：等待整个 route 的 `done`，再沿线返回路由器并清理光点。
5. **Failure / fallback**：光点以失败颜色返回路由器；只有上游增加下一次实际尝试时才再次出发。重试等待不会被本地定时器伪造。

动画保留 Magpie 的生命周期语义，视觉压缩为平铺模型节点和小光点。为适合窄侧栏，线路分段使用 240ms 纵向和 180ms 横向原生 transition，移除鸟形和多层账户树。等待状态用原生 opacity loop；没有 JavaScript 逐帧绘图。

最多同时显示四个光点和四个模型目标，其他请求保留在列表。默认跟随最新请求的路由组；点击组可固定查看，**Follow live** 恢复自动跟随。直接调用提供商的请求归入 Direct requests。权重模式展示配置的成员权重，但不在客户端重新运行调度算法。

**Motion off** 保留静态线路与目标高亮，可按实例持久化；`config.js` 的 `motion: false` 可设为默认。Herdr 0.1.10 未暴露系统减少动态效果偏好，因此使用明确开关。

## Usage

沿用 Magpie 的 Today / 7 days / 30 days / All time、With cache / Without cache、缓存命中率、输入/输出堆叠趋势与 Models / Agents 维度。缓存命中率为 `cache_read / (input + cache_read + cache_write - cache_unknown)`；缺少必要字段时显示未知。

为适应侧栏，趋势最多聚合成 28 根柱，保持计数之和；完整周期总量来自独立汇总 API。未定价调用明确提示，成本不当作订阅账单。账户凭据、提示词、原始错误和归档请求体不转发到 Mod。

## 验证范围

动态演示端点按 trace 协议持续产生 Selecting → Pending → Failure → Retry → Success 的状态，经过同一桥接、Herdr fetch 和原生状态机。原生 GIF 是该动态流的录屏，不是固定路线的 Replay。实际服务 IP/Web key 尚未提供，因此不宣称已验证用户的远端实例。测试和截图细节见 [实时验证记录](live-routing-verification.md)。
