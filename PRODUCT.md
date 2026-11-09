# Magpie Router

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Implementation choice within the requested local repository: browser-native JavaScript modules and CSS, a small Node.js 22+ local bridge, and no production dependencies. Herdr integration will follow its current documented mod interface. No deployment is requested.

## Users

People running Magpie alongside coding agents in Herdr who need to understand which routing group, provider, and model handles a request.

## Product Purpose

Make Magpie routing legible at a glance, with enough detail to investigate individual requests and provider failures. Deliver a repository under /root/projects that can be previewed independently and installed as a Herdr mod.

## Operating Context

The user supplied Herdr and https://github.com/yetone/magpie as integration references. The local machine has Node.js and a temporary Herdr 0.1.10 binary for native validation; the user's desktop configuration is absent. The requested deliverable is a right sidebar in the default workspace. Shipped layouts reject structural additions, so installation clones main via Herdr and adds one block to its personal copy, preserving the terminal workspace and theme.

## Capabilities and Constraints

- Actual integration must use verified upstream interfaces.
- The interface must distinguish demonstration data, live data, stale data, and connection failures.
- Read-only Magpie observability; never mutate Magpie routes. Herdr installation may add the requested sidebar to a personal clone, with a backup. Preserve shipped layouts, settings and keybindings.
- Keep Magpie credentials on the local bridge, outside the browser and repository.
- Responsive operation in a desktop window, embedded panel, and narrow preview.
- The user clarified that the requested surface is a right sidebar, not the earlier standalone Workspace / Magpie page layout. Match Herdr's default theme and Files / Changes panel styling. Use a compact Routes / Usage switch inside a 368px panel, leaving terminals visible. The prior page variant is retained only for compatibility. No target Magpie IP has been supplied yet.
- Focus on requests, route selection, provider outcomes, timing and usage where upstream exposes them. These are implementation defaults inferred from the request.

## Evidence on Hand

The official Herdr mods page and Magpie source. Synthetic fixtures can demonstrate the interface but must be visibly identified. No commercial claims, invented production measurements, or unverified endpoints.

## Product Principles

- Show the actual route before aggregates.
- Make failures and fallback behavior easy to inspect.
- Report uncertainty and missing fields honestly.
- Preserve the user's existing tools and configuration.
