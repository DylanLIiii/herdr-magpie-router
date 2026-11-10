# Routing：Herdr 右侧实时面板

在 Herdr 标签栏的 **Files、Changes 右侧**增加 **Routing** 按钮。点击打开实时路由/用量面板，再次点击关闭；Files、Changes 和 Routing 共用原有右侧区域，中央终端保持可见。

样式继承 Herdr 默认主题，与 Files / Changes 使用相同的标题栏、字体、边框和选中状态。面板默认约 368px，支持拖动调整和明暗主题。实时路由、供应商额度和 Cost 统计以 Magpie 本地源码为依据，详见 [实现来源与语义](routing-motion.md)。

## 安装

在运行 Herdr 窗口的电脑上，需要 Node.js 22 或更新版本。在仓库根目录执行：

```sh
npm run install:panel
herdr-app check ~/.config/herdr-app/mods/magpie-panel
herdr-app do layout.clone --name main --as main-magpie
npm run attach:panel
herdr-app check ~/.config/herdr-app/mods/magpie-panel-tabs
```

然后点击标签栏的 **Routing**。

Herdr 保护自带布局与 Mod，故 `layout.clone` 创建默认工作区的个人副本。`attach:panel` 读取目标机器安装的 `mods/tabs`，复制为 `magpie-panel-tabs`，仅增加 Routing 按钮和面板状态记忆；自带的标签拖动、窗口按钮及 Files/Changes 行为继续保留。

面板放入原有 `panel-body` stack。已经安装早期独立右侧栏时，挂载脚本会移除副本中该 Mod 的旧侧栏块，再加入同一个面板栈，避免重复。它先备份个人布局，保留原有主题、Files/Changes 状态、设置与快捷键。再次执行不会重复插入 Routing。

如果 `main-magpie` 已存在，跳过 clone，使用 `herdr-app do layout.switch --name main-magpie`。如果个人标签栏已被你修改，脚本会拒绝覆盖；可以为新安装选择另一个名称与新的布局副本。

## 从旧版本升级

旧 Mod 安装器默认拒绝覆盖，便于保留本地配置。最稳妥的方法是在更新仓库后安装一个新名称：

```sh
git pull
npm run install:panel -- --name magpie-routing
herdr-app check ~/.config/herdr-app/mods/magpie-routing
herdr-app do layout.clone --name main --as main-routing
npm run attach:panel -- --name magpie-routing --layout main-routing
herdr-app check ~/.config/herdr-app/mods/magpie-routing-tabs
```

重启本地 Node 桥接，以加载当前的 `/api/routing`、`/api/allowances` 和 `/api/connection` 端点。旧布局可以继续保留，确认新版本后再自行整理。

## 自定义安装位置

```sh
npm run install:panel -- --home /path/to/herdr-app --name my-routing --width 400 --endpoint http://127.0.0.1:14317/api/dashboard
npm run attach:panel -- --home /path/to/herdr-app --layout main-magpie --name my-routing --width 400
```

安装和挂载均支持 `HERDR_APP_HOME`。桥接 URL 写入安装后 `config.js`，面板仅通过布局显式挂载，不会自动在其他个人布局里再停靠一个副本。原有面板宽度被保留，首次缺省时使用传入宽度。对已运行的布局可用 `herdr-app do layout.resize --id panel --px 400` 调整。

## 连接 Magpie 服务

在 **Routing → Settings** 中填写地址和 Web access key，选择 **Test connection** 检查，之后 **Save & connect** 保存并立即连接。Key 只保存在桥接的私有配置中；重启会恢复，界面不回显原值。无需因修改连接而重启。详见 [连接设置](connection.md)。

也可以用 `.env` 作为首次配置，保存的连接设置会优先于环境值。将 `.env.example` 复制为 `.env`（已有则编辑）：

```dotenv
MAGPIE_WEB_URL=http://<MAGPIE_SERVICE_IP>:3430
MAGPIE_WEB_KEY=<WEB_SERVICE_ACCESS_KEY>
PORT=4317
```

然后运行：

```sh
npm start
```

`MAGPIE_WEB_URL` 是远程 Magpie **Web 服务**的实际地址和端口，通常为 3430；模型网关通常为 3425。Web key 与网关 Bearer key 不通用。密钥只持久化在桥接的私有配置文件或可选 `.env` 中；已存密钥不返回给 Mod。Git 忽略 `.env` 和 `connection.json`。

地址支持反向代理前缀，例如 `https://magpie.example/mac/`，所有 API 将请求 `/mac/api/...`。更改路径前缀也视作更换服务，需要新 Key。反向代理/SSH 转发改变端口时，设置 `MAGPIE_WEB_COOKIE_PORT` 为 Magpie Web 进程实际监听的内部端口。跨不可信网络使用 HTTPS 或 SSH 转发。本项目不更改服务监听、路由或认证设置。

桥接监听本机回环地址，只读取固定配置服务。实时 trace 使用带游标的长轮询；Cost 约十秒刷新，订阅 Usage 显示时约三十秒读取，分组名称有最多三十秒缓存。隐藏或切换到 Files/Changes/Usage/Cost 后停止建立新的 trace 请求；再次显示只恢复未完成请求的动画。旧版本若没有 trace 接口，会明确显示实时路由不可用，不用快照回放冒充实时数据。

## 内容与操作

- **Routes**：自动跟随所有请求，以 Client → 组 → 模型展示最多四个并发光点。成功、失败、回退、取消有各自的状态标记和收尾；更多请求保留在列表。没有分组选择器和 Following 开关。
- **Usage**：供应商报告的订阅/计划剩余额度、余额和重置时间；同服务多个账号分别展示。未知数据不显示成 100%，旧读数明确标记。
- **Cost**：`Today / 7 days / 30 days / All time`，缓存计入选项、缓存命中、带图例的输入/输出趋势，以及 Models/Clients 分项。
- **请求列表**：独立滚动并使用剩余高度，最多 80 条。直接显示 Client、组、模型、结果、耗时、输入/输出和缓存命中。点击详情可看供应商、首 token、缓存读写和尝试记录。
- **Settings**：地址、Key、内部端口和 Motion 开关。Motion 默认 On；关闭后继续读取数据、显示静态状态。
- 初次连接使用骨架屏；真实失败后提供恢复入口。主视图不展示服务 URL、重复 Connected 或说明段落。Demo 和 Pause 已移除。

Tab 与 Enter/Space 操作控件。面板有焦点时：G/U/C 切换 Routes/Usage/Cost，R 刷新，Cost 内 1–4 选择周期，↑↓ 选择请求，Enter 详情，Esc 返回；没有新增全局终端快捷键。

安装后的模块包括 `main.js`、`routing.js`、`live-routing.js`、`usage.js`、`connection.js`、`presentation.js`、`icons/`、`config.js`、`mod.json`。个人标签栏复制了安装版本自己的资源和许可证。实际源代码端点、版权和适配差异见 [第三方声明](../THIRD_PARTY_NOTICES.md)。
