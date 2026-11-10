# Legacy full-page installation

The current requested surface is the native right panel described in [sidebar.md](sidebar.md). The optional page layout is retained for existing installations and uses the same Routes / Usage / Cost implementation.

```sh
npm run install:layout
herdr-app check ~/.config/herdr-app/mods/magpie-dashboard
herdr-app check ~/.config/herdr-app/mods/magpie-navigation
herdr-app do layout.switch --name magpie
```

The installer accepts `--home`, `--name` and `--endpoint`; existing paths are refused. It installs a layout preview SVG, navigation mod, dashboard, presentation helpers and icons. No shipped layout, settings or shortcuts are overwritten.

Start the local Node bridge with `npm start`, then configure the service in **Settings**. Web URLs may include a reverse-proxy path such as `https://magpie.example/mac/`; the normal direct Web port is 3430, while the model gateway is usually 3425. The Web access key and gateway Bearer key are separate credentials. See [connection.md](connection.md).

The page uses the same live-only behavior as the sidebar: automatic following across all groups and direct calls, default-on Motion, vendor allowance Usage, Magpie Cost, skeleton loading, and no Demo or Pause controls. Address details appear only in Settings. G/U/C switches views; R refreshes; Cost supports 1–4 period selection; Up/Down selects requests; Enter opens details; Escape returns.

The retained layout's workspace/page navigation and non-resizable structure are compatibility choices. For the native Files → Changes → Routing toolbar integration, use `install:panel` and `attach:panel` instead.

Source/API details are in [integration.md](integration.md) and [routing-motion.md](routing-motion.md). Historical full-page captures in `layout-verification.md` record the earlier version and are not current UI references.
