# Native sidebar redesign verification

Current surface: Routes / subscription Usage / Magpie Cost, native Herdr default theme. This report supersedes the historical group-picker and Demo captures.

## Implemented acceptance points

- No routing-group selector, pin state or Following switch. All clients, groups and direct calls enter the same live projection.
- Motion defaults on, with a static alternative in Settings. Stable request lanes identify Client, group and actual model.
- Success returns and fades; failure returns; fallback continues only when an actual later attempt arrives and is marked amber; explicit cancellation fades at the target. Shape and text distinguish outcomes independently of color.
- The packet is an outlined 10px dot with a 4px core, without a glow. Normal interface text is 12–14px.
- Recent requests use remaining height, scroll separately, and show result, duration, Client/group, time, input/output and cache hit. Details show cache reads/writes and actual attempts.
- Usage reads vendor quotas separately, showing remaining windows, balance and reset. Cost is the former Magpie usage summary, with period controls and a visible Input/Output chart legend.
- Initial connection keeps a neutral skeleton. Pending work does not show a red not-connected message.
- Demo and Pause are removed from production interfaces. Production data endpoints reject `mode=demo`; synthetic data is under `test/fixtures/`.
- Main views do not show service URL or duplicate Connected captions. Settings contains address, masked key, internal port and Motion.
- Service URLs with reverse proxy prefixes such as `/mac/` are accepted and retained on every API read.

## Checks

- JavaScript syntax and **76 Node tests** pass locally. Six obsolete snapshot-replay tests were removed with their unused group-filter/replay implementation; the real live state machine remains covered. Tests include actual authenticated HTTP listeners for prefixed URLs, Test/Save/restart, private persistence, cross-prefix key isolation and stale-response rejection.
- New allowance tests cover the Web array and gateway object/data response shapes, unknown vs zero, balances, unlimited/text windows, anonymous multiple accounts, and exclusion of derived token capacity.
- Native controller tests cover skeleton rendering, removed controls, keyboard navigation, Client/cache metadata, connection revisions and delayed quota responses.
- Animation tests cover real attempt/request completion gates, cross-group concurrency, cancellation and admission of a queued request without another upstream event.
- Source and installed dashboard pass `herdr-app check`. Isolated window `status` reports no errors.
- Gitleaks 8.30.1 scan of all publishable files: no leaks found.
- Six browser regressions pass: request inspection/filtering/export, removed Demo/Pause, disconnected state, HTML injection safety, desktop/mobile/embed sizing and keyboard focus. The final legacy group-filter removal is included in the release regression run.

## Native evidence

Herdr App 0.1.10 Linux, software rendering, isolated `HERDR_APP_HOME` and hc session. Full window 1440×1000; dark panel 368 logical pixels, light panel 320.

- [Routes, dark](previews/redesign/routes-dark.png)
- [Vendor Usage, dark](previews/redesign/usage-dark.png)
- [Cost and chart legend, dark](previews/redesign/cost-dark.png)
- [Routes, light and 320px](previews/redesign/routes-light-320.png)
- [Vendor Usage, light and 320px](previews/redesign/usage-light-320.png)
- [Cost, light and 320px](previews/redesign/cost-light-320.png)
- [Settings and Motion On](previews/redesign/settings-light.png)
- [Request detail with Client, cache and attempts](previews/redesign/request-detail.png)
- [Initial skeleton while both reads are delayed](previews/redesign/connecting.png)
- [Native routing recording](previews/redesign/routing.gif)

Clicks were sent to the real isolated X11 window. Screenshots use `herdr-app shot`; the 22-second recording captures actual native frames at 30fps and exports a 15fps GIF. Frame contact sheets were inspected. The main terminal visibly labels synthetic data. The recording was captured during the final pass before removal of an idle dash; all final static captures reflect the released text.

All service traffic, quotas and money in these artifacts are synthetic test inputs. No user screenshot, remote key, account identity or actual usage was published. A real user deployment has not been authenticated in this session. macOS/Windows and full screen-reader behavior remain outside the local check.

The mechanical design detector reported no native-source findings; its remaining advisories concern existing 11px text/color choices and stale design-sidecar entries in the retained browser companion. The native surface follows Herdr theme tokens and was checked visually in both themes; no separate native color palette was introduced.
