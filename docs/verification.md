# Verification

Verified on 2026-10-31 with Node.js 24.14.0 and Chromium 153. Tests require Node.js 22 or newer.

## Automated coverage

Final verification passed: 21 Node.js tests, 6 Chromium browser tests, JavaScript syntax checks, zero reported npm audit vulnerabilities, and the native Herdr App initial-render check.

`npm run check` parses JavaScript in public, server, scripts, test and mods. `npm test` covers source normalization, HTTP boundaries, native View lifecycle in a mocked host, read-only data access, server-side credentials, unsupported endpoint fallback, live disconnection and history parsing. `npm run test:ui` exercises the running webpage in Chromium: request selection, attempts and fallback, filters, export, pause, navigation, disconnected live mode, hostile upstream text, responsive desktop/mobile/compact layouts and keyboard focus.

Visual captures were opened and reviewed at 1440px desktop, 390px mobile and 600px compact widths. Chinese glyphs render in the capture environment with Noto CJK installed. The browser UI uses the operating system's available fonts; font files are not fetched remotely. The gallery preview is captured from the web companion in clearly labeled demo mode; it is not evidence of native GPUI rendering.

## Real local gateway

The bridge successfully read the running local Magpie at `127.0.0.1:3425`. The installed release returned 404 for `/v1/magpie/trace`; the usage endpoint and local JSONL history supplied a 500-request bounded snapshot. 497 requests had attempts; the 3 without attempts retained an unknown fallback value. The browser loaded the live snapshot, opened request details and rendered the selected route with no uncaught JavaScript errors or page overflow at desktop width. These are observations at verification time, not fixed product statistics.

No gateway credentials, request bodies or account secrets were needed or printed. The existing Magpie/Herdr configuration was not changed. Only the local panel server was started.

## Finish review

A fresh review inspected the desktop, mobile and compact screenshots and the source. The initial verdict required two material fixes: preserve multiple billable usage rows per route, and recover the native panel from an elapsed-time timeout. Both were fixed with regression tests. The scoped verdict pass scored both fixes **resolved**, with disposition **ship**. The verdict does not imply unperformed native interactive or theme testing. Visual tokens and component conventions are captured in `DESIGN.md` and `.impeccable/design.json`; preview provenance lives next to `preview.png`.

## Native validation and remaining scope

The official Herdr App 0.1.10 Linux x86_64 archive was downloaded into `/tmp/opencode/herdr-magpie-verify`, not installed. Its SHA-256 matched the official manifest: `adef0feab129c84d8de4d95179629bf297e76822d30e0d5e69c262ad232ce33a`. With isolated XDG configuration/data directories, `herdr-app check /root/projects/herdr-magpie-router/mods/magpie-router` exited 0 and printed `check passed`. The check was repeated after the timeout recovery fix.

Native async lifecycle tests cover serialized mode switching, disconnected snapshots, stale responses and watchdog recovery in a mocked host. Native App theme changes, async interaction, long names and scrolling still require manual testing on the actual installation. Read its `~/.config/herdr-app/AGENTS.md`, repeat the check and follow [herdr.md](herdr.md). No native screenshot is claimed.
