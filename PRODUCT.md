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

The user supplied https://herdr.dev/mods/ and https://github.com/yetone/magpie as the integration references. The local machine has Node.js and Herdr CLI; the Herdr desktop agent guide is absent. The community mod packaging requires mods/<name>/RECIPE.md and preview.png, without a layouts/ folder.

## Capabilities and Constraints

- Actual integration must use verified upstream interfaces.
- The interface must distinguish demonstration data, live data, stale data, and connection failures.
- Read-only observability; do not mutate Magpie routes or existing Herdr configuration.
- Keep Magpie credentials on the local bridge, outside the browser and repository.
- Responsive operation in a desktop window, embedded panel, and narrow preview.
- Working assumptions: use a dedicated mod rather than replace the user's entire layout; focus on requests, route selection, provider outcomes, and timing where upstream exposes them. These are implementation defaults inferred from the request.

## Evidence on Hand

The official Herdr mods page and Magpie source. Synthetic fixtures can demonstrate the interface but must be visibly identified. No commercial claims, invented production measurements, or unverified endpoints.

## Product Principles

- Show the actual route before aggregates.
- Make failures and fallback behavior easy to inspect.
- Report uncertainty and missing fields honestly.
- Preserve the user's existing tools and configuration.
