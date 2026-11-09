# Magpie layout: remote routes and usage

This documents the earlier standalone page variant. The requested right sidebar that follows Herdr's default theme is now the primary deliverable: see [sidebar installation](sidebar.md). The page variant remains available for compatibility.

The personal `magpie` layout adds two pages to Herdr: **Workspace** for the normal spaces, agents, tabs and terminals, and **Magpie** for your service. It uses native GPUI elements and inherits your Herdr theme. Switching pages keeps terminals running. No web view is required.

The service IP has not been supplied yet. Set its address before using live mode. The new layout defaults to live data; **Preview demo** explicitly selects synthetic data.

## Connect your service

Run the Node.js bridge on the computer running the Herdr window. Node.js 22 or newer is required. The bridge has no production dependencies and listens only on `127.0.0.1`.

1. Copy `.env.example` to `.env` if you do not already have one.
2. Set `MAGPIE_WEB_URL` to the Magpie **web service origin**: scheme, IP/hostname and port. The usual web port is `3430`; the model gateway normally uses `3425`. Use the port your service actually listens on.
3. Set `MAGPIE_WEB_KEY` to that web service's access key. This is the service's `MAGPIE_WEB_KEY`, or the `k` value in the sign-in link printed by `magpie web`. Keep the key in `.env`, not the layout, URL or mod source. `.env` is ignored by Git.
4. Start the bridge:

```sh
npm start
```

For example, the configuration has this shape; replace the address and key locally:

```dotenv
MAGPIE_WEB_URL=http://<MAGPIE_SERVICE_IP>:3430
MAGPIE_WEB_KEY=<WEB_SERVICE_ACCESS_KEY>
PORT=4317
```

Use HTTPS when the connection crosses an untrusted network, or tunnel the service through SSH and connect to the forwarded loopback port. This page does not change the service's bind address, firewall, authentication or routes.

Magpie's web API authenticates with `Cookie: magpie_web_<listen-port>=<key>`. A model gateway Bearer key does not grant web access. Behind a reverse proxy, set `MAGPIE_WEB_COOKIE_PORT` to the Magpie process's **internal web listen port**, even when the public address uses port 443. The same applies to an SSH tunnel whose local port differs from the remote listen port. Credentials stay in the bridge process, and requests never follow redirects.

`MAGPIE_WEB_URL` takes precedence over `MAGPIE_URL`. The existing gateway mode still works for recent observations and usage, but configured routing groups require the web API. Remote services never merge routing files from this machine.

## Install the layout

On the computer with Herdr, from this repository:

```sh
npm run install:layout
herdr-app check ~/.config/herdr-app/mods/magpie-dashboard
herdr-app check ~/.config/herdr-app/mods/magpie-navigation
herdr-app do layout.switch --name magpie
```

The installer adds exactly these files:

- `layouts/magpie.json` and `layouts/magpie.svg`
- `mods/magpie-dashboard/main.js`, `config.js` and `mod.json`
- `mods/magpie-navigation/main.js` and `mod.json`

It refuses existing names and does not modify `settings.json`, `keys.json`, shipped layouts or shipped mods. To use another name, configuration home or bridge port:

```sh
npm run install:layout -- --name my-magpie --home /path/to/herdr-app --endpoint http://127.0.0.1:14317/api/dashboard
```

Check the renamed mod folders, then select `my-magpie`. `--endpoint` points to the **local bridge**, while `MAGPIE_WEB_URL` points to the **Magpie service**. `HERDR_APP_HOME` is also respected. For an update, install with a fresh name and switch after checking it.

The system window title bar remains available. The layout's Workspace page uses Herdr's shipped `spaces`, `agents`, `tabs` and `pane` mods. Choose any other layout in Herdr settings or with `layout.switch` to return to it.

## What the page shows

**Routes** shows configured routing groups, routing strategy, enabled/ready states and member models. Choose a group to inspect its members. Recent requests show the requested and selected models, provider, result, fallback, duration, time to first token, input/output tokens and recorded attempts. The page lists up to 40 of the bridge's 500 most recent visible requests from the past 24 hours. The request list scrolls independently of its detail panel. Arrow keys change the selected request or group when the page has focus.

**Usage** offers Today, 7 days, 30 days and All time. It shows request/error totals, input/output tokens, cache reads/writes, reported USD cost and up to 20 models sorted by request count. Totals come directly from Magpie's aggregate usage API, independently of the bounded recent-request list. Requests without known prices are disclosed; reported cost does not claim to be a subscription invoice. Missing measurements show `—`, while genuine zeroes remain zero.

The reader's time zone is passed to Magpie when the host exposes it. Older hosts without `Intl` use the service's time zone, stated on the page. The period controls affect usage totals; recent routes keep their explicitly labelled 24-hour window.

Refresh runs every 10 seconds while the Magpie page is visible. Group configuration is cached for up to 30 seconds. Pause disables automatic refresh; manual Refresh still works. A 15-second watchdog ignores late responses and pauses automatic polling after a stall. GPUI's fetch cannot cancel the underlying request, so a manual retry may overlap one stalled fetch. Failed refreshes retain the last successful snapshot with an offline label and timestamp. Switching source or period clears old data. Partial failures identify the missing section and never substitute demonstration data.

Tab focuses buttons; Enter/Space activates them. With the page focused: G = Routes, U = Usage, R = Refresh, Space = Pause/Resume, D = Demo/Live, 1–4 = usage period, Up/Down = request, Left/Right = group. No global keyboard bindings are installed.

## Verified APIs

Authenticated reads from Magpie web:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/groups` | Configured group strategy, availability and member models |
| `GET /api/gateway/trace?after=0` | Current routing attempts |
| `GET /api/gateway/history` | Retained routes from the service |
| `GET /api/usage/requests?limit=500&period=all` | Per-request token and timing records |
| `GET /api/usage?period=today&tz=…` | Aggregate usage for the selected period |

The bridge projects an allowlist of display fields. It omits account identifiers, session content, prompts, local paths, credentials and raw upstream error bodies. Neither the dashboard nor the bridge issues mutation requests to Magpie.

Source references: [Magpie web authentication](https://github.com/yetone/magpie/blob/main/internal/gui/web.go), [groups](https://github.com/yetone/magpie/blob/main/internal/gui/groups.go), [trace/history](https://github.com/yetone/magpie/blob/main/internal/gui/trace.go), [usage adapter](https://github.com/yetone/magpie/blob/main/internal/usageapi/usageapi.go), and [Herdr mod/layout guide](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md), read on 2026-11-09.

## Design and validation

This is an extension of the existing native surface. It inherits Herdr's theme, system text, compact controls and selected-row treatment. The page prioritizes a clear service identity, route groups and request-to-attempt inspection; Usage separates complete aggregates from the bounded route history. At widths below 760 logical pixels, details move above the request list and measurements use two columns. All content stays native; the web companion's colors are not copied into this page.

Validation results and native screenshots are recorded in [layout-verification.md](layout-verification.md). The actual service IP and access key are still needed for a live connection check on your setup.
