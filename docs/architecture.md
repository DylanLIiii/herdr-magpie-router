# Architecture

The browser is a static client. It requests a normalized snapshot from the local Node.js bridge. The bridge reads Magpie's documented observability interfaces using a server-side credential, maps only permitted fields into the snapshot, and returns no credentials or prompt content.

```
Herdr custom component / standalone browser
              │ GET /api/snapshot?mode=live
              ▼
      loopback-only local bridge
              │ fixed Magpie origin + server-side auth
              ▼
        Magpie observability API
```

Demo mode uses a separate synthetic fixture with an explicit label. The default is demo so cloning the repository requires no service credentials. A live-mode failure returns a disconnected live snapshot, never sample data.

The bridge exposes only a fixed static asset list, /health and /api/snapshot. Browser input cannot choose an upstream host or arbitrary upstream path. Requests with an unexpected Host or cross-origin Origin are rejected. Read operations do not alter routes, configuration, providers, or upstream data.

Data is a bounded recent snapshot, not a durable analytics database. The interface recomputes aggregates from the currently displayed window. Unknown timing or token values stay null. A provider health label describes observed attempts in the sample rather than a synthetic health probe.

The Herdr adapter and recipe live in mods/magpie-router/. This is a native GPUI JavaScript View that requests the same snapshot as the browser; it does not embed the webpage. The standalone webpage separately accepts embed=1 as a compact preview mode. Installing the adapter follows the user's existing Herdr App guide and does not replace the chosen layout.
