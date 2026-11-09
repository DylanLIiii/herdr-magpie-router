---
name: Magpie Router
description: A routing observatory with an evergreen specimen-index web companion and a native Herdr panel.
colors:
  canvas: "#f1f5f2"
  paper: "#fff"
  ink: "#203e36"
  muted: "#56685f"
  line: "#e2e9e3"
  green: "#257b57"
  dark: "#183f38"
  amber: "#9a641d"
  lavender: "#73628a"
  nav-hover: "#244b42"
  nav-selected: "#31564b"
  nav-text: "#bdcfc6"
  control-ground: "#e8eee9"
  source-ground: "#e9eeea"
  source-text: "#4e6457"
  source-border: "#d5ded6"
  live-ground: "#e4f0e9"
  live-text: "#256546"
  live-border: "#cedfd1"
  route-selected: "#318162"
  route-other: "#dae5dc"
  route-attempt: "#b88238"
  node-ground: "#fafcfb"
  node-border: "#e0e8e1"
  node-active-ground: "#f0f7f2"
  node-active-border: "#70a88c"
  node-active-text: "#204f3d"
  group-ground: "#f4f1f7"
  group-border: "#e3dce9"
  group-active-ground: "#f2eef7"
  group-active-border: "#9b89ad"
  group-active-text: "#685279"
  row-hover: "#f6f9f5"
  row-selected: "#f0f6f0"
  divider: "#edf1ed"
  status-error: "#ab5140"
  status-pending: "#937126"
  notice-ground: "#fff8e9"
  notice-text: "#805b24"
  notice-border: "#e0cfac"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "28px"
    fontWeight: 550
    lineHeight: 1.4
    letterSpacing: "-0.8px"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "11px"
  metric:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "23px"
    fontWeight: 500
    lineHeight: normal
    letterSpacing: "-1px"
  model:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: normal
rounded:
  compact: "3px"
  control: "4px"
  node: "5px"
  surface: "6px"
spacing:
  control-inset: "3px"
  inline: "7px"
  filter-gap: "8px"
  small: "12px"
  mobile-gutter: "18px"
  column-gap: "19px"
  section-gap: "20px"
  panel-inline: "23px"
  desktop-gutter: "38px"
components:
  button-outline:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "7px 13px"
    typography: "{typography.label}"
  button-outline-hover:
    backgroundColor: "{colors.canvas}"
  range-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.compact}"
    padding: "7px 10px"
    typography: "{typography.label}"
  navigation-item:
    textColor: "{colors.nav-text}"
    rounded: "{rounded.node}"
    padding: "12px 13px"
  navigation-selected:
    backgroundColor: "{colors.nav-selected}"
    textColor: "{colors.paper}"
  search-field:
    rounded: "{rounded.control}"
    padding: "0 9px"
  source-badge:
    backgroundColor: "{colors.source-ground}"
    textColor: "{colors.source-text}"
    rounded: "{rounded.compact}"
    padding: "3px 6px"
    typography: "{typography.label}"
  source-badge-live:
    backgroundColor: "{colors.live-ground}"
    textColor: "{colors.live-text}"
  surface:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.surface}"
  compact-route-step:
    backgroundColor: "{colors.node-ground}"
    rounded: "{rounded.node}"
    padding: "13px 16px"
---

# Design System: Magpie Router

## Overview

**Creative North Star: "Botanical specimen index"**

The web companion uses an evergreen shell, a mineral green work ground, crisp white surfaces, concise system typography, and carefully indexed model names. Its botanical character comes from palette and orderly classification. The route highlight supplies the signature interaction; familiar controls keep a dense observatory easy to operate.

The native Herdr mod belongs to the host application. It imports `theme()` from `herdr` and uses native layout and text primitives; its colors and typography follow the user's Herdr theme. The frontmatter describes the web companion only. The browser embed is a compact web variant, distinct from the native mod.

**Key Characteristics:**

- Evergreen framing and flat white work surfaces on the web.
- Compact labels paired with monospaced model identifiers and measurements.
- Green selected paths, lavender routing groups, and amber fallback evidence.
- Explicit source, connection, update, and unknown-data states.
- Native Herdr theme inheritance for the installed mod.

Evidence: `public/styles.css`, `public/index.html`, `public/app.js`, and `mods/magpie-router/main.js`; direction from `docs/surface.md` and constraints from `PRODUCT.md`. Existing desktop, mobile, and embed captures in `.impeccable/review/` were inspected. These documents record the implementation after its visual review; they introduce no new visual choices.

## Colors

The web palette combines a deep evergreen frame with quiet mineral neutrals; operational colors carry specific meanings. Frontmatter keys retain the CSS custom-property names where those exist. Additional descriptive keys extract repeated component values rather than declare a new CSS token API.

### Primary

- **Dark evergreen (`dark`):** navigation shell and dark interaction emphasis.
- **Operational green (`green`):** success labels, focus outlines, search focus, and caret.
- **Selected route (`route-selected`):** the active diagram connector and selected-path legend. This is a separate source value from the general green accent.
- **Navigation tones:** `nav-text`, `nav-hover`, and `nav-selected` distinguish resting, hovered, and current links.

### Secondary

- **Lavender (`lavender`):** routing candidate annotations. Group node and active-group tokens supply pale grounds, violet borders, and readable text; lavender marks a route family rather than a failure.
- **Amber (`amber`):** fallback annotations and disabled-group information. `route-attempt` is the separate diagram stroke for failed attempts. `status-pending` marks unfinished requests.
- **Error (`status-error`):** failed request labels. The notice tokens provide a pale amber message region for connection or source trouble.

### Neutral

- **Mineral ground (`canvas`):** the workspace background.
- **White paper (`paper`):** route, requests, and provider surfaces.
- **Ink and muted:** principal content and secondary context respectively.
- **Line and divider:** panel boundaries and finer internal separators.
- **Control, source, node, and row tokens:** restrained local tinting for controls, data provenance, graph nodes, and request hover or selection. The live badge has its own green ground, text, and border.

**The Surface Ownership Rule.** Apply the evergreen palette to browser surfaces; resolve native colors through Herdr `theme()` on every render.

**The Route Evidence Rule.** Pair route colors with labels and line treatment: selected paths are solid, fallback attempts are dashed, and other paths recede.

## Typography

The web uses the platform sans-serif stack in frontmatter, including Chinese system fallbacks. Identifiers and measurements use the `--mono` stack. No web font is loaded. The root size is the body role; compact controls and annotations generally use the label role, with request cells and supporting copy between those two sizes. There is no separate display font or proportional scale formula.

- **Headline:** page title, using the headline role. It becomes (25px) at widths up to (850px), then (26px) at widths up to (650px). Embed titles use (24px), including at narrow widths because the embed selector wins.
- **Title:** section headings. Narrow screens reduce these to (12px).
- **Body:** root browser text; page subtitles and table content commonly use (12px). Subtitle line height is (1.7); section descriptions use (1.6).
- **Label:** metadata, controls, status labels, timestamps, and supporting copy. Do not enlarge every label when adding content; preserve the observed compact hierarchy.
- **Metric:** prominent aggregate values, with (20px) values on mobile and embed surfaces. Units remain small and separate.
- **Model:** request names and identifiers. Diagram node identifiers use (13px) monospace; group names use the sans-serif family. Numeric columns align right and use tabular numerals.

Native text sizes are chosen through the host primitives: base (12), labels (11), section and detail labels (12–13), and a semibold Magpie title (17). Do not add browser font stacks to native code.

## Layout

The desktop web shell has a fixed left rail (200px), a workspace offset of the same width, and a topbar (65px) high. Main content centers within a maximum width of (1500px), with padding (34px 38px 20px). Four inline metrics sit above a full-width routing surface. The lower grid uses `minmax(0,1fr) 235px`, a (19px) gap, and a (20px) top margin. Request-only mode makes this grid a single column.

Panel headings use padding (21px 23px 0). Filters use (17px 23px 15px), with an (8px) gap. Data rows use (11px 12px), with the outside edges aligned to the panel inset. Keep long model names constrained in lists, allow wrapping in detail views, and keep table overflow inside its scroll container, whose maximum height is (420px).

Responsive behavior follows the implemented media queries, not a generic breakpoint scale:

| Query | Implemented change |
| --- | --- |
| `min-width:1450px` | Main top padding becomes 43px; provider column 260px; diagram minimum height 315px; metric vertical spacing increases. |
| `max-width:1150px` | Rail and workspace offset become 180px; main horizontal padding 25px; provider column 200px; lower gap 14px; search wraps above filters. |
| `max-width:850px` | Lower grid becomes one column; provider surface hides; SVG graph gives way to stacked group → model → provider steps; filters temporarily return to one row. |
| `max-width:650px` | Rail becomes a static top header with horizontal navigation; workspace offset clears; main horizontal padding 18px; title and range stack; search occupies its own row; detail metrics use two columns. |

On mobile the four metrics remain four columns. Their labels wrap and reserve height to keep values aligned. The request table retains a minimum width of (510px), scrolling horizontally instead of squeezing or dropping columns.

`?embed=1` adds the browser embed variant: hide sidebar, provider surface, and page footer; clear workspace offset; use a (46px) topbar with (20px) horizontal padding and main padding (23px 20px). At narrow widths main padding becomes (19px 16px), while the general mobile rule makes the topbar (49px) high. The graph still follows the viewport breakpoint, so the inspected embed capture uses the vertical route. Embed does not inherit Herdr theme tokens.

The native panel is a full-size vertical layout on `t.surface`, with a scrolling body, (14) outer padding and (12) body gaps. Native detail cards use (11) padding and (7) gaps; request rows use (10) padding and (5) gaps. The most recent requests form a vertical list, currently capped at 16. Extend this compact native structure using host primitives.

## Elevation & Depth

The web is flat and border-led. White panels separate from the mineral canvas through tone, a thin line, and modest corner curvature. Panels and graph nodes have no drop shadow. The selected time-range segment has the only structural shadow (`0 1px 3px #183f3810`). Search focus uses a functional ring (`0 0 0 1px var(--green)`) plus a green border. Other focusable controls use a (2px) green outline offset by (4px).

Motion remains local: navigation changes background and color over (.16s), table rows change background over (.15s), and route strokes and opacity change over (.2s). The route surface enters over (.6s) with `cubic-bezier(.16,1,.3,1)`, a small vertical movement and clip reveal, only when reduced motion is not requested. Refresh spins over (1.2s), linear and infinite while loading. The reduced-motion query disables animations and transitions and restores automatic scrolling.

Native depth comes from `t.surface`, `t.raised`, `t.selected`, borders, and hover states. Do not translate the web's shadow or surface colors into native constants.

## Shapes

Browser surfaces use the surface radius; graph nodes and navigation use the node radius; fields, icon buttons, outline buttons, and candidate rows use the control radius; badges and segmented buttons use the compact radius. These are small, practical curves. Panel boundaries and most separators are (1px); selected connectors are (2px). Status and health markers are circular, with (4–6px) diameters depending on role. Default icons are (18px) outlined SVGs with a (1.6) stroke and round caps and joins; compact controls reduce them to (13–14px).

Native controls are rounded through host methods: buttons (5), request rows (7), and raised detail cards (8), with borders (1). Those values are native component choices, separate from browser radius tokens.

## Components

### Buttons and range controls

Buttons are compact and restrained. An outline action uses the `button-outline` recipe with a thin pale green border; hover takes the canvas ground. Icon buttons are (32px) square. Text actions have a (32px) minimum height, small icons, and a pale green hover ground. Disabled buttons use wait cursors and opacity (.5). Preserve accessible names for icon-only actions.

The time range is a segmented control on the control ground, with a small inset and selected white segment. Selection is expressed by `aria-pressed`, ink text, and the subtle range shadow. Mobile segments have a (32px) minimum height. There is no large filled primary CTA in the current observatory.

### Inputs and filters

Search is a bordered flex field containing a small search icon and borderless input (32px) high. The wrapper owns focus through `:focus-within`; the input suppresses its separate outline. Selects use native browser affordances, thin borders, compact label text, a control radius, and (33px) height. Keep visible focus behavior when extending these controls and preserve the accessible labels hidden visually in the current markup.

### Navigation

Desktop links sit on evergreen, with muted light text and icons; the current link gains the selected navigation ground and white text using `aria-current=page`. Hover uses the separate hover ground. On mobile, navigation becomes horizontal and the active state becomes a (2px) bottom rule with no filled background. Preserve text labels beside the icons.

### Source badges, notices, and status

Source badges identify demo or live data and are informational, not filter chips. The live variant uses the live token family. Notices use the amber notice family with padding (11px 14px), line height (1.7), and wrapping for long diagnostic text. A status label pairs text with a small colored dot: green success, error red, or pending ochre. Provider health dots also have accessible labels. Keep demo, live, stale, connection failure, and unknown values explicit; green visual language must not turn unavailable data into an implied success.

### Work surfaces and request records

Use the `surface` recipe for route, request, and provider containers, adding the line border and clipped overflow. These panels are not raised cards. Request rows use muted separators, a gentle hover ground, and a distinct selected ground. The button inside each request row supports keyboard selection and exposes expansion state. Selection drives the route highlight; opening details reveals metrics and actual attempts beneath the table. Error detail text uses a warm pale ground, muted red text, and monospace wrapping. Empty states remain inside their panels with concise explanations and an outline clear-filter action where relevant.

### Route graph and compact route

The desktop graph is an SVG with viewBox `0 0 870 280`, three columns, and (5px) node corners. Active nodes have green borders and pale green grounds; routing-group nodes use lavender. Unselected nodes have dashed outlines, and background paths recede through opacity. Failed attempts use a dashed amber connector. A persistent legend explains the treatments.

At the compact breakpoint, replace the graph with three stacked bordered steps joined vertically by a thin green rule. The first step retains its group tint and sans-serif name; model and provider values use monospace. Below them show request status, duration, and fallback information when present. The sidecar's route snippet demonstrates this real compact variant rather than inventing a second diagram.

### Native Herdr panel

The current native surface shares the default right panel stack with Files and Changes. A cloned installed tab bar adds Routing after Changes and reuses the host's per-space panel state. The panel uses the host's 42px header, 13px body, 14px padding, 10px frame radius and theme border. Routing is event-driven: small native light dots wait at model destinations until upstream completion, returning for success or fallback. Usage adds a compact stacked input/output trend, cache inclusion and Models/Agents breakdown. These are native extensions of the existing system; the web tokens above remain unchanged. See `docs/routing-motion.md` for timing and source semantics.

Resolve `t.surface`, `t.foreground`, `t.muted`, `t.dim`, `t.raised`, `t.border`, `t.selected`, `t.accent`, and `t.hover` from `theme()`. Native buttons use raised or selected backgrounds with muted or accent text; hover uses `t.hover`. Selected requests use `t.selected` and an accent border. Success resolves to `t.done`, failure to `t.blocked`, pending to `t.working`, and unknown to `t.muted`. The same source honesty and request-to-attempt inspection apply, expressed through the host theme. The sidecar examples intentionally represent browser components only; browser HTML cannot preview native GPUI rendering faithfully.

## Do's and Don'ts

### Do:

- **Do** keep browser components on the extracted evergreen, mineral, and paper palette.
- **Do** resolve native panel colors through Herdr `theme()` on every render.
- **Do** pair path and status colors with labels, line patterns, or accessible state text.
- **Do** preserve monospaced identifiers, aligned measurements, and compact labels.
- **Do** use the vertical route at the compact breakpoint and scroll dense request tables within their panel.
- **Do** retain source identity, update time, missing values, and connection feedback alongside the records.
- **Do** preserve keyboard focus and honor reduced-motion preferences.

### Don't:

- **Don't** force the web evergreen palette or browser font stack onto the native Herdr mod.
- **Don't** add botanical decoration to the specimen-index direction.
- **Don't** add floating shadows to the flat work surfaces.
- **Don't** treat lavender groups as errors or amber fallback attempts as selected successful paths.
- **Don't** hide request columns to make the narrow table fit or replace missing data with invented values.
- **Don't** treat the browser embed capture as evidence of native Herdr appearance.
