# Magpie integration

Verified against upstream commit `c63c2136b27e21dd3232b14ceb6de894da93ebab` and the running local gateway on 2026-10-31. The local installed release predates the current trace endpoint.

## Configuration

```dotenv
MAGPIE_URL=http://127.0.0.1:3425
MAGPIE_API_KEY=
# MAGPIE_HISTORY_DIR=/home/you/.config/magpie/routing
PORT=4317
```

The gateway port defaults to **3425**. Port **3430** normally serves the authenticated management web UI. This project uses gateway reads and does not need the web management key. The bridge reads `.env` through Node.js's built-in environment-file support. The example is tracked; `.env` is ignored.

`MAGPIE_URL` must be explicitly configured to enable live mode. `MAGPIE_HISTORY_DIR` defaults to `$XDG_CONFIG_HOME/magpie/routing`, otherwise `~/.config/magpie/routing`. Set it to `off` to disable local history. Keep the bridge and Magpie on the same trusted machine: public trace is intentionally local-only. Remote deployments and the authenticated web admin API are outside this adapter's supported path.

## Capability detection

The adapter reads these independently:

1. `GET /v1/magpie/trace?after=0` on newer releases. A snapshot read, with no long-poll. Route updates override historical records of the same ID. A missing endpoint is cached for 60 seconds.
2. `GET /v1/magpie/usage/requests?limit=500&period=all` for the latest usage records, joined by `route_id` to route `id`.
3. Recent local `routing/YYYY-MM-DD.jsonl` files for older releases and retained history. Reads are bounded to the final 4 MiB of each recent file and 500 route objects. Partial writes and malformed lines are skipped until the next poll.

The final records are limited to the last 24 hours and at most 500 requests. Large histories and usage pagination can omit records: numbers describe the visible snapshot, not complete all-time totals. File-tail truncation is reported. History files can lag active streaming calls. At least one gateway API must answer successfully to mark the source connected; old files alone do not imply a healthy connection.

On the local instance, the trace endpoint returned 404 and the usage endpoint returned 200. The history adapter successfully returned real route attempts and usage totals without accessing web admin credentials.

## Mapping rules

| Interface field | Upstream evidence |
| --- | --- |
| Requested model | Route `model`, or usage `req` |
| Group | Route `group.id/name/routing`; older `group/` or `auto/` model references |
| Attempt provider | Match attempt `id` to `order[].id` or `left[].id`; otherwise route `provider` |
| Actual model | Reported `served`, otherwise the last attempt's selected model, otherwise usage `model` |
| Fallback | A failed attempt followed by another attempt; no attempts means unknown |
| Request status | HTTP code and route `done`; unfinished requests remain pending |
| Duration / TTFT | Usage `ms` / `ttft_ms`, otherwise route `ms` / `ttft` |
| Tokens | Sum explicit route `usage[]` counters, otherwise sum all ledger rows sharing `route_id` |
| Provider state | Counts of attempts in the visible snapshot; error observed means degraded |

The last selected model is shown when an upstream does not report `served`; it is not an independent verification of the responding model. A retry on a different account of the same provider can count as fallback. `fallback: null` preserves the distinction between an unknown route history and an observed route without fallback. No monetary estimate is shown: subscription invoices cannot be inferred from these records.

Multiple billable usage rows can share a route ID. They are retained rather than overwritten. Request outcome comes from the route when available, otherwise the latest terminal usage row; `handed_on` rows are earlier attempts, not terminal results. Older records without that flag use timestamp order and the API's newest-first order to break ties. Token counters sum all available billable rows, preserving explicit zero and unknown counters. Legacy direct rows without route IDs remain separate. The usage API's 500-row limit can cut off older attempts, so usage-only token sums can be partial.

Raw history never reaches the browser. The adapter omits session IDs, folders, account identities, prompt breakdowns, archives, hosts, key identifiers and raw error text. Errors are reduced to an HTTP code or a generic failure category.

## Sources

- [Magpie public usage reference](https://github.com/yetone/magpie/blob/main/docs/reference.md)
- [Routing trace structures and local API](https://github.com/yetone/magpie/blob/main/internal/gateway/trace.go)
- [Canonical provider resolution for attempts](https://github.com/yetone/magpie/blob/main/internal/gateway/session_route.go)
- [Herdr mod guide](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md)
