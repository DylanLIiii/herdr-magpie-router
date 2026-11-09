# Magpie layout verification

Verified on 2026-11-09 with the official Herdr App **0.1.10** Linux binary, Node.js 24 and an isolated Xvfb display. The preview used its own `HERDR_APP_HOME`, XDG directories and `HC_SESSION`; existing user settings, layouts and terminals were not changed.

## Automated results

- `npm run check`: passed.
- `npm test`: **35 passed, 0 failed**.
- `herdr-app check mods/magpie-dashboard`: passed.
- `herdr-app check mods/magpie-navigation`: passed.
- Installed the layout into a temporary configuration home using `scripts/install-layout.js`; both installed mods passed `herdr-app check` again.
- `git diff --check`: passed.

The new tests cover cookie authentication, reverse-proxy listen ports, GET-only upstream reads, rejection of credential-bearing URLs, field projection, authentication failures, partial responses, zero/unknown values, full-period aggregates independent of the request sample, and separation of remote data from local history. An actual loopback HTTP fixture exercised the authenticated adapter, in addition to mocked fetch tests.

Native lifecycle tests cover host props, keyboard button activation, source/period races, retaining stale data on failure, clearing it on source changes, hidden-page polling, closure and watchdog recovery. Installer tests verify name remapping, preservation of settings/keys and refusal to overwrite existing files.

## Native window verification

The mods were loaded into a running Herdr window, not just a simulated host. `herdr-app status` reported `errors: []` after loading and after switching pages. The Workspace / Magpie stack switches successfully. Commands and actual X11 keyboard input exercised Routes / Usage, the 7-day period and selection of a fallback request. Native screenshots were opened and reviewed locally in this session; no separate reviewer agent was used. The web-only design detector was not run on GPUI code.

The visual pass checked the service and connection labels, demonstration label, selected routing group, request-to-attempt detail, usage totals, missing cost, controls, responsive stacking and scroll boundaries against the existing Herdr theme conventions. The final pass confirmed readable grouped counters and explicit synthetic-data provenance. There is no browser/webview screenshot standing in for the native page.

| Capture | Content |
| --- | --- |
| [native-routes.png](previews/native-routes.png) | Desktop Routes with a selected fallback request; synthetic data |
| [native-usage.png](previews/native-usage.png) | Desktop Usage and model totals; synthetic data |
| [native-usage-narrow.png](previews/native-usage-narrow.png) | 600px Usage, light theme, keyboard-selected 7-day period; synthetic data |
| [native-routes-light.png](previews/native-routes-light.png) | 600px Routes with stacked detail; synthetic data |
| [native-unconfigured.png](previews/native-unconfigured.png) | Live mode with an unconfigured bridge; actionable setup state and no fabricated records |

`layouts/magpie.svg` is an authored structural thumbnail for Herdr's layout picker. It is not a screenshot or evidence of a live service. PNG capture provenance is recorded in `previews/provenance.json`.

## Limits

The actual service IP/hostname, web port and access key have not been supplied. **No live connection to the user's intended remote service has been verified.** The adapter's remote behavior was tested against source-verified API shapes and a local authenticated HTTP fixture.

This native run used Linux and Herdr 0.1.10. The target desktop should rerun both mod checks and confirm its own theme, fonts, window sizing and service reachability. A full screen-reader audit and macOS/Windows native runs were not performed. The original standalone browser companion was not changed visually; its browser test suite was not rerun.

The initial native run revealed that layout properties must be read through `herdr.props()` on this host; the new mods now do so, with regression coverage. The initial isolated core failed due to a mismatched runtime socket, resolved by an explicit preview `HC_SESSION` and socket. These failures were fixed before the successful native captures.
