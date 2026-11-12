import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, layout, nextCommand, props as hostProps } from "herdr";
import config from "./config.js";
import { strategyInfo } from "./routing.js";
import { TraceStore, LiveRouting } from "./live-routing.js";
import { tokenTotal, cacheHit, usageBars } from "./usage.js";
import { ConnectionForm } from "./connection.js";
import { PERIODS, plain, count, compact, money, percent, duration, time, clientName, resultInfo, needsAttention, laneDynamics, resetLabel, allowanceLabel } from "./presentation.js";

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
    this.stack = props?.stack; this.page = props?.page;
    this.modName = config.modName || "magpie-dashboard";
    this.mode = "live";
    this.section = ["routes", "usage", "cost"].includes(props?.section) ? props.section : "routes";
    this.period = "today"; this.zone = "";
    try { this.zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) {}
    this.width = this.sidebar ? 368 : 1000;
    this.snapshot = null; this.selected = null; this.details = false; this.closed = false;
    this.requestFilter = "all";
    this.rowFocus = Array.from({ length: 80 }, () => cx.focus_handle());
    this.loading = false; this.queued = false; this.error = ""; this.generation = 0; this.blocked = false;
    this.unconfigured = false; this.connectionOpen = false; this.connectionRevision = null;
    this.trace = new TraceStore(); this.traceBusy = false; this.traceCaught = true;
    this.traceError = ""; this.traceConnected = false; this.traceNext = 0; this.traceGeneration = 0;
    this.allowances = null; this.allowanceBusy = false; this.allowanceError = ""; this.allowanceGeneration = 0;
    this.allowanceNext = 0; this.allowanceBlocked = false;
    this.withCache = true; this.usageBreakdown = "models";
    this.motion = config.motion !== false;
    try { const saved = localStorage.getItem("routing-motion"); if (saved) this.motion = saved === "on"; } catch (_) {}
    this.live = new LiveRouting(() => this.traceVisible() && !this.details && this.motion && this.traceConnected);
    this.connection = new ConnectionForm(this.endpoint, (info, next) => this.useConnection(info, next), next => {
      this.connectionOpen = false; this.traceCaught = true; this.focus.focus(); this.activate(this.section, next);
    }, { motion: () => this.motion, toggleMotion: next => this.toggleMotion(next) });
    this.focus = cx.focus_handle();
    cx.spawn(async current => { for (;;) {
      const command = await nextCommand();
      if (command === "focus") this.focus.focus();
      else if (["routes", "usage", "cost"].includes(command)) this.activate(command, current);
      else if (command === "refresh") this.refreshAll(current);
      else if (command === "connection") this.openConnection(current);
      current.notify();
    } });
    cx.timer.every(1000, current => {
      if (!this.traceVisible()) {
        this.traceCaught = true;
        if (this.live.dots.size) { this.live.stop(); current.notify(); }
      } else if (!this.traceBusy && Date.now() >= this.traceNext) this.pollTrace(current);
      if (this.traceBusy && Date.now() - this.traceStarted > 35000) {
        this.traceGeneration++; this.traceBusy = false; this.traceNext = Infinity;
        this.traceError = "Routing timed out. Refresh to reconnect."; this.traceConnected = false;
        this.traceCaught = true; this.live.stop(); current.notify();
      }
      if (this.allowanceBusy && Date.now() - this.allowanceStarted > 25000) {
        this.allowanceGeneration++; this.allowanceBusy = false; this.allowanceBlocked = true;
        this.allowanceError = "Allowances timed out. Refresh to retry."; current.notify();
      }
    });
    cx.timer.every(5000, current => {
      if (this.loading && Date.now() - this.started >= 15000) {
        this.generation++; this.loading = false; this.queued = false; this.blocked = true;
        this.error = "The bridge did not respond within 15 seconds. Refresh to retry."; current.notify();
      } else if (!this.loading && !this.blocked && !this.connectionOpen && this.visible() && Date.now() - (this.started || 0) >= 10000) this.refresh(current);
      if (this.section === "usage" && this.visible() && !this.connectionOpen && !this.allowanceBlocked && Date.now() >= this.allowanceNext) this.loadAllowances(current);
    });
    this.refresh(cx);
    this.activate(this.section, cx);
  }

  api(path) { return this.endpoint.split("#")[0].split("?")[0].replace(/\/api\/dashboard$/, path); }
  openConnection(cx) { this.connectionOpen = true; this.traceCaught = true; this.live.stop(); this.connection.open(cx); cx.notify(); }
  resetData() {
    this.snapshot = null; this.selected = null; this.details = false;
    this.trace.clear(); this.live.stop(); this.live.routes.clear(); this.live.project();
    this.traceCaught = true; this.traceConnected = false;
    this.allowances = null; this.allowanceError = ""; this.allowanceGeneration++; this.allowanceBusy = false;
    this.allowanceNext = 0; this.allowanceBlocked = false;
  }
  useConnection(info, cx) {
    this.connectionOpen = false; this.connectionRevision = info.revision; this.unconfigured = false;
    this.resetData(); this.error = ""; this.traceError = ""; this.blocked = false;
    this.generation++; this.loading = false; this.queued = false;
    this.traceGeneration++; this.traceBusy = false; this.traceNext = 0;
    this.focus.focus(); this.refresh(cx); this.activate(this.section, cx);
  }
  adoptRevision(value, keepTraceRequest = false) {
    if (!Number.isSafeInteger(value) || value === this.connectionRevision) return;
    const changed = this.connectionRevision !== null; this.connectionRevision = value;
    if (changed) {
      this.resetData();
      if (!keepTraceRequest) { this.traceGeneration++; this.traceBusy = false; this.traceNext = 0; }
      else { this.generation++; this.loading = false; this.queued = false; }
    }
  }
  visible() {
    if (this.stack && this.page) return find(layout(), this.stack)?.active === this.page;
    if (!this.sidebar) return true;
    const shown = node => node && !node.hidden && (node.type === "block" && node.content?.mod === this.modName
      || (node.children || []).some(child => (node.type !== "stack" || !node.active || child.id === node.active) && shown(child)));
    return Boolean(shown(layout()));
  }
  close() { this.closed = true; this.generation++; this.traceGeneration++; this.allowanceGeneration++; this.live.stop(); this.connection.dispose(); }
  traceVisible() { return !this.closed && !this.connectionOpen && this.visible() && this.section === "routes"; }
  activate(section, cx) {
    if (this.section !== section) { this.live.stop(); this.traceCaught = true; }
    this.section = section; this.details = false;
    if (section === "routes") this.pollTrace(cx);
    if (section === "usage" && !this.allowances) this.loadAllowances(cx, true);
    cx.notify();
  }
  pollTrace(cx) {
    if (!this.traceVisible() || this.traceBusy || this.traceNext === Infinity) return;
    this.traceBusy = true; this.traceStarted = Date.now();
    const generation = ++this.traceGeneration;
    const url = `${this.api('/api/routing')}?mode=live&after=${this.trace.seq}&epoch=${this.trace.epoch}${this.trace.loaded ? '&wait=1' : ''}`;
    cx.spawn(async current => {
      try {
        const response = await fetch(url), frame = await response.json();
        if (!response.ok) throw new Error(frame?.error || "Routing unavailable");
        if (!Array.isArray(frame.routes) || !Number.isSafeInteger(frame.seq) || typeof frame.epoch !== "string" || frame.mode !== "live") throw new Error("Update and restart the bridge.");
        if (generation !== this.traceGeneration || this.closed) return;
        if (!this.traceVisible()) { this.traceCaught = true; return; }
        this.adoptRevision(frame.connectionRevision, true);
        if (!frame.mine) { this.traceConnected = false; this.traceCaught = true; this.traceError = "The gateway is not routing yet."; this.traceNext = Date.now() + 5000; this.live.stop(); return; }
        const result = this.trace.apply(frame, this.traceCaught);
        this.traceCaught = false; this.traceConnected = true; this.traceError = "";
        this.live.ingest(this.trace, result.play, current, { animate: this.motion && !this.details, reset: result.reset });
        this.traceNext = Date.now() + 50;
      } catch (error) {
        if (generation === this.traceGeneration && !this.closed) {
          this.traceError = plain(error?.message || "Routing unavailable"); this.traceConnected = false;
          this.traceCaught = true; this.traceNext = Date.now() + 3000; this.live.stop();
        }
      } finally {
        if (generation === this.traceGeneration && !this.closed) {
          this.traceBusy = false; current.notify();
          if (this.traceVisible() && this.traceConnected && this.traceNext <= Date.now() + 50) current.timer.after(50, next => this.pollTrace(next));
        }
      }
    });
  }
  toggleMotion(cx) {
    this.motion = !this.motion;
    try { localStorage.setItem("routing-motion", this.motion ? "on" : "off"); } catch (_) {}
    this.live.stop(); this.live.ingest(this.trace, [...this.trace.routes.values()].filter(route => !route.done).map(route => route.id), cx,
      { animate: this.motion && !this.details && this.traceVisible() && this.traceConnected }); cx.notify();
  }
  refreshAll(cx) {
    this.blocked = false; this.allowanceBlocked = false; this.traceNext = 0;
    this.refresh(cx); if (this.traceVisible()) this.pollTrace(cx);
    if (this.section === "usage") this.loadAllowances(cx, true);
  }
  refresh(cx) {
    if (this.closed) return;
    if (this.loading) { this.queued = true; return; }
    const period = this.period, generation = ++this.generation;
    this.started = Date.now(); this.loading = true; this.error = ""; cx.notify();
    cx.spawn(async current => {
      try {
        const response = await fetch(`${this.api('/api/dashboard')}?mode=live&period=${period}${this.zone ? `&tz=${encodeURIComponent(this.zone)}` : ''}`);
        const data = await response.json();
        if (this.closed || generation !== this.generation || this.period !== period) return;
        if (!response.ok) { this.unconfigured = data.connection === "unconfigured"; throw new Error(data.error || "Cannot read Magpie. Refresh to retry."); }
        if (!data || data.mode !== "live" || data.period !== period || !Array.isArray(data.requests) || !Array.isArray(data.warnings)
          || !(data.usage === null || data.usage && typeof data.usage === 'object')
          || !(data.configuredGroups === null || Array.isArray(data.configuredGroups))) throw new Error("Update and restart the local bridge.");
        this.adoptRevision(data.connectionRevision); this.snapshot = data; this.unconfigured = false;
      } catch (error) {
        if (!this.closed && generation === this.generation && period === this.period) this.error = plain(error?.message || "Cannot reach the bridge. Refresh to retry.");
      } finally {
        if (!this.closed && generation === this.generation) {
          this.loading = false; current.notify();
          if (this.queued) { this.queued = false; this.refresh(current); }
        }
      }
    });
  }
  loadAllowances(cx, asked = false) {
    if (this.closed || this.allowanceBusy) return;
    this.allowanceBusy = true; this.allowanceStarted = Date.now(); this.allowanceError = "";
    const generation = ++this.allowanceGeneration, revision = this.connectionRevision;
    cx.notify();
    cx.spawn(async current => {
      try {
        const response = await fetch(`${this.api('/api/allowances')}${asked ? '?refresh=1' : ''}`), data = await response.json();
        if (this.closed || generation !== this.allowanceGeneration || revision !== null && revision !== this.connectionRevision) return;
        if (!response.ok) throw new Error(data.error || "Allowances unavailable");
        if (!Array.isArray(data.cards)) throw new Error("Update the bridge to read subscription allowances.");
        if (Number.isSafeInteger(data.connectionRevision) && data.connectionRevision !== this.connectionRevision && this.connectionRevision !== null) {
          this.adoptRevision(data.connectionRevision); this.refresh(current); return;
        }
        this.allowances = data;
      } catch (error) {
        if (!this.closed && generation === this.allowanceGeneration) this.allowanceError = plain(error?.message || "Allowances unavailable");
      } finally {
        if (!this.closed && generation === this.allowanceGeneration) {
          this.allowanceBusy = false; this.allowanceNext = Date.now() + 30000; current.notify();
        }
      }
    });
  }
  change(key, value, cx) {
    if (key !== "period" || !PERIODS.some(([id]) => id === value) || this.period === value) return;
    this.period = value; this.refresh(cx); cx.notify();
  }
  requests() {
    const merged = new Map((this.snapshot?.requests || []).filter(row => row && typeof row === "object").map(row => [row.id, row]));
    for (const [id, route] of this.trace.routes) {
      const previous = merged.get(id), next = { ...previous, ...route };
      for (const field of ["inputTokens", "outputTokens", "ttftMs", "cacheReadTokens", "cacheWriteTokens", "cacheHit"]) next[field] = route[field] ?? previous?.[field];
      if (!next.agent) next.agent = previous?.agent;
      merged.set(id, next);
    }
    return [...merged.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 80);
  }
  filteredRequests() {
    const rows = this.requests();
    return this.requestFilter === "attention" ? rows.filter(needsAttention) : rows;
  }
  setRequestFilter(filter, cx) {
    if (!["all", "attention"].includes(filter) || this.requestFilter === filter) return;
    this.requestFilter = filter; this.selected = null; this.details = false;
    cx.notify();
  }
  routeInfo(row) {
    const group = (this.snapshot?.configuredGroups || []).find(group => group.id === row.group || group.ref && group.ref === row.groupRef);
    return { name: row.groupName || group?.name || row.group || row.groupRef || "Direct",
      strategy: strategyInfo(row.strategy || group?.strategy || (row.group || row.groupRef ? "default" : "direct")).label };
  }
  key(e, cx) {
    if (this.connectionOpen) return;
    const key = e.key?.toLowerCase();
    if (key === "r") this.refreshAll(cx);
    else if (key === "u") this.activate("usage", cx);
    else if (key === "c") this.activate("cost", cx);
    else if (key === "g") this.activate("routes", cx);
    else if (key === "escape") { this.details = false; this.pollTrace(cx); }
    else if (key === "enter" && this.selected) {
      if (this.details) { this.details = false; this.pollTrace(cx); }
      else {
        const row = this.requests().find(request => request.id === this.selected);
        if (!row) return;
        this.openDetail(row, cx);
      }
    }
    else if (["1", "2", "3", "4"].includes(key) && this.section === "cost") this.change("period", PERIODS[Number(key) - 1][0], cx);
    else if (key === "up" || key === "down") {
      const rows = this.filteredRequests(), index = rows.findIndex(row => row.id === this.selected);
      const nextIndex = Math.max(0, Math.min(rows.length - 1, index + (key === "up" ? -1 : 1))), row = rows[nextIndex];
      this.selected = row?.id || null;
      if (row) this.rowFocus[nextIndex]?.focus();
    } else return;
    cx.stop_propagation(); cx.notify();
  }

  renderSignal(ui) {
    const { t, text, line } = ui, signal = this.live;
    const root = v_flex().id("routing-paths").flex_none().mx(8).mt(6).mb(2).px(8).pt(9).pb(8).gap(2)
      .rounded(8).bg(t.surface).border_1().border_color(t.border);
    const pending = [...signal.routes.values()].filter(row => !row.done).length;
    const statusBar = h_flex().items_center().gap(6);
    if (!this.motion) statusBar.child(div().id("motion-off-pill").px(6).h(20).rounded(10).bg(t.raised).border_1().border_color(t.border)
      .flex().items_center().child(text("Motion off", t.muted, 11)));
    if (signal.overflow > 0) statusBar.child(div().id("routing-overflow").px(6).h(20).rounded(10).bg(t.raised).border_1().border_color(t.border)
      .flex().items_center().child(text(`+${signal.overflow} queued`, t.muted, 11)));
    if (pending > 0) statusBar.child(h_flex().id("routing-active").px(7).h(20).gap(5).rounded(10).bg(t.raised).border_1().border_color(t.border).items_center()
      .child(div().size(6).rounded(3).bg(t.accent).when(this.motion, el => el.loop("opacity", { from: 0.36, to: 1, period: 1200 })))
      .child(text(`${pending} active`, t.foreground, 11).font_medium()));
    root.child(h_flex().h(24).px(4).items_center().justify_between()
      .child(text("Live routing", t.foreground, 14).font_semibold()).child(statusBar));
    if (!signal.lanes.length) return root.child(text("Waiting for requests", t.muted, 13).px(4).py(14));
    const width = Math.max(180, this.width - 52);
    for (const route of signal.lanes) {
      const packet = signal.dots.get(route.id), attempt = packet ? route.attempts[packet.attempt] : route.attempts.at(-1);
      const result = resultInfo(route), info = this.routeInfo(route), group = info.name;
      const model = attempt?.served || attempt?.model || route.model || "Selecting model";
      const dyn = laneDynamics(route, packet, width), color = t[dyn.tone] || t.accent;
      const selected = this.selected === route.id;
      const lane = div().id(`lane-${route.id}`).role("button").tab_index(0).h(78).flex_none().min_w(0).px(6).rounded(7)
        .bg(selected ? t.selected : t.surface).border_1().border_color(selected ? t.accent : t.surface).cursor_pointer()
        .hover(s => s.bg(t.hover)).focus(s => s.bg(t.selected).border_color(t.accent))
        .accessibility_label(`${clientName(route.agent)} through ${group} to ${model}, ${result.label}${dyn.stage ? `, ${dyn.stage}` : ""}`)
        .on_click((_event, cx) => this.openDetail(route, cx))
        .on_key_down((event, cx) => { if (event.key === "enter" || event.key === "space") { cx.stop_propagation(); this.openDetail(route, cx); } });
      const track = div().relative().size_full().min_w(0);
      track.child(h_flex().absolute().left(0).right(0).top(4).items_center().gap(6)
        .child(text(clientName(route.agent), t.foreground, 13).font_medium().w(Math.max(64, dyn.middle - 14)).flex_none().truncate())
        .child(h_flex().gap(6).items_center().flex_1().min_w(0).justify_between()
          .child(text(group, t.muted, 12).flex_1().truncate())
          .when(dyn.attemptCount > 1, el => el.child(div().id(`lane-try-${route.id}`).px(5).h(16).rounded(4).bg(t.raised)
            .border_1().border_color(t.working).flex().items_center().flex_none()
            .child(text(`Try ${dyn.attemptIndex + 1}`, t.working, 11).font_medium())))));
      track.child(line().absolute().left(dyn.start).w(dyn.end - dyn.start).top(35));
      track.child(div().id(`lane-ingress-${route.id}`).absolute().left(dyn.ingress.left).top(34).w(dyn.ingress.width).h(2).rounded(1)
        .bg(color).opacity(dyn.ingress.opacity)
        .when(this.motion, el => el.spring("width", { response: 210, damping: 1 }).transition("opacity", { duration: 160, easing: "ease-out" })));
      track.child(div().id(`lane-upstream-${route.id}`).absolute().left(dyn.upstream.left).top(34).w(dyn.upstream.width).h(2).rounded(1)
        .bg(color).opacity(dyn.upstream.opacity)
        .when(this.motion, el => el.spring("width", { response: 210, damping: 1 }).transition("opacity", { duration: 160, easing: "ease-out" })));
      if (packet) track.child(div().id(`route-wake-${packet.id}`).absolute().left(dyn.wake.left).top(34).w(dyn.wake.width).h(2).rounded(1)
        .bg(color).opacity(dyn.wake.opacity)
        .when(this.motion, el => el.spring("left", { response: 190, damping: 1 }).spring("width", { response: 190, damping: 1 })
          .transition("opacity", { duration: 140, easing: "ease-out" })));
      track.child(div().id(`station-client-${route.id}`).absolute().left(dyn.start - 4).top(31).size(8).rounded(2)
        .bg(dyn.station === "client" ? t.selected : t.background).border_1().border_color(dyn.station === "client" ? color : t.muted));
      track.child(div().id(`station-group-${route.id}`).absolute().left(dyn.middle - 4).top(31).size(8).rounded(3)
        .bg(t.background).border_1().border_color(dyn.station === "group" ? color : dyn.recovered ? t.working : t.muted)
        .child(div().absolute().left(2).top(2).size(2).rounded(1).bg(dyn.station === "group" ? color : dyn.recovered ? t.working : t.muted)));
      if (dyn.halo.active) track.child(div().id(`lane-halo-${route.id}`).absolute().left(dyn.end - 8).top(27).size(16).rounded(8)
        .border_1().border_color(color).opacity(dyn.halo.opacity)
        .when(this.motion && dyn.halo.pulse, el => el.loop("opacity", { from: 0.16, to: 0.58, period: 1200, easing: "ease-in-out" })));
      track.child(div().id(`station-model-${route.id}`).absolute().left(dyn.end - 4).top(31).size(8).rounded(4)
        .bg(t.background).border_1().border_color(dyn.station === "model" || route.done ? color : t.muted));
      if (packet) {
        const dot = div().id(`route-dot-${packet.id}`).absolute().left(dyn.at - 5).top(30).size(10)
          .opacity(packet.phase === "fade" ? 0 : 1)
          .when(this.motion, el => el.spring("left", { response: 210, damping: 1 }).transition("opacity", { duration: 170, easing: "ease-out" }));
        dot.child(div().absolute().inset_0().rounded(5).border_1().border_color(color).bg(t.background));
        let core = div().absolute().left(3).top(3).size(4).rounded(2).bg(color);
        if (this.motion && (packet.phase === "held" || packet.phase === "selecting")) core = core.loop("opacity", { from: 0.42, to: 1, period: 1200 });
        track.child(dot.child(core));
      }
      const statusDetail = dyn.stage || (route.done && Number.isFinite(route.durationMs) ? duration(route.durationMs) : "");
      track.child(h_flex().absolute().left(0).right(0).top(49).items_center().gap(6)
        .child(this.resultMark(result, ui))
        .when(Boolean(statusDetail), el => el.child(text(`· ${statusDetail}`, t.muted, 11).flex_none()))
        .child(text(model, t.foreground, 13).font_medium().flex_1().text_right().truncate()
          .tooltip(route.provider ? `${route.provider} · ${model}` : model)));
      root.child(lane.child(track));
    }
    return root;
  }
  resultMark(result, ui) {
    const { t, text } = ui;
    return h_flex().gap(6).items_center().flex_none().child(svg(`mods/${this.modName}/icons/${result.effect}.svg`).size(12).text_color(t[result.color]))
      .child(text(result.label, t[result.color], 12));
  }
  skeleton(ui, kind = this.section) {
    const { t, text } = ui;
    const root = v_flex().id(`skeleton-${kind}`).flex_1().min_h(0).overflow_hidden().p(14).gap(20).accessibility_label('Loading Magpie');
    root.child(text(kind === 'usage' ? 'Reading allowances…' : 'Connecting…', t.muted, 13));
    for (let i = 0; i < (kind === 'routes' ? 7 : 4); i++) root.child(v_flex().gap(12).py(8)
      .child(div().h(12).w(100 + i % 3 * 40).rounded(4).bg(t.raised))
      .child(div().h(kind === 'routes' ? 8 : 32).w_full().rounded(4).bg(t.raised)));
    return root;
  }
  openDetail(row, cx) {
    this.selected = row.id; this.details = true; this.live.stop(); this.focus.focus(); cx.notify();
  }
  requestRow(row, index, ui) {
    const { t, text } = ui, result = resultInfo(row), selected = row.id === this.selected;
    return v_flex().id(`request-${index}`).role('button').tab_index(0).min_w(0).flex_none().mx(8).my(2).px(10).py(10).gap(6)
      .rounded(7).bg(selected ? t.selected : t.background).border_1().border_color(selected ? t.accent : t.background).cursor_pointer()
      .hover(s => s.bg(t.hover)).focus(s => s.bg(t.selected).text_color(t.accent).border_color(t.accent))
      .track_focus(this.rowFocus[index])
      .accessibility_label(`${clientName(row.agent)}, ${row.model}, ${result.label}, cache hit ${percent(row.cacheHit)}`)
      .on_click((_event, cx) => this.openDetail(row, cx))
      .on_key_down((event, cx) => { if (event.key === 'enter' || event.key === 'space') { cx.stop_propagation(); this.openDetail(row, cx); } })
      .child(h_flex().gap(8).items_center().child(text(row.model || row.requestedModel, t.foreground, 14).font_semibold().flex_1().truncate())
        .child(text(duration(row.durationMs), t.foreground, 13).text_right().flex_none()))
      .child(h_flex().gap(8).items_center().child(text(`${clientName(row.agent)} · ${this.routeInfo(row).name}`, t.muted, 12).flex_1().truncate())
        .child(text(time(row.timestamp), t.muted, 12).flex_none()))
      .child(h_flex().gap(10).items_center().child(this.resultMark(result, ui)).child(div().flex_1())
        .child(text(`${compact(row.inputTokens)} in · ${compact(row.outputTokens)} out`, t.muted, 12))
        .child(text(`Cache ${percent(row.cacheHit)}`, t.muted, 12).flex_none()));
  }
  renderRoutes(ui) {
    const { t, text, button } = ui, allRows = this.requests(), rows = this.filteredRequests();
    if (this.details && allRows.some(row => row.id === this.selected)) return this.renderDetail(allRows.find(row => row.id === this.selected), ui);
    const root = v_flex().flex_1().min_h(0).min_w(0);
    if (!this.trace.loaded && !this.snapshot && this.loading) return this.skeleton(ui);
    root.child(this.renderSignal(ui));
    if (this.traceError && !this.traceBusy && !this.loading && !this.unconfigured) root.child(text(this.traceError, t.muted, 12).px(14).pb(8));
    const countLabel = this.requestFilter === 'attention' ? `${rows.length}/${allRows.length}` : String(allRows.length);
    root.child(h_flex().h(42).flex_none().px(8).gap(8).items_center()
      .child(h_flex().px(6).gap(6).items_center().flex_1().min_w(0)
        .child(text('Requests', t.foreground, 14).font_semibold()).child(text(countLabel, t.muted, 12)))
      .child(h_flex().p(2).gap(2).rounded(7).bg(t.raised)
        .child(button('filter-all', 'All', this.requestFilter === 'all', cx => this.setRequestFilter('all', cx)))
        .child(button('filter-attention', 'Attention', this.requestFilter === 'attention', cx => this.setRequestFilter('attention', cx)))));
    const list = v_flex().id('magpie-request-list').flex_1().min_h(0).min_w(0).overflow_y_scrollbar().py(4);
    if (!rows.length) {
      const filteredEmpty = this.requestFilter === 'attention' && allRows.length > 0;
      const empty = v_flex().id('requests-empty').mx(8).my(4).p(14).gap(8).rounded(8).bg(t.surface).border_1().border_color(t.border)
        .child(text(filteredEmpty ? 'No attention needed' : 'No requests yet', t.foreground, 14).font_semibold())
        .child(text(filteredEmpty ? 'No failed, recovered or canceled requests' : 'Requests will appear here as clients use Magpie', t.muted, 12));
      if (filteredEmpty) empty.child(h_flex().pt(4).child(button('filter-empty-all', 'Show all requests', false, cx => this.setRequestFilter('all', cx))));
      list.child(empty);
    }
    for (const [index, row] of rows.entries()) list.child(this.requestRow(row, index, ui));
    if (this.error && !this.loading && this.snapshot) list.child(text('Last update retained · refresh to retry', t.muted, 12).p(14));
    return root.child(list);
  }
  renderDetail(row, ui) {
    const { t, text, button, pair, line } = ui, result = resultInfo(row);
    const root = v_flex().id('request-detail').flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(14)
      .child(button('panel-back', 'Back', false, cx => { this.details = false; this.pollTrace(cx); cx.notify(); }));
    root.child(v_flex().id('request-summary').p(12).gap(8).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(text(row.model || row.requestedModel, t.foreground, 16).font_semibold())
      .child(this.resultMark(result, ui)));
    const fields = v_flex().id('request-fields').p(12).gap(10).rounded(8).bg(t.surface).border_1().border_color(t.border);
    for (const [name, value] of [['Client', clientName(row.agent)], ['Group', this.routeInfo(row).name], ['Strategy', this.routeInfo(row).strategy],
      ['Provider', row.provider], ['Requested', row.requestedModel], ['Started', time(row.timestamp)], ['Duration', duration(row.durationMs)],
      ['First token', duration(row.ttftMs)], ['Input / output', `${count(row.inputTokens)} / ${count(row.outputTokens)}`],
      ['Cache hit', percent(row.cacheHit)], ['Cache read / write', `${count(row.cacheReadTokens)} / ${count(row.cacheWriteTokens)}`]]) fields.child(pair(name, value));
    root.child(fields).child(line()).child(text('Attempts', t.foreground, 14).font_semibold());
    const attempts = row.attempts || [];
    if (!attempts.length) root.child(text('No attempt history reported', t.muted, 12));
    const timeline = v_flex().id('attempt-timeline').min_w(0);
    for (const [index, attempt] of attempts.entries()) {
      const model = plain(attempt.served || attempt.model);
      const rail = v_flex().w(24).flex_none().items_center()
        .child(div().size(22).rounded(11).bg(t.raised).border_1().border_color(t.border).flex().items_center().justify_center()
          .child(text(String(index + 1), t.muted, 12).font_semibold()));
      if (index < attempts.length - 1) rail.child(div().id(`attempt-connector-${index}`).w(1).h(44).bg(t.border));
      const step = h_flex().id(`attempt-${index}`).gap(10).items_start().min_w(0).child(rail)
        .child(v_flex().flex_1().min_w(0).gap(6).pb(14)
          .child(text(model, t.foreground, 14).font_semibold().truncate().tooltip(model))
          .child(h_flex().gap(8).flex_wrap().items_center().child(this.resultMark(resultInfo(attempt), ui))
            .child(text(`${plain(attempt.provider)} · ${duration(attempt.durationMs)}`, t.muted, 12))));
      timeline.child(step);
    }
    return root.child(timeline);
  }
  renderUsage(ui) {
    const { t, text, pair } = ui;
    if (!this.allowances && this.allowanceBusy) return this.skeleton(ui, 'usage');
    const root = v_flex().id('subscription-usage').flex_1().min_h(0).min_w(0).overflow_y_scrollbar().p(12).gap(12);
    if (this.allowanceError) root.child(v_flex().id('allowance-error').p(12).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(text(this.allowanceError, t.blocked, 12)));
    const cards = this.allowances?.cards || [];
    if (!cards.length && !this.allowanceError) root.child(v_flex().id('allowance-empty').p(14).gap(8).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(text('No subscription allowances', t.foreground, 14).font_semibold())
      .child(text('Signed-in services and coding plans in Magpie appear here', t.muted, 12)));
    cards.forEach((card, index) => {
      const cardView = v_flex().id(`allowance-card-${index}`).gap(12).p(12).rounded(8).bg(t.surface).border_1().border_color(t.border);
      const heading = v_flex().gap(5).min_w(0).child(h_flex().gap(8).items_center()
        .child(text(card.name, t.foreground, 16).font_semibold().flex_1().truncate())
        .when(Boolean(card.plan), el => el.child(div().px(6).py(2).rounded(4).bg(t.raised).child(text(card.plan, t.muted, 12).truncate()))));
      if (card.account) heading.child(text(card.account, t.muted, 12));
      cardView.child(heading);
      if (card.state !== 'ready') cardView.child(text(card.state === 'stale' ? 'Last reading · update unavailable' : card.state === 'deferred' ? 'Last reading · refresh to update' : 'Allowance unavailable', card.state === 'stale' || card.state === 'deferred' ? t.working : t.muted, 12));
      if (card.estimated) cardView.child(text('Vendor balance not reported', t.muted, 12));
      else if (card.balance) cardView.child(pair('Balance', card.balance));
      if (!card.windows.length && !card.balance && card.state === 'ready' && !card.estimated) cardView.child(text('No allowance reported', t.muted, 12));
      for (const [windowIndex, window] of card.windows.entries()) {
        const low = Number.isFinite(window.remaining) && window.remaining <= 10;
        const color = window.heldBy || card.held || low ? t.working : t.accent;
        const label = allowanceLabel(window), hasPercentage = Number.isFinite(window.remaining);
        const block = v_flex().id(`allowance-window-${index}-${windowIndex}`).gap(7).min_w(0).child(h_flex().gap(12).items_center()
          .child(text(window.name, t.foreground, 13).id(`allowance-window-name-${index}-${windowIndex}`).font_medium().flex_1().truncate().tooltip(window.name))
          .child(text(label, t.foreground, hasPercentage ? 16 : 13).font_semibold().max_w(170).truncate().tooltip(label)));
        if (hasPercentage) block.child(div().id(`quota-${index}-${windowIndex}`).relative().h(6).w_full().rounded(3).bg(t.raised)
          .accessibility_label(`${window.name}: ${label}`)
          .child(div().absolute().left(0).top(0).bottom(0).w(`${window.remaining}%`).rounded(3).bg(color)));
        const labels = [];
        if (window.amountLeft !== null && window.limit) labels.push(`${compact(window.amountLeft)} / ${compact(window.limit)} ${window.unit || ''}`.trim());
        if (window.heldBy) labels.push(`Held by ${window.heldBy}`);
        else if (card.held) labels.push('Account on hold');
        const reset = resetLabel(window.resetsAt); if (reset) labels.push(reset);
        if (labels.length) block.child(text(labels.join(' · '), t.muted, 12));
        cardView.child(block);
      }
      if (card.readAt) cardView.child(text(`Read ${time(card.readAt)}`, t.muted, 12));
      root.child(cardView);
    });
    return root;
  }
  renderCost(ui) {
    const { t, text, button, line, pair } = ui;
    if (!this.snapshot && this.loading) return this.skeleton(ui, 'cost');
    const root = v_flex().id('magpie-cost').flex_1().min_h(0).min_w(0).overflow_y_scrollbar().p(14).gap(16);
    root.child(h_flex().id('cost-periods').gap(2).p(2).rounded(8).bg(t.raised).children(PERIODS.map(([id, title]) =>
      button(`period-${id}`, title, this.period === id, cx => this.change('period', id, cx)).flex_1().justify_center())));
    const usage = this.snapshot?.period === this.period ? this.snapshot.usage : null;
    if (!usage) return root.child(this.loading ? this.skeleton(ui, 'cost-period') : v_flex().p(14).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(text('Cost is unavailable · refresh to retry', t.muted, 13)));
    root.child(h_flex().id('cost-summary').gap(16).items_end()
      .child(v_flex().gap(4).flex_1().child(text('Reported cost', t.muted, 12)).child(text(money(usage.cost), t.foreground, 28).font_semibold()))
      .child(v_flex().gap(4).child(text('Requests', t.muted, 12)).child(text(compact(usage.calls), t.foreground, 16).font_semibold()))
      .child(v_flex().gap(4).child(text('Cache hit', t.muted, 12)).child(text(percent(cacheHit(usage)), t.foreground, 16).font_semibold())));
    const chartCard = v_flex().id('cost-visual').gap(12).p(12).rounded(8).bg(t.surface).border_1().border_color(t.border);
    chartCard.child(h_flex().gap(8).items_center().child(text(`${compact(tokenTotal(usage, this.withCache))} tokens`, t.foreground, 14).font_semibold().flex_1())
      .child(button('usage-cache', this.withCache ? 'Cache included' : 'Cache excluded', this.withCache, cx => { this.withCache = !this.withCache; cx.notify(); })));
    const bars = usageBars(usage.series, this.withCache);
    if (bars.length) {
      const peak = Math.max(1, ...bars.map(bar => bar.total || 0));
      chartCard.child(h_flex().id('cost-chart').h(132).items_end().gap(4)
        .children(bars.map((bar, index) => v_flex().id(`usage-bar-${index}`).flex_1().min_w(0).h(132).justify_end().rounded(3).bg(t.raised).overflow_hidden()
          .accessibility_label(`${bar.label}: ${count(bar.total)} tokens`).tooltip(`${bar.label} · ${count(bar.input)} input · ${count(bar.output)} output`)
          .child(div().h(120 * (bar.output || 0) / peak).bg(t.accent))
          .child(div().h(120 * (bar.input || 0) / peak).bg(t.muted)))));
      chartCard.child(h_flex().id('cost-axis').justify_between().child(text(bars[0].label, t.muted, 12)).child(text(bars.at(-1).label, t.muted, 12)));
    }
    chartCard.child(h_flex().id('cost-legend').gap(16).items_center()
      .child(h_flex().gap(6).items_center().child(div().size(8).rounded(2).bg(t.muted)).child(text(this.withCache ? 'Input + cache' : 'Input', t.muted, 12)))
      .child(h_flex().gap(6).items_center().child(div().size(8).rounded(2).bg(t.accent)).child(text('Output', t.muted, 12))));
    root.child(chartCard);
    const details = v_flex().id('cost-details').gap(10)
      .child(pair('Input / output', `${compact(usage.input)} / ${compact(usage.output)}`))
      .child(pair('Cache read / write', `${compact(usage.cache_read)} / ${compact(usage.cache_write)}`))
      .child(pair('Errors', count(usage.errors)));
    root.child(line()).child(details);
    if (usage.unpriced) root.child(text(`${count(usage.unpriced)} unpriced calls excluded`, t.muted, 12));
    if (usage.cache_unknown_calls) root.child(text(`${count(usage.cache_unknown_calls)} calls with unknown cache excluded from hit rate`, t.muted, 12));
    root.child(line()).child(h_flex().id('usage-breakdown').gap(2).p(2).rounded(8).bg(t.raised)
      .child(button('usage-models', 'Models', this.usageBreakdown === 'models', cx => { this.usageBreakdown = 'models'; cx.notify(); }).flex_1().justify_center())
      .child(button('usage-agents', 'Clients', this.usageBreakdown === 'agents', cx => { this.usageBreakdown = 'agents'; cx.notify(); }).flex_1().justify_center()));
    const breakdown = v_flex().id('cost-breakdown').gap(12).min_w(0);
    for (const [index, item] of (usage[this.usageBreakdown] || []).entries()) breakdown.child(v_flex().id(`breakdown-${index}`).gap(6).min_w(0)
      .child(h_flex().gap(8).items_center().child(text(item.model || clientName(item.name), t.foreground, 14).font_medium().flex_1().truncate()).child(text(money(item.cost), t.foreground, 14).font_semibold()))
      .child(h_flex().gap(8).justify_between().child(text(`${compact(item.calls)} requests`, t.muted, 12)).child(text(`${compact(item.input)} in · ${compact(item.output)} out`, t.muted, 12))));
    return root.child(breakdown);
  }
  render() {
    const t = theme();
    if (this.connectionOpen) return this.connection.render(t);
    const text = (value, color = t.muted, size = 13) => div().min_w(0).text_size(size).text_color(color).child(plain(value, 240));
    const line = () => div().h(1).flex_none().bg(t.border);
    const button = (id, title, active, action) => div().id(id).role('button').tab_index(0).h(30).px(9).rounded(6).flex().items_center()
      .text_size(13).font_medium().text_color(active ? t.foreground : t.muted).bg(active ? t.selected : t.background)
      .border_1().border_color(active ? t.border : t.background).cursor_pointer()
      .hover(s => s.bg(t.hover)).focus(s => s.bg(t.selected).text_color(t.accent).border_color(t.accent))
      .on_click((_event, cx) => { this.focus.focus(); action(cx); })
      .on_key_down((event, cx) => { if (event.key === 'enter' || event.key === 'space') { cx.stop_propagation(); action(cx); } }).child(title);
    const pair = (name, value) => h_flex().min_w(0).gap(12).justify_between().items_start()
      .child(text(name, t.muted, 13).flex_none()).child(text(value, t.foreground, 13).text_right().flex_1());
    const ui = { t, text, line, button, pair };
    const root = v_flex().id('magpie-panel').size_full().min_w(0).min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.focus).on_key_down((e, cx) => this.key(e, cx)).on_mouse_down('left', () => this.focus.focus())
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } });
    root.child(h_flex().h(42).flex_none().px(14).gap(4).items_center().border_b(1).border_color(t.border)
      .child(text('Routing', t.foreground, 13).font_semibold()).child(div().flex_1())
      .child(button('page-refresh', 'Refresh', false, cx => this.refreshAll(cx)))
      .child(button('page-connection', 'Settings', false, cx => this.openConnection(cx))));
    root.child(h_flex().h(42).px(8).flex_none().items_center().border_b(1).border_color(t.border)
      .child(h_flex().flex_1().p(2).gap(2).rounded(8).bg(t.raised)
        .children([['routes', 'Routes'], ['usage', 'Usage'], ['cost', 'Cost']].map(([id, title]) =>
          button(`page-${id}`, title, this.section === id, cx => this.activate(id, cx)).flex_1().justify_center()))));
    if (this.unconfigured && !this.loading) return root.child(v_flex().p(14).gap(16)
      .child(text('Connect Magpie', t.foreground, 16)).child(text('Add your service address and Web key in Settings'))
      .child(button('connection-setup', 'Open settings', false, cx => this.openConnection(cx))));
    if (!this.snapshot && !this.trace.loaded && this.error && !this.loading && this.section !== 'usage') return root.child(v_flex().p(14).gap(16)
      .child(text('Connection unavailable', t.foreground, 16)).child(text(this.error))
      .child(button('connection-setup', 'Open settings', false, cx => this.openConnection(cx))));
    return root.child(this.section === 'routes' ? this.renderRoutes(ui) : this.section === 'usage' ? this.renderUsage(ui) : this.renderCost(ui));
  }
}
