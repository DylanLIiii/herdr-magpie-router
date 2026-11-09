# Routing for Herdr

A native right panel opened by **Routing**, placed immediately after **Files** and **Changes** in Herdr's tab bar. It shows a chosen Magpie service's live request paths and Usage overview while the terminal workspace remains visible. The design follows Herdr's default light/dark theme.

![Native Herdr Routing, synthetic live trace](docs/previews/live-routing/routes-dark.png)

## What you see

Routing shares the existing `panel-body` stack with Files and Changes. The toolbar button toggles it closed when already selected; otherwise it selects Routing and opens the panel. The tab bar remembers the chosen panel per space using its existing logic.

The panel uses a 42px header, 13px body, 14px content padding, 10px frame radius and 1px theme border, like the shipped Files/Changes panels. Routes / Usage are compact internal tabs. Service, connection and demo states are explicit; Pause and the last update live in the footer.

Routes shows routing groups and a flat model diagram: a 1px common rail, up to four model nodes, and up to four concurrent 6px light dots with a subtle 12px outer ring. Strategy labels and member weights are preserved. The request list below shows up to 40 recent requests; click one for timing, usage and attempt detail. No account hierarchy or bird illustration is required.

Usage has period controls, a token total with cache inclusion toggle, cache hit rate, a stacked input/output timeline, request/error/cache counts, reported cost and Models / Agents breakdowns. Missing values remain unknown. The source service's aggregate period totals are separate from the bounded request sample.

## How it behaves

Port Magpie's `poll` and `play` behavior, not a looped example: GET trace with `after=seq`, then `wait=1`; merge updates, handle a changed gateway identity or a backwards sequence, and use retained IDs to discard lost unfinished requests. First load and return from a hidden panel animate only unfinished requests. Hidden/paused/Usage/detail surfaces open no new trace requests.

A request starts at the router, waits for selection, travels to the actual attempt, and stays there until that attempt's `done`. Success waits for the route's `done` before returning and disappearing. Failure returns to the router and waits for the next actual attempt. Native transitions interpolate 240ms vertical/180ms horizontal; opacity loops indicate waits. No JS per-frame rendering. Motion off is persistent per copy. More concurrent requests remain in the list.

Follow live tracks the newest request's group; selecting a group pins it. Direct requests have their own group. Demo supplies a labelled dynamic protocol fixture with waiting, fallback and success states. It never substitutes for live connection errors.

## Built from

- `mods/magpie-dashboard/main.js`: native GPUI view, lifecycle, dashboard reads, live trace reads, visibility and keyboard interaction.
- `live-routing.js`: `TraceStore` and request animation state machine adapted from Magpie `poll/play/home/stopPlays`.
- `routing.js`: strategy labels and bounded flat model projection. The older replay helper remains for compatibility tests but is not used for the live panel.
- `usage.js`: cache arithmetic and token timeline aggregation adapted from Magpie Usage.
- `server/trace.js`: allowlisted lifecycle projection, 30s read deadline for Magpie's 25s long poll, gateway identity hashing and reset detection.
- `server/dashboard.js`: groups and full-period usage projections; `server/index.js` serves `/api/routing` and `/api/dashboard` on loopback.
- `scripts/install-panel.js`: installs a `place: none` Mod for explicit stack placement; config holds only local bridge endpoint/name/motion.
- `scripts/attach-panel.js`: uses a personal clone of `main`, copies the installed `tabs` mod and its assets, adds Routing after Changes, includes it in per-space panel choices, and adds the Mod to the existing `panel-body` stack. Shipped source stays untouched. It migrates the previous standalone sidebar block, backs up the personal layout and refuses to overwrite edited tab clones.

Upstream source was read from local Git checkout `/root/.x-repo/github.com/yetone/magpie` at `cd0ba05c216c924ef7f962c25111c0293814b45b`. Keep [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the included license texts with derived code.

## Watch out

Herdr has no DOM/CSS/webview. Use the same live semantics with GPUI primitives. Never retain a stale callback context. GPUI fetch cannot abort one pending request; hide stops the next poll, while server disconnect cancels upstream work. Timeouts must not accumulate indefinitely. Do not show ten-second snapshot playback as real time.

The remote service URL/key belong only in bridge `.env`; its web cookie uses the internal listen port. Gateway Bearer keys do not authenticate the web API. Do not publish accounts, prompts, request archives or raw error bodies. The user has not supplied a real target service yet.

Shipped layouts and mods are protected. `mod.open` is an overlay, not the toolbar toggle. Clone first. The installer detects the known installed tab-bar structure and refuses to guess on incompatible source. The user’s theme, Files/Changes and keyboard bindings stay intact.

## Done when

Source and installed panel plus cloned tabs pass `herdr-app check`. Tests prove waiting until upstream done, retry ordering, parallel bound, visibility catch-up, gateway takeover, cursor forwarding, cancellation and usage arithmetic. In a real Herdr window, click Files, Changes, Routing and Routing again; verify only the selected panel shows. Record the live lifecycle and inspect Usage in light/dark and narrow widths. Run Node and browser regressions, check public content and licenses, then push the verified change. Separately verify the actual service once its address/key are available.
