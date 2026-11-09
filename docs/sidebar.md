# Magpie：Herdr 右侧侧边栏

在 Herdr 默认工作区右侧添加一个原生 Magpie 面板。默认宽度 **368px**，左侧空间列表与中央终端继续保留。面板内切换 **Routes / Usage**。Herdr 保护自带布局，因此先复制 `main` 为 `main-magpie`，再仅在其右侧添加面板；界面结构和主题沿用默认工作区。

外观对照 Herdr 自带 Files / Changes 面板：42px 标题栏、13px 正文、14px 内容边距、10px 外框圆角、7px 列表选中圆角，以及细主题边框。背景、文字、选中、悬停和状态色全部读取 `theme()`，字体继承 Herdr。面板跟随用户明暗主题，没有固定的品牌配色。

## 安装

在运行 Herdr 窗口的电脑上，从仓库根目录执行：

```sh
npm run install:panel
herdr-app check ~/.config/herdr-app/mods/magpie-panel
herdr-app do layout.clone --name main --as main-magpie
npm run attach:panel
```

`install:panel` 添加 `mods/magpie-panel/` 中的 `main.js`、`routing.js`、`config.js`、`mod.json`，同名目录会被拒绝。`layout.clone` 是 Herdr 自带命令，复制并切换到默认布局的个人副本，保留原有窗口外观。`attach:panel` 只向该副本的 `work-body` 添加一个右侧块，并备份修改前的 JSON；已有同名面板时不会重复添加。

已存在 `main-magpie` 时跳过克隆命令，使用 `herdr-app do layout.switch --name main-magpie`，然后执行 `attach:panel`。安装过程不修改自带 `main`、设置、快捷键或 Magpie 路由。

实测 Herdr 0.1.10 不会向自带布局自动停靠新 Mod，因此不能只复制目录，也不要用 `mod.open`（它打开浮层）。上述显式挂载步骤已经在原生窗口验证。

可指定配置目录、面板名、宽度或本地桥接端口：

```sh
npm run install:panel -- --home /path/to/herdr-app --name my-magpie --width 400 --endpoint http://127.0.0.1:14317/api/dashboard
```

挂载时匹配相同的参数，例如 `npm run attach:panel -- --home /path/to/herdr-app --layout main-magpie --name my-magpie --width 400`。`HERDR_APP_HOME` 同样有效。`--endpoint` 是**本地桥接**地址；运行中的 Magpie 服务地址配置在桥接 `.env`，两者不要混淆。安装后的 `config.js` 可用于更改桥接地址；其中不包含 Magpie 凭据。

## 连接指定 IP 的 Magpie

桥接需要 Node.js 22 或更新版本，运行时没有第三方依赖。将 `.env.example` 复制为 `.env`（已有则编辑），配置：

```dotenv
MAGPIE_WEB_URL=http://<MAGPIE_SERVICE_IP>:3430
MAGPIE_WEB_KEY=<WEB_SERVICE_ACCESS_KEY>
PORT=4317
```

然后在运行 Herdr 窗口的电脑上执行：

```sh
npm start
```

`MAGPIE_WEB_URL` 要使用你的 Magpie **Web 服务**实际地址和端口，通常为 3430；模型网关通常为 3425。`MAGPIE_WEB_KEY` 是 Web 服务访问密钥，不是模型网关 Bearer key。密钥仅留在 `.env` 与桥接进程中；`.env` 已被 Git 忽略。反向代理或 SSH 转发改变端口时，设置 `MAGPIE_WEB_COOKIE_PORT` 为 Magpie Web 进程实际监听的内部端口。

桥接只监听本机回环地址，使用固定配置的远端，仅发出 GET 读取请求。远端记录不会与本机路由历史混合。跨不可信网络时使用 HTTPS 或 SSH 转发。

## 面板内容

- **Routes**：路由分组、策略和最多四个平铺模型节点。小光点沿细线到达实际观察到的模型，权重模式标出成员权重；Replay 明确回放历史，Motion off 保留静态指示。最近 24 小时内最多 40 条可见请求，点击后进入面板内详情，查看模型、提供商、耗时、token、回退和尝试记录，再点击 Back to requests 返回。详见 [路由动效](routing-motion.md)。
- **Usage**：Today、7 days、30 days、All time；请求数、错误数、输入/输出、缓存 token、Magpie 报告的 USD 成本，以及最多 20 个模型的统计。总量来自汇总 API，与最近请求样本独立。缺失值为 `—`，真实的零保持为零。
- **刷新与状态**：显示服务地址、连接状态、最后更新时间；每 10 秒刷新，可暂停或手动刷新。路由分组配置最多缓存 30 秒。断连保留带时间标识的旧数据；部分接口不可用会提示。隐藏面板停止自动读取，重新显示后在下一次定时回调恢复。
- **Demo**：仅在主动选择时展示明确标识的合成数据，默认连接实时服务。

按钮支持 Tab 和 Enter/Space。面板有焦点时，G/U 切换路由/用量，R 刷新，Space 暂停，D 切换演示，1–4 切换用量周期，↑↓ 选择请求，←→ 选择分组，Enter 展开详情，Esc 返回。快捷键不占用终端的全局按键。

底层 API、数据字段和认证方式见 [接口与连接说明](layout.md#verified-apis)。旧的 `install:layout` 是整页版本，本次侧边栏安装使用 **`install:panel`**。

## 验证

安装后运行 `herdr-app check`，再在 Herdr 中确认右侧位置、主题和服务连接。原生截图与本轮测试结果见 [侧边栏验证](sidebar-verification.md)。截图均为演示数据，真实服务地址和访问密钥仍需配置。
