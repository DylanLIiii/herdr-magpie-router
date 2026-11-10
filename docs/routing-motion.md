# Native live routing

![Client, group and model in the native panel; synthetic test traffic](previews/redesign/routes-dark.png)

The panel follows all requests automatically. Each lane identifies the Client, routing group (or Direct), and actual model. Up to four requests animate concurrently; extra active requests remain in the list and take a freed slot immediately. A newer request from another group does not cancel an existing packet.

## Source and lifecycle

Magpie was read from a real local Git checkout at `cd0ba05c216c924ef7f962c25111c0293814b45b`:

- `internal/gui/assets/plugins/routing/client.js`: `poll`, `play`, `home`, `stopPlays`.
- `internal/gateway/trace.go`, `internal/gui/trace.go`: sequence, attempts, completion and cancellation.
- `internal/gui/assets/plugins/usage/page.js`, `internal/usage/usage.go`: token/cache arithmetic, now presented as Cost.
- `internal/gui/usage.go`, `internal/provider/subscription_usage.go`, `internal/gui/assets/app.js`: subscription allowance reads and display semantics.

The bridge forwards `after` and `wait` to the actual trace endpoint. Upstream long polls can wait 25 seconds; the bridge allows 30 seconds. Epoch changes and cursor rollback reload the trace. Initial load or returning to a hidden panel animates unfinished requests only.

| State | Native behavior |
| --- | --- |
| Selecting | Wait at the client until an actual attempt exists |
| Sending | Travel through the group marker to the model |
| Running | Hold at the model; a quiet opacity change indicates a live wait |
| Successful | Wait for both attempt and request completion, then return and fade |
| Failed attempt | Return from the failed model; wait for an actual subsequent attempt before moving again |
| Recovered | The later attempt uses amber; the request gets a distinct recovery icon/label |
| Failed request | Red error result and return; no fabricated fallback |
| Canceled | Muted cancellation mark and fade at the destination |

Motion defaults to On and can be turned off in Settings. Polling and status display continue when motion is off. Switching views, hiding the panel or opening settings cancels local animations; returning catches up without replaying old completions.

## Rendering

Herdr's default theme supplies foreground, borders and semantic colors. Lanes use a 1px line with three anchor points, a 10px outlined packet and 4px core. GPUI interpolates horizontal position over 220ms and opacity over 180ms. The runtime exposes native position and opacity properties, not CSS transforms. JavaScript schedules request states rather than animation frames.

A held packet's opacity period is 1200ms. Pending state never ends because a timer expired. The bounded native fetch watchdog prevents accumulation when the host fetch has stalled and cannot be aborted.

The graph gives priority to active requests. When idle it keeps the latest two routes, leaving most of the panel available to the independently scrolling request list. The list shows up to 80 records and includes Client, group, actual model, result, duration, input/output and cache hit. Missing measurements stay unknown.

## Cost and subscription Usage

Cost retains Magpie's `today`, `7d`, `30d`, `all` periods, cache inclusion, stacked input/output chart and Models/Clients breakdown. Cache hit uses `cache_read / (input + cache_read + cache_write - cache_unknown)` for aggregate totals; request-level unknown-cache attempts are excluded from the corresponding denominator. A legend labels each chart series.

Usage uses a separate `/api/allowances` bridge request and Magpie's `/api/usage/quotas` (or the gateway equivalent). Remaining share is `100 - used`, clamped for display. Text-only windows, balances and unlimited windows never become a synthetic 100% bar. Distinct accounts and overlapping windows are not summed. No quota is inferred from Magpie's token ledger or cost.

All public endpoints are live-only. Synthetic protocol samples and screenshots are test artifacts, documented in [verification](redesign-verification.md). No user credentials or account images are published.
