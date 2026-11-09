# Third-party notices

## Magpie

The live routing state machine, cursor/visibility semantics and Usage arithmetic in `mods/magpie-dashboard/live-routing.js`, `mods/magpie-dashboard/usage.js`, and related integration code are adapted from [yetone/magpie](https://github.com/yetone/magpie), commit `cd0ba05c216c924ef7f962c25111c0293814b45b`.

The local checkout was read directly at `/root/.x-repo/github.com/yetone/magpie`:

- `internal/gui/assets/plugins/routing/client.js`: `poll`, `play`, `home`, `stopPlays`.
- `internal/gui/assets/plugins/usage/page.js`: `renderUsage`, `usageTokens` and the stacked timeline.
- `internal/gui/assets/app.js`: `cacheHitOf`.
- `internal/gateway/trace.go` and `internal/gui/trace.go`: live trace protocol and 25-second long polling.

The UI is adapted to Herdr's native GPUI interface. It is not a copy of Magpie's DOM/CSS, birds, account tree or prompt/archive UI.

```text
MIT License

Copyright (c) 2026 yetone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Herdr

Herdr App is licensed under Apache-2.0. The installer reads the user's installed `mods/tabs` and creates a personal copy with a Routing button, marked as modified. Shipped Herdr source files remain untouched. The generated copy preserves bundled assets; the installer also writes the upstream license into the copy. This repository does not redistribute the Herdr application or its binaries.

See [Herdr App](https://github.com/herdrdev/herdr-app) and [Apache-2.0](licenses/Apache-2.0.txt). The MIT license for this integration does not replace licenses attached to upstream code.
