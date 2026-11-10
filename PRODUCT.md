# Magpie Router

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Native Herdr GPUI JavaScript mod with a small Node.js 22+ loopback bridge and no production dependencies; a browser companion remains available. The public repository is DylanLIiii/herdr-magpie-router. Herdr draws the UI and interpolates motion natively.

## Users

People running Magpie alongside coding agents in Herdr who need to understand which routing group, provider, and model handles a request.

## Product Purpose

Make Magpie routing legible at a glance, with enough detail to investigate individual requests and provider failures. Deliver a repository under /root/projects that can be previewed independently and installed as a Herdr mod.

## Operating Context

The user supplied Herdr and https://github.com/yetone/magpie as integration references. The local machine has Node.js and a temporary Herdr 0.1.10 binary for native validation; the user's desktop configuration is absent. The requested deliverable is a right sidebar in the default workspace. Shipped layouts reject structural additions, so installation clones main via Herdr. It adds Routing to the existing Files/Changes panel stack and clones the installed tabs mod to add a Routing toggle immediately after Changes, preserving the terminal workspace and theme.

## Capabilities and Constraints

- Actual integration must use verified upstream interfaces.
- Production surfaces show live data only. Synthetic data is limited to tests and explicitly documented captures. Preserve stale/unknown data semantics; initial connection uses skeletons.
- Read-only Magpie observability; never mutate Magpie routes. Herdr installation may add the requested sidebar to a personal clone, with a backup. Preserve shipped layouts, settings and keybindings.
- Provide native Connection settings for Magpie URL and Web access key. Keys are masked during entry, sent only to the loopback bridge, persisted in a private 0600 settings file, and never read back to the mod, browser or repository. Test is non-mutating; Save replaces the active source immediately and invalidates old responses.
- Responsive operation in a desktop window, embedded panel, and narrow preview.
- The user clarified that the requested surface is a right sidebar, not the earlier standalone Workspace / Magpie page layout. Match Herdr's default theme and Files / Changes panel styling. Use Routes / Usage / Cost tabs inside a 368px panel, leaving terminals visible. The prior page variant is retained only for compatibility. The user supplied a reverse-proxy URL shape with /mac/; real authentication remains configured privately by the user.
- The user explicitly requested a source-based port of Magpie Routing/Usage, real-time route display, and a Routing toggle after Files and Changes. Read upstream local Git commit cd0ba05c216c924ef7f962c25111c0293814b45b; port long-poll seq semantics and selecting/sending/held/return/fallback states. Snapshot replay must not be presented as live traffic.
- Cost follows Magpie's period, cache-inclusion, cache-hit and stacked input/output chart semantics, with a visible legend. Usage means vendor subscription/plan allowances, balances and reset times from the quotas API.
- All requests follow automatically; no routing group selector, pinning or Following control. Motion defaults on and lives in Settings. Show Client → group → model and distinct success/failure/recovery/cancellation effects.
- Request rows use the remaining panel height and expose cache hit, tokens and timing. Keep normal labels 12–14px, host typography and quiet chrome. Remove Demo, Pause, repeated Connected labels and main-view service URLs.
- HTTP(S) service URLs support reverse-proxy path prefixes. Stored keys stay scoped to the normalized origin and prefix. No key is reused automatically for a different service path.

## Evidence on Hand

The official Herdr mods page and Magpie source. Synthetic fixtures can demonstrate the interface but must be visibly identified. No commercial claims, invented production measurements, or unverified endpoints.

## Product Principles

- Show the actual route before aggregates.
- Make failures and fallback behavior easy to inspect.
- Report uncertainty and missing fields honestly.
- Preserve the user's existing tools and configuration.
