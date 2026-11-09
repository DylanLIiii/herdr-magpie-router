import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, layout, nextCommand, props as hostProps } from "herdr";
import config from "./config.js";
import { RouteSignal, strategyInfo, destinationKey, rowY } from "./routing.js";

const PERIODS = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]];
const plain = (value, max = 100) => {
  const result = value == null || value === "" ? "—" : String(value);
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
};
const count = value => Number.isFinite(value) && value >= 0 ? String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "—";
const money = value => Number.isFinite(value) && value >= 0 ? `$${value.toFixed(2)}` : "—";
const duration = value => Number.isFinite(value) && value >= 0 ? value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s` : "—";
const time = value => {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  const date = new Date(value);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, "0")).join(":");
};
const state = value => ({ success: "Success", error: "Failed", pending: "In progress" })[value] || "Unknown";
const stateColor = (value, t) => value === "success" ? t.done : value === "error" ? t.blocked : value === "pending" ? t.working : t.muted;
const find = (node, id) => {
  if (node?.id === id) return node;
  for (const child of node?.children || []) { const match = find(child, id); if (match) return match; }
  return null;
};

export default class MagpieDashboard extends View {
  init(initialProps, cx) {
    const props = hostProps() || initialProps;
    this.endpoint = props?.endpoint || config.endpoint;
    this.sidebar = props?.presentation !== "page";
    this.details = false;
    this.stack = props?.stack;
    this.page = props?.page;
    this.modName = config.modName || "magpie-dashboard";
    this.mode = props?.mode === "demo" ? "demo" : "live";
    this.section = props?.section === "usage" ? "usage" : "routes";
    this.period = "today";
    this.zone = "";
    try { this.zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) { /* Older QuickJS: use service time zone. */ }
    this.width = this.sidebar ? 368 : 1000;
    this.snapshot = null;
    this.selected = null;
    this.group = null;
    this.loading = false;
    this.paused = false;
    this.closed = false;
    this.queued = false;
    this.error = "";
    this.generation = 0;
    this.motion = config.motion !== false;
    try { const saved = localStorage.getItem("routing-motion"); if (saved) this.motion = saved === "on"; } catch (_) { /* Host without persistent storage. */ }
    this.signal = new RouteSignal(() => this.visible() && !this.paused && !this.closed && !this.error && this.motion && this.section === "routes" && !this.details);
    this.focus = cx.focus_handle();
    cx.spawn(async (cx) => { for (;;) {
      const command = await nextCommand();
      if (command === "focus") this.focus.focus();
      else if (command === "usage" || command === "routes") this.section = command;
      else if (command === "demo" || command === "live") this.change("mode", command, cx);
      else if (command === "refresh") this.refresh(cx);
      else if (command === "replay") this.replay(cx);
      cx.notify();
    } });
    cx.timer.every(5000, (cx) => {
      if (this.loading && Date.now() - this.started >= 15000) {
        this.generation++; this.loading = false; this.queued = false; this.paused = true;
        this.error = "The bridge did not respond within 15 seconds. Auto refresh is paused. Check the bridge, then refresh.";
        this.signal.stop();
        cx.notify();
      } else if (!this.loading && !this.paused && this.visible() && Date.now() - (this.started || 0) >= 10000) {
        this.refresh(cx);
      }
    });
    this.refresh(cx);
  }

  visible() {
    if (this.stack && this.page) return find(layout(), this.stack)?.active === this.page;
    if (!this.sidebar) return true;
    const shown = node => {
      if (!node || node.hidden) return false;
      if (node.type === "block" && node.content?.mod === this.modName) return true;
      return (node.children || []).some(child => (node.type !== "stack" || !node.active || child.id === node.active) && shown(child));
    };
    return shown(layout());
  }
  close() { this.closed = true; this.generation++; this.signal.stop(); }

  syncSignal(cx, animate = true) {
    this.signal.sync(this.groups().find(group => group.id === this.group), this.snapshot?.requests || [], this.mode, cx,
      { animate: animate && this.motion && !this.paused && !this.error && this.section === "routes" && !this.details && this.visible(), firstDemo: true });
  }
  chooseGroup(id, cx) { this.group = id; this.syncSignal(cx, false); cx.notify(); }
  replay(cx) { if (this.motion && !this.paused && !this.error && this.visible() && this.section === "routes" && !this.details) this.signal.replay(cx); }
  toggleMotion(cx) {
    this.motion = !this.motion;
    try { localStorage.setItem("routing-motion", this.motion ? "on" : "off"); } catch (_) { /* In-memory fallback. */ }
    this.signal.stop(); this.syncSignal(cx, false); cx.notify();
  }

  refresh(cx) {
    if (this.closed) return;
    if (this.loading) { this.queued = true; return; }
    const mode = this.mode, period = this.period, generation = ++this.generation;
    this.started = Date.now(); this.loading = true; this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const [base, query = ""] = this.endpoint.split("#")[0].split("?");
        const params = query.split("&").filter(part => part && !["mode", "period", "tz"].includes(part.split("=")[0]));
        params.push(`mode=${mode}`, `period=${period}`);
        if (this.zone) params.push(`tz=${encodeURIComponent(this.zone)}`);
        const response = await fetch(`${base}?${params.join("&")}`);
        const data = await response.json();
        if (!data || data.mode !== mode || data.period !== period || !Array.isArray(data.requests)
          || !Array.isArray(data.warnings) || !(data.usage === null || typeof data.usage === "object")
          || !(data.configuredGroups === null || Array.isArray(data.configuredGroups))) throw new Error("The bridge returned an incompatible dashboard. Update and restart the bridge.");
        if (!response.ok) throw new Error(plain(data.error || `Bridge returned HTTP ${response.status}`, 230));
        if (this.closed || generation !== this.generation || this.mode !== mode || this.period !== period) return;
        this.snapshot = data;
        if (!this.requests().some(row => row.id === this.selected)) this.selected = this.requests()[0]?.id || null;
        if (!this.groups().some(group => group.id === this.group)) this.group = this.groups()[0]?.id || null;
        this.syncSignal(cx);
      } catch (error) {
        if (!this.closed && generation === this.generation && mode === this.mode && period === this.period) {
          this.error = plain(error?.message || "Cannot read the local bridge. Start it and refresh.", 230);
          this.signal.stop();
        }
      } finally {
        if (!this.closed && generation === this.generation) {
          this.loading = false; cx.notify();
          if (this.queued) { this.queued = false; this.refresh(cx); }
        }
      }
    });
  }

  change(key, value, cx) {
    if (this[key] === value) return;
    this[key] = value;
    this.snapshot = null; this.selected = null; this.group = null;
    this.signal.stop();
    this.refresh(cx); cx.notify();
  }
  requests() { return (this.snapshot?.requests || []).filter(row => row && typeof row === "object").slice(0, 40); }
  groups() { return (this.snapshot?.configuredGroups || []).filter(row => row && typeof row === "object"); }

  key(e, cx) {
    const key = e.key?.toLowerCase();
    if (key === "r") this.refresh(cx);
    else if (key === "space") { this.paused = !this.paused; if (!this.paused) this.refresh(cx); }
    else if (key === "u") this.section = "usage";
    else if (key === "g") this.section = "routes";
    else if (key === "escape") this.details = false;
    else if (key === "enter" && this.selected) this.details = !this.details;
    else if (key === "d") this.change("mode", this.mode === "live" ? "demo" : "live", cx);
    else if (["1", "2", "3", "4"].includes(key)) this.change("period", PERIODS[Number(key) - 1][0], cx);
    else if (key === "up" || key === "down") {
      const rows = this.requests(), index = rows.findIndex(row => row.id === this.selected);
      this.selected = rows[Math.max(0, Math.min(rows.length - 1, index + (key === "up" ? -1 : 1)))]?.id || null;
    } else if (key === "left" || key === "right") {
      const groups = this.groups(), index = groups.findIndex(group => group.id === this.group);
      this.chooseGroup(groups[Math.max(0, Math.min(groups.length - 1, index + (key === "left" ? -1 : 1)))]?.id || null, cx);
    } else return;
    cx.stop_propagation(); cx.notify();
  }

  renderSignal(group, t, button) {
    const signal = this.signal, info = strategyInfo(group.strategy);
    const text = (value, color = t.muted, size = 11) => div().min_w(0).text_size(size).text_color(color).child(plain(value, 180));
    const root = v_flex().min_w(0).gap(7);
    root.child(h_flex().gap(5).items_center()
      .child(text(info.label, t.foreground, 12).flex_1())
      .when(Boolean(signal.events.length && this.motion && !this.paused && !this.error), el => el.child(button("route-replay", "Replay", false, cx => this.replay(cx))))
      .child(button("route-motion", this.motion ? "Motion on" : "Motion off", false, cx => this.toggleMotion(cx))));
    if (!signal.nodes.length) return root.child(text("No model destinations available."));
    const chart = div().id("routing-paths").relative().w_full().h(rowY(signal.nodes.length - 1) + 18).flex_none();
    chart.child(div().absolute().left(6).top(14).w(1).h(rowY(signal.nodes.length - 1) - 14).bg(t.border));
    chart.child(div().absolute().left(0).top(2).size(12).rounded(6).border_1().border_color(t.muted).bg(t.background));
    chart.child(text("Magpie", t.dim).absolute().left(22).top(0));
    signal.nodes.forEach((node, index) => {
      const active = signal.current && node.key === destinationKey(signal.current);
      const y = rowY(index);
      const color = active ? signal.current.status === "error" ? t.blocked : t.accent : t.border;
      chart.child(div().absolute().left(6).top(y).h(1).w(24).bg(color));
      chart.child(div().absolute().left(28).top(y - 2).size(5).rounded(3).bg(color));
      chart.child(h_flex().absolute().left(42).right(0).top(y - 14).h(30).gap(6).items_center()
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(text(node.model, active ? t.foreground : t.muted, 12).truncate())
          .child(text(node.provider, t.dim, 10).truncate()))
        .when(info.id === "weight" && !node.observed, el => el.child(text(`×${node.weight || 1}`, t.dim)))
        .when(node.enabled === false || node.ready === false, el => el.child(text("Off", t.dim))));
    });
    if (signal.current) {
      const moving = this.motion && !this.paused && !this.error && signal.moving;
      const pending = this.motion && !this.paused && !this.error && signal.current.status === "pending" && signal.label === "Latest observed route";
      const index = signal.nodes.findIndex(node => node.key === destinationKey(signal.current));
      const x = moving ? signal.x : 30, y = moving ? signal.y : rowY(index);
      const color = signal.current.status === "error" && !moving ? t.blocked : t.accent;
      let dot = div().id(`route-dot-${signal.serial}`).absolute().left(x - 6).top(y - 6).size(12)
        .accessibility_label(`${signal.label}: ${signal.current.provider}, ${signal.current.model}, ${state(signal.current.status)}`);
      if (moving) dot = dot.transition("left", { duration: 180, easing: "linear" }).transition("top", { duration: 240, easing: "linear" });
      dot.child(div().absolute().inset_0().rounded(6).bg(color).opacity(0.14));
      let core = div().absolute().left(3).top(3).size(6).rounded(3).bg(color);
      if (pending) core = core.loop("opacity", { from: 0.45, to: 1, period: 1200 });
      chart.child(dot.child(core));
    }
    root.child(chart).child(text(signal.label + (signal.current?.fallback ? " · fallback" : ""), t.dim));
    if (signal.total > signal.nodes.length) root.child(text(`Showing ${signal.nodes.length} of ${signal.total} model destinations.`, t.dim));
    return root.child(text(info.hint, t.dim));
  }

  renderPanel() {
    const t = theme(), snapshot = this.snapshot;
    const text = (value, color = t.muted, size = 12) => div().min_w(0).text_size(size).text_color(color).child(plain(value, 240));
    const line = () => div().h(1).flex_none().bg(t.border);
    const heading = title => text(title, t.foreground, 12).font_semibold();
    const button = (id, title, active, action) => div().id(id).role("button").tab_index(0)
      .h(28).px(8).flex().items_center().rounded(7).text_size(12).cursor_pointer()
      .bg(active ? t.selected : t.background).text_color(active ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).focus(s => s.bg(t.selected).text_color(t.accent))
      .on_key_down((e, cx) => { if (e.key === "enter" || e.key === "space") { cx.stop_propagation(); action(cx); } })
      .on_click((_e, cx) => { this.focus.focus(); action(cx); }).child(title);
    const pair = (name, value) => h_flex().min_w(0).gap(10).justify_between().items_start()
      .child(text(name).flex_none()).child(text(value, t.foreground).text_right().flex_1());
    const note = (message, color = t.muted) => text(message, color, 11);
    const status = this.error ? snapshot ? "Offline · last update retained" : "Not connected"
      : snapshot?.connection === "partial" ? "Partially available" : snapshot ? this.mode === "demo" ? "Demo data" : "Connected"
      : this.loading ? "Connecting…" : "Not connected";
    const root = v_flex().id("magpie-panel").size_full().min_w(0).min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.focus).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.focus.focus())
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } });
    root.child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().child("Magpie")).child(div().flex_1())
      .child(button("page-refresh", this.loading ? "Reading…" : "Refresh", false, cx => this.refresh(cx))));
    root.child(h_flex().px(6).py(5).gap(3).flex_none().items_center()
      .child(button("page-routes", "Routes", this.section === "routes", cx => { this.section = "routes"; this.details = false; cx.notify(); }))
      .child(button("page-usage", "Usage", this.section === "usage", cx => { this.section = "usage"; cx.notify(); }))
      .child(div().flex_1())
      .child(button("page-mode", this.mode === "demo" ? "Use live" : "Demo", this.mode === "demo", cx => this.change("mode", this.mode === "live" ? "demo" : "live", cx))));
    root.child(v_flex().px(14).pb(10).gap(4).flex_none().min_w(0)
      .child(text(snapshot?.service?.url || "Magpie service", t.muted, 11).truncate())
      .child(text(status, this.error ? t.blocked : t.dim, 11)));
    root.child(line());
    const body = v_flex().id("magpie-panel-body").flex_1().min_h(0).min_w(0).overflow_y_scrollbar().p(14).gap(12);
    if (this.mode === "demo") body.child(note("Synthetic preview · not your service's data."));
    if (this.error) body.child(note(this.error, t.blocked));
    for (const message of snapshot?.warnings || []) body.child(note(message, t.blocked));
    if (!snapshot) {
      body.child(heading(this.loading ? "Loading Magpie…" : "Connect your service"))
        .child(text("Set the service address and web access key in the local bridge's .env, then restart it and refresh."))
        .child(note("MAGPIE_WEB_URL · MAGPIE_WEB_KEY"))
        .child(note("Demo previews the panel with synthetic data."));
    } else if (this.section === "usage") {
      body.child(h_flex().gap(2).flex_wrap().children(PERIODS.map(([id, title]) => button(`period-${id}`, title, this.period === id, cx => this.change("period", id, cx)))));
      body.child(note(`${PERIODS.find(([id]) => id === this.period)?.[1]} · ${plain(snapshot.zone)}`));
      const usage = snapshot.usage;
      if (!usage) body.child(note("Usage is unavailable. Check the connection and refresh.", t.blocked));
      else {
        const totals = v_flex().gap(9);
        for (const [name, value] of [["Requests", count(usage.calls)], ["Errors", count(usage.errors)], ["Input tokens", count(usage.input)],
          ["Output tokens", count(usage.output)], ["Cache read", count(usage.cache_read)], ["Cache write", count(usage.cache_write)]]) totals.child(pair(name, value));
        body.child(totals).child(line()).child(pair("Reported cost · USD", money(usage.cost)))
          .child(note(usage.unpriced > 0 ? `${count(usage.unpriced)} calls have no known price. Cost covers priced calls only.` : "Magpie-reported cost; subscription invoices may differ."));
        body.child(line()).child(heading("Models"));
        const models = Array.isArray(usage.models) ? usage.models : [];
        if (!models.length) body.child(note("No model usage in this period."));
        for (const model of models) body.child(v_flex().min_w(0).gap(6)
          .child(text(model.model, t.foreground, 13).truncate())
          .child(text(model.provider, t.dim, 11).truncate())
          .child(pair("Requests / errors", `${count(model.calls)} / ${count(model.errors)}`))
          .child(pair("Input / output", `${count(model.input)} / ${count(model.output)}`))
          .child(pair("Cost", money(model.cost))).child(line()));
        body.child(note("Totals cover the full selected period. Top 20 models shown."));
      }
    } else if (this.details && this.requests().some(row => row.id === this.selected)) {
      const selected = this.requests().find(row => row.id === this.selected);
      body.child(button("panel-back", "Back to requests", false, cx => { this.details = false; cx.notify(); }))
        .child(text(selected.model, t.foreground, 13).font_semibold())
        .child(text(`${state(selected.status)} · ${time(selected.timestamp)}`, stateColor(selected.status, t), 11))
        .child(pair("Requested", plain(selected.requestedModel, 90)))
        .child(pair("Provider", plain(selected.provider, 70)))
        .child(pair("Duration", duration(selected.durationMs)))
        .child(pair("First token", duration(selected.ttftMs)))
        .child(pair("Input / output", `${count(selected.inputTokens)} / ${count(selected.outputTokens)}`))
        .child(pair("Fallback", selected.fallback === null ? "Unknown" : selected.fallback ? "Observed" : "Not observed"))
        .child(line()).child(heading("Routing attempts"));
      if (!selected.attempts?.length) body.child(note("No attempt history was returned."));
      for (const [index, attempt] of (selected.attempts || []).entries()) body.child(v_flex().gap(5)
        .child(text(`${index + 1}. ${plain(attempt.provider, 40)}`, t.foreground))
        .child(text(attempt.model, t.foreground))
        .child(text(`${state(attempt.status)} · ${duration(attempt.durationMs)}`, stateColor(attempt.status, t), 11)));
      body.child(note("Up / Down selects another request. Esc returns to the list."));
    } else {
      const groups = this.groups(), selectedGroup = groups.find(group => group.id === this.group);
      body.child(heading("Routing groups"));
      if (!groups.length) body.child(note(snapshot.configuredGroups === null ? "Group configuration is unavailable. Connect the Magpie web service." : "No routing groups are configured."));
      else {
        const list = v_flex().id("magpie-panel-groups").min_w(0).max_h(168).overflow_y_scrollbar().gap(2);
        for (const [index, group] of groups.entries()) list.child(h_flex().id(`route-group-${index}`).role("button").tab_index(0)
          .h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
          .bg(group.id === this.group ? t.selected : t.background).hover(s => s.bg(t.hover)).focus(s => s.bg(t.selected).text_color(t.accent))
          .on_click((_e, cx) => this.chooseGroup(group.id, cx))
          .on_key_down((e, cx) => { if (e.key === "enter" || e.key === "space") { cx.stop_propagation(); this.chooseGroup(group.id, cx); } })
          .child(text(group.name, t.foreground, 13).flex_1().truncate())
          .child(text(!group.enabled ? "Disabled" : group.ready === false ? "Unavailable" : strategyInfo(group.strategy).label, t.dim, 11).truncate()));
        body.child(list);
        if (selectedGroup) body.child(this.renderSignal(selectedGroup, t, button));
      }
      body.child(line()).child(heading("Recent requests")).child(note("Latest 40 · past 24 hours · select to inspect"));
      const rows = this.requests();
      if (!rows.length) body.child(note("No recent requests."));
      for (const [index, row] of rows.entries()) body.child(v_flex().id(`request-${index}`).role("button").tab_index(0)
        .px(8).py(7).gap(4).min_w(0).rounded(7).cursor_pointer()
        .bg(row.id === this.selected ? t.selected : t.background).hover(s => s.bg(t.hover)).focus(s => s.bg(t.selected).text_color(t.accent))
        .on_click((_e, cx) => { this.selected = row.id; this.details = true; cx.notify(); })
        .on_key_down((e, cx) => { if (e.key === "enter" || e.key === "space") { cx.stop_propagation(); this.selected = row.id; this.details = true; cx.notify(); } })
        .child(text(row.model, t.foreground, 13).truncate())
        .child(text(`${plain(row.group || "Direct", 30)} → ${plain(row.provider, 35)}`, t.muted, 11).truncate())
        .child(h_flex().justify_between().gap(6)
          .child(text(`${state(row.status)}${row.fallback ? " · Fallback" : ""}`, stateColor(row.status, t), 11).truncate())
          .child(text(`${time(row.timestamp)} · ${duration(row.durationMs)}`, t.dim, 11).flex_none())));
    }
    return root.child(body).child(line())
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center()
        .child(text(`Updated ${time(snapshot?.updatedAt)}${this.paused ? " · paused" : " · 10s"}`, t.dim, 11).flex_1().truncate())
        .child(button("page-pause", this.paused ? "Resume" : "Pause", this.paused, cx => { this.paused = !this.paused; if (!this.paused) this.refresh(cx); cx.notify(); })));
  }

  render() {
    if (this.sidebar) return this.renderPanel();
    const t = theme(), narrow = this.width < 760;
    const label = (value, color = t.muted, size = 12) => div().text_size(size).text_color(color).child(plain(value, 240));
    const heading = title => div().text_size(15).font_semibold().text_color(t.foreground).child(title);
    const line = () => div().h(1).w_full().bg(t.border);
    const button = (id, title, active, action) => div().id(id).role("button").tab_index(0).px(11).py(7).rounded(5).text_size(12)
      .bg(active ? t.selected : t.raised).text_color(active ? t.foreground : t.muted).cursor_pointer()
      .focus(s => s.bg(t.selected).text_color(t.accent)).hover(s => s.bg(t.hover))
      .on_key_down((e, cx) => { if (e.key === "enter" || e.key === "space") { cx.stop_propagation(); action(cx); } })
      .on_click((_e, cx) => { this.focus.focus(); action(cx); }).child(title);
    const pair = (name, value) => (narrow ? v_flex() : h_flex().justify_between()).gap(5)
      .child(label(name)).child(label(value, t.foreground));
    const warning = (value, color = t.blocked) => v_flex().gap(6).p(12).bg(t.raised).border(1).border_color(t.border)
      .child(label(value, color));
    const snapshot = this.snapshot;
    const status = this.error ? "Offline · showing last update" : snapshot?.connection === "partial" ? "Partially available"
      : snapshot ? this.mode === "demo" ? "Demo data" : "Connected" : this.loading ? "Connecting…" : "Not connected";
    const root = v_flex().id("magpie-dashboard-root").size_full().min_w(0).min_h(0).bg(t.surface).text_color(t.foreground)
      .track_focus(this.focus).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.focus.focus())
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } });
    const top = v_flex().px(narrow ? 16 : 26).py(18).gap(12);
    top.child((narrow ? v_flex() : h_flex().justify_between().items_center()).gap(10)
      .child(v_flex().gap(5).child(div().text_size(23).font_semibold().child("Magpie"))
        .child(label(snapshot?.service?.url || "Connect your Magpie service in the bridge .env", t.muted)))
      .child(label(!snapshot && this.error ? "Not connected" : status, this.error ? t.blocked : snapshot?.connection === "partial" ? t.working : t.muted)));
    top.child(h_flex().gap(6).flex_wrap().items_center()
      .child(button("page-routes", "Routes", this.section === "routes", cx => { this.section = "routes"; cx.notify(); }))
      .child(button("page-usage", "Usage", this.section === "usage", cx => { this.section = "usage"; cx.notify(); }))
      .child(div().flex_1())
      .child(button("page-mode", this.mode === "demo" ? "Use live data" : "Preview demo", false, cx => this.change("mode", this.mode === "live" ? "demo" : "live", cx)))
      .child(button("page-pause", this.paused ? "Resume" : "Pause", this.paused, cx => { this.paused = !this.paused; if (!this.paused) this.refresh(cx); cx.notify(); }))
      .child(button("page-refresh", this.loading ? "Refreshing…" : "Refresh", false, cx => this.refresh(cx))));
    root.child(top).child(line());
    const body = v_flex().id("magpie-dashboard-scroll").flex_1().min_h(0).min_w(0).overflow_y_scrollbar()
      .px(narrow ? 16 : 26).py(20).gap(18);
    if (this.mode === "demo") body.child(warning("Synthetic preview. These routes and usage figures do not represent your Magpie service.", t.muted));
    if (this.error) body.child(warning(this.error));
    for (const message of snapshot?.warnings || []) body.child(warning(message));
    if (!snapshot) {
      body.child(v_flex().gap(10).py(18).child(heading(this.loading ? "Loading your service…" : "Connect Magpie"))
        .child(label("Start the local bridge with your service address and web access key."))
        .child(label("Set MAGPIE_WEB_URL to the web service origin, including its port, and MAGPIE_WEB_KEY to its access key."))
        .child(label("Then restart the bridge and choose Refresh. Preview demo shows the page with synthetic data.")));
    } else if (this.section === "usage") {
      const usage = snapshot.usage;
      body.child(h_flex().gap(6).flex_wrap().children(PERIODS.map(([id, title]) => button(`period-${id}`, title, this.period === id, cx => this.change("period", id, cx)))));
      body.child(label(`Usage period: ${PERIODS.find(([id]) => id === this.period)?.[1]} · ${plain(snapshot.zone)}`));
      if (!usage) body.child(warning("Usage is unavailable. Check the service connection and refresh."));
      else {
        const measurements = [["Requests", count(usage.calls)], ["Errors", count(usage.errors)], ["Input tokens", count(usage.input)],
          ["Output tokens", count(usage.output)], ["Cache read", count(usage.cache_read)], ["Cache write", count(usage.cache_write)]];
        body.child(heading("Usage totals"));
        const metrics = v_flex().gap(13);
        const columns = narrow ? 2 : 3;
        for (let i = 0; i < measurements.length; i += columns) {
          metrics.child(h_flex().gap(16).children(measurements.slice(i, i + columns).map(([name, value]) => v_flex().flex_1().min_w(0).gap(5)
            .child(label(name)).child(label(value, t.foreground, 21)))));
        }
        body.child(metrics).child(line()).child(pair("Reported cost · USD", money(usage.cost)))
          .child(label(usage.unpriced > 0 ? `${count(usage.unpriced)} calls have no known price. Reported cost covers priced calls only.` : "Prices are reported by Magpie; subscription invoices may differ."));
        body.child(heading("Models"));
        const models = Array.isArray(usage.models) ? usage.models : [];
        if (!models.length) body.child(label("No model usage in this period."));
        for (const model of models) body.child(v_flex().gap(6).py(8)
          .child(label(`${plain(model.provider, 50)} / ${plain(model.model, 110)}`, t.foreground, 13))
          .child(pair("Requests / errors", `${count(model.calls)} / ${count(model.errors)}`))
          .child(pair("Input / output tokens", `${count(model.input)} / ${count(model.output)}`))
          .child(pair("Reported cost", money(model.cost))).child(line()));
        body.child(label("Top 20 models by requests. Totals cover the full selected period, independent of the recent request list."));
      }
    } else {
      const groups = this.groups(), rows = this.requests(), group = groups.find(item => item.id === this.group);
      body.child(heading("Routing groups"));
      if (!groups.length) body.child(label(snapshot.configuredGroups === null ? "Route configuration is unavailable. Use the authenticated Magpie web endpoint." : "No routing groups are configured on this service."));
      else {
        body.child(h_flex().gap(6).flex_wrap().children(groups.map((item, i) => button(`route-group-${i}`, plain(item.name, 40), item.id === this.group, cx => { this.group = item.id; cx.notify(); }))));
        if (group) {
          body.child((narrow ? v_flex() : h_flex().justify_between()).gap(6)
            .child(label(`${plain(group.ref || group.name)} · ${plain(group.strategy)} routing`, t.foreground))
            .child(label(!group.enabled ? "Disabled" : group.ready === false ? "No ready members" : group.ready ? "Ready" : "Readiness unknown", !group.enabled || group.ready === false ? t.working : t.muted)));
          if (!group.members?.length) body.child(label("No member details were returned."));
          for (const member of group.members || []) body.child((narrow ? v_flex() : h_flex().justify_between()).gap(6)
            .child(label(`${plain(member.provider, 50)} / ${plain(member.model, 110)}`, t.foreground))
            .child(label(!member.enabled ? "Disabled" : member.ready === true ? "Ready" : member.ready === false ? "Unavailable" : "Unknown")));
        }
      }
      body.child(line()).child(heading("Recent requests"))
        .child(label("Latest 40 visible requests from the past 24 hours. Select one to inspect its route."));
      if (!rows.length) body.child(label("No recent requests were returned by this service."));
      else {
        const selected = rows.find(row => row.id === this.selected);
        const requests = v_flex().id("magpie-request-list").gap(3).min_w(0).max_h(440).overflow_y_scrollbar();
        for (const [index, row] of rows.entries()) requests.child(v_flex().id(`request-${index}`).role("button").tab_index(0).p(10).gap(5).rounded(5)
          .bg(row.id === this.selected ? t.selected : t.surface).cursor_pointer().hover(s => s.bg(t.hover))
          .focus(s => s.bg(t.selected).text_color(t.accent))
          .on_key_down((e, cx) => { if (e.key === "enter" || e.key === "space") { cx.stop_propagation(); this.selected = row.id; cx.notify(); } })
          .on_click((_e, cx) => { this.selected = row.id; cx.notify(); })
          .child(label(plain(row.model, 62), t.foreground, 13))
          .child(label(`${time(row.timestamp)} · ${plain(row.group || "Direct", 28)} → ${plain(row.provider, 28)}`))
          .child(label(`${state(row.status)} · ${duration(row.durationMs)}${row.fallback ? " · Fallback" : ""}`, stateColor(row.status, t))));
        const detail = v_flex().min_w(0).gap(12).p(16).bg(t.raised).rounded(6);
        if (selected) {
          detail.child(heading("Selected request"))
            .child(pair("Result", state(selected.status)))
            .child(pair("Requested", plain(selected.requestedModel, 100)))
            .child(pair("Model", plain(selected.model, 100)))
            .child(pair("Provider", plain(selected.provider, 70)))
            .child(pair("Duration / first token", `${duration(selected.durationMs)} / ${duration(selected.ttftMs)}`))
            .child(pair("Input / output tokens", `${count(selected.inputTokens)} / ${count(selected.outputTokens)}`))
            .child(pair("Fallback", selected.fallback === null ? "Unknown" : selected.fallback ? "Observed" : "Not observed"))
            .child(line()).child(heading("Routing attempts"));
          if (!selected.attempts?.length) detail.child(label("No attempt history is available for this request."));
          for (const [i, attempt] of (selected.attempts || []).entries()) detail.child(v_flex().gap(5)
            .child(label(`${i + 1}. ${plain(attempt.provider, 40)} / ${plain(attempt.model, 90)}`, t.foreground))
            .child(label(`${state(attempt.status)} · ${duration(attempt.durationMs)}`, stateColor(attempt.status, t))));
        }
        if (narrow) body.child(detail).child(requests);
        else body.child(h_flex().gap(22).items_start().child(requests.flex_1()).child(detail.flex_1()));
      }
    }
    return root.child(body).child(line())
      .child(v_flex().px(narrow ? 16 : 26).py(9).gap(3)
        .child(label(`Updated ${time(snapshot?.updatedAt)} · ${this.paused ? "Auto refresh paused" : "Refreshes every 10 seconds while this page is visible"}`, t.muted, 11))
        .child(label("G Routes · U Usage · R Refresh · Space Pause · D Demo/live · 1–4 Period · ↑↓ Request · ←→ Group", t.muted, 10)));
  }
}
