# Native Magpie observability in Herdr

The Routing button after Files and Changes opens a native right panel. The terminal stays visible. All UI uses GPUI and Herdr theme tokens; no webview, runtime dependency or bundled font.

![Native panel, synthetic test traffic](docs/previews/redesign/routes-dark.png)

## Three views

- **Routes** automatically follows all clients, groups and direct calls. Up to four stable request lanes identify Client → Group → Model. Native light dots indicate actual request lifecycle. The list takes the remaining height and includes result, timing, input/output and cache hit, with request details on selection.
- **Usage** shows vendor subscription allowances and reset times from `/api/usage/quotas`. No inference from Magpie costs, no summing overlapping windows. Separate provider accounts get anonymous ordinal labels.
- **Cost** contains Magpie's period totals, cache inclusion, cache hit, input/output stacked chart with legend, and Models/Clients breakdown.

Default Motion is on; the preference lives in Settings. No group selector, Follow button, Demo, Pause, repeated Connected badges or main-view service URLs. Initial requests retain skeletons while pending. Confirmed errors provide recovery without fabricating data.

## Connection

Settings accepts HTTP(S) service base URLs, including reverse proxy prefixes such as `/mac/`. Every API path is appended beneath that prefix. Query strings, fragments and embedded credentials are rejected. Blank key reuses the saved value only for the same normalized origin and prefix.

Test reads Routing, Groups and Cost without saving. Save atomically persists a private 0600 local file and swaps the bridge source. Old responses cannot overwrite the new service; secrets never return to the UI. See [connection details](docs/connection.md).

## Install

```sh
npm run install:panel
herdr-app check ~/.config/herdr-app/mods/magpie-panel
herdr-app do layout.clone --name main --as main-magpie
npm run attach:panel
herdr-app check ~/.config/herdr-app/mods/magpie-panel-tabs
npm start
```

The installers refuse collisions. Use a fresh `--name` and personal layout for upgrades; [full steps](docs/sidebar.md). Restart the bridge once after updating its code.

## Implementation

- `server/upstream.js`: fixed-origin, prefix-preserving GET requests, no redirects, bounded responses.
- `server/connection.js`: private persistence, revision checks, credential scope.
- `server/trace.js` and `server/normalize.js`: bounded routing, Client, cancellation and cache projections.
- `server/allowances.js`: vendor allowance semantics; strips account identities, errors and estimated token capacity.
- `mods/magpie-dashboard/live-routing.js`: upstream-gated state machine, stable lanes, concurrent flights and cancellation.
- `mods/magpie-dashboard/main.js`: visibility-aware live polling, independent subscription reads, native layouts and loading/error states.
- `mods/magpie-dashboard/presentation.js`: shared display rules.

Magpie source: local Git checkout at commit `cd0ba05c216c924ef7f962c25111c0293814b45b`. The port retains `poll/play/home/stopPlays` lifecycle semantics. GPUI 0.1.10 supports native `left`, `top` and opacity motion; it has no web transform API. JavaScript schedules semantic changes, never frames.

Production endpoints provide live data only. `test/fixtures/` contains synthetic data for tests and isolated captures. [Verification](docs/redesign-verification.md) records exact evidence and limitations.
