import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, layout, nextCommand, props as hostProps } from "herdr";
import config from "./config.js";
import { strategyInfo } from "./routing.js";
import { TraceStore, LiveRouting } from "./live-routing.js";
import { tokenTotal, cacheHit, usageBars } from "./usage.js";
import { ConnectionForm } from "./connection.js";
import { PERIODS, plain, count, compact, money, percent, duration, time, clientName, resultInfo, resetLabel, allowanceLabel } from "./presentation.js";

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
    else if (key === "enter" && this.selected) this.details = !this.details;
    else if (["1", "2", "3", "4"].includes(key) && this.section === "cost") this.change("period", PERIODS[Number(key) - 1][0], cx);
    else if (key === "up" || key === "down") {
      const rows = this.requests(), index = rows.findIndex(row => row.id === this.selected);
      this.selected = rows[Math.max(0, Math.min(rows.length - 1, index + (key === "up" ? -1 : 1)))]?.id || null;
    } else return;
    cx.stop_propagation(); cx.notify();
  }

  renderSignal(ui) {
    const { t, text, line } = ui, signal = this.live;
    const root = v_flex().id("routing-paths").flex_none().px(14).pt(12).pb(8).gap(4);
    const pending = [...signal.routes.values()].filter(row => !row.done).length;
    root.child(h_flex().h(24).items_center().justify_between()
      .child(text("Live routing", t.foreground, 14).font_semibold())
      .when(pending > 0, el => el.child(text(`${pending} active`, t.muted, 12))));
    if (!signal.lanes.length) return root.child(text("Waiting for requests", t.muted, 13).py(24));
    const width = Math.max(220, this.width - 30), start = 6, middle = width * 0.43, end = width - 6;
    for (const route of signal.lanes) {
      const packet = signal.dots.get(route.id), attempt = packet ? route.attempts[packet.attempt] : route.attempts.at(-1);
      const result = resultInfo(route), group = this.routeInfo(route).name;
      const model = attempt?.served || attempt?.model || route.model || "Selecting model";
      const lane = div().id(`lane-${route.id}`).relative().h(76).flex_none().min_w(0)
        .accessibility_label(`${clientName(route.agent)} through ${group} to ${model}, ${result.label}`);
      lane.child(h_flex().absolute().left(0).right(0).top(2).items_center().gap(8)
        .child(text(clientName(route.agent), t.foreground, 13).w(middle - 12).flex_none().truncate())
        .child(text(group, t.muted, 12).flex_1().truncate()));
      lane.child(line().absolute().left(start).right(6).top(32));
      for (const x of [start, middle, end]) lane.child(div().absolute().left(x - 3).top(29).size(6).rounded(3).bg(t.background).border_1().border_color(t.muted));
      lane.child(h_flex().absolute().left(0).right(0).top(46).items_center().gap(8)
        .child(this.resultMark(result, ui)).child(text(model, t.foreground, 14).flex_1().text_right().truncate().tooltip(model)));
      if (packet) {
        const at = ['enter', 'selecting', 'home'].includes(packet.phase) ? start
          : ['to-rail', 'return-rail'].includes(packet.phase) ? middle : packet.phase === 'fade' && packet.outcome !== 'canceled' ? start : end;
        const recovered = route.attempts.slice(0, packet.attempt).some(attempt => attempt.status === 'error');
        const color = packet.outcome === 'error' ? t.blocked : packet.outcome === 'canceled' ? t.muted
          : recovered ? t.working : packet.outcome === 'success' ? t.done : t.accent;
        const dot = div().id(`route-dot-${packet.id}`).absolute().left(at - 5).top(27).size(10)
          .opacity(packet.phase === 'fade' ? 0 : 1)
          .transition('left', { duration: 220, easing: 'ease-in-out' }).transition('opacity', { duration: 180, easing: 'linear' });
        dot.child(div().absolute().inset_0().rounded(5).border_1().border_color(color).bg(t.background));
        let core = div().absolute().left(3).top(3).size(4).rounded(2).bg(color);
        if (packet.phase === 'held' || packet.phase === 'selecting') core = core.loop('opacity', { from: 0.45, to: 1, period: 1200 });
        lane.child(dot.child(core));
      }
      root.child(lane);
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
  requestRow(row, index, ui) {
    const { t, text } = ui, result = resultInfo(row);
    return v_flex().id(`request-${index}`).role('button').tab_index(0).min_w(0).flex_none().px(14).py(12).gap(6)
      .bg(row.id === this.selected ? t.selected : t.background).border_b(1).border_color(t.border).cursor_pointer()
      .hover(s => s.bg(t.hover)).focus(s => s.bg(t.selected).text_color(t.accent))
      .accessibility_label(`${clientName(row.agent)}, ${row.model}, ${result.label}, cache hit ${percent(row.cacheHit)}`)
      .on_click((_event, cx) => { this.selected = row.id; this.details = true; this.live.stop(); cx.notify(); })
      .on_key_down((event, cx) => { if (event.key === 'enter' || event.key === 'space') { cx.stop_propagation(); this.selected = row.id; this.details = true; this.live.stop(); cx.notify(); } })
      .child(h_flex().gap(8).items_center().child(text(row.model || row.requestedModel, t.foreground, 14).flex_1().truncate())
        .child(text(duration(row.durationMs), t.muted, 12).flex_none()))
      .child(h_flex().gap(8).items_center().child(text(`${clientName(row.agent)} · ${this.routeInfo(row).name}`, t.muted, 12).flex_1().truncate())
        .child(text(time(row.timestamp), t.muted, 12).flex_none()))
      .child(h_flex().gap(10).items_center().child(this.resultMark(result, ui)).child(div().flex_1())
        .child(text(`${compact(row.inputTokens)} in · ${compact(row.outputTokens)} out`, t.muted, 12))
        .child(text(`Cache ${percent(row.cacheHit)}`, t.foreground, 12).flex_none()));
  }
  renderRoutes(ui) {
    const { t, text, button, line } = ui, rows = this.requests();
    if (this.details && rows.some(row => row.id === this.selected)) return this.renderDetail(rows.find(row => row.id === this.selected), ui);
    const root = v_flex().flex_1().min_h(0).min_w(0);
    if (!this.trace.loaded && !this.snapshot && this.loading) return this.skeleton(ui);
    root.child(this.renderSignal(ui));
    if (this.traceError && !this.traceBusy && !this.loading && !this.unconfigured) root.child(text(this.traceError, t.muted, 12).px(14).pb(8));
    root.child(line()).child(h_flex().h(40).flex_none().px(14).items_center().justify_between()
      .child(text('Recent requests', t.foreground, 14).font_semibold()).child(text(String(rows.length), t.muted, 12)));
    const list = v_flex().id('magpie-request-list').flex_1().min_h(0).min_w(0).overflow_y_scrollbar();
    if (!rows.length) list.child(text('Requests will appear here as clients use Magpie', t.muted, 13).p(14));
    for (const [index, row] of rows.entries()) list.child(this.requestRow(row, index, ui));
    if (this.error && !this.loading && this.snapshot) list.child(text('Last update retained · refresh to retry', t.muted, 12).p(14));
    return root.child(list);
  }
  renderDetail(row, ui) {
    const { t, text, button, pair, line } = ui, result = resultInfo(row);
    const root = v_flex().id('request-detail').flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(16)
      .child(button('panel-back', 'Back', false, cx => { this.details = false; this.pollTrace(cx); cx.notify(); }))
      .child(text(row.model, t.foreground, 16).font_semibold()).child(this.resultMark(result, ui));
    for (const [name, value] of [['Client', clientName(row.agent)], ['Group', this.routeInfo(row).name], ['Strategy', this.routeInfo(row).strategy],
      ['Provider', row.provider], ['Requested', row.requestedModel], ['Started', time(row.timestamp)], ['Duration', duration(row.durationMs)],
      ['First token', duration(row.ttftMs)], ['Input / output', `${count(row.inputTokens)} / ${count(row.outputTokens)}`],
      ['Cache hit', percent(row.cacheHit)], ['Cache read / write', `${count(row.cacheReadTokens)} / ${count(row.cacheWriteTokens)}`]]) root.child(pair(name, value));
    root.child(line()).child(text('Attempts', t.foreground, 14).font_semibold());
    if (!row.attempts?.length) root.child(text('No attempt history reported'));
    for (const [index, attempt] of (row.attempts || []).entries()) root.child(v_flex().gap(6)
      .child(text(`${index + 1} · ${plain(attempt.served || attempt.model)}`, t.foreground, 14))
      .child(h_flex().gap(8).child(this.resultMark(resultInfo(attempt), ui)).child(text(`${plain(attempt.provider)} · ${duration(attempt.durationMs)}`, t.muted, 12))));
    return root;
  }
  renderUsage(ui) {
    const { t, text, line, pair } = ui;
    if (!this.allowances && this.allowanceBusy) return this.skeleton(ui, 'usage');
    const root = v_flex().id('subscription-usage').flex_1().min_h(0).min_w(0).overflow_y_scrollbar().p(14).gap(20);
    if (this.allowanceError) root.child(text(this.allowanceError, t.muted, 13));
    const cards = this.allowances?.cards || [];
    if (!cards.length && !this.allowanceError) root.child(text('No subscription allowances reported', t.foreground, 14))
      .child(text('Signed-in services and coding plans in Magpie appear here', t.muted, 13));
    cards.forEach((card, index) => {
      if (index) root.child(line());
      root.child(v_flex().gap(4).child(h_flex().gap(8).items_center()
        .child(text(card.name, t.foreground, 16).font_semibold().flex_1().truncate()).when(Boolean(card.plan), el => el.child(text(card.plan, t.muted, 12).truncate())))
        .when(Boolean(card.account), el => el.child(text(card.account, t.muted, 12))));
      if (card.state !== 'ready') root.child(text(card.state === 'stale' ? 'Last reading · update unavailable' : card.state === 'deferred' ? 'Last reading · refresh to update' : 'Allowance unavailable', t.muted, 12));
      if (card.estimated) root.child(text('Vendor balance not reported', t.muted, 13));
      else if (card.balance) root.child(pair('Balance', card.balance));
      if (!card.windows.length && !card.balance && card.state === 'ready' && !card.estimated) root.child(text('No allowance reported', t.muted, 13));
      for (const [windowIndex, window] of card.windows.entries()) {
        const low = Number.isFinite(window.remaining) && window.remaining <= 10;
        const color = window.heldBy || card.held || low ? t.working : t.accent;
        const block = v_flex().gap(8).min_w(0).child(h_flex().gap(8).items_center()
          .child(text(window.name, t.foreground, 13).flex_1().truncate())
          .child(text(allowanceLabel(window), t.foreground, 14).flex_none()));
        if (Number.isFinite(window.remaining)) block.child(div().id(`quota-${index}-${windowIndex}`).relative().h(5).w_full().rounded(3).bg(t.raised)
          .accessibility_label(`${window.name}: ${allowanceLabel(window)}`)
          .child(div().absolute().left(0).top(0).bottom(0).w(`${window.remaining}%`).rounded(3).bg(color)));
        const labels = [];
        if (window.amountLeft !== null && window.limit) labels.push(`${compact(window.amountLeft)} / ${compact(window.limit)} ${window.unit || ''}`.trim());
        if (window.heldBy) labels.push(`Held by ${window.heldBy}`);
        else if (card.held) labels.push('Account on hold');
        const reset = resetLabel(window.resetsAt); if (reset) labels.push(reset);
        if (labels.length) block.child(text(labels.join(' · '), t.muted, 12));
        root.child(block);
      }
      if (card.readAt) root.child(text(`Read ${time(card.readAt)}`, t.muted, 12));
    });
    return root;
  }
  renderCost(ui) {
    const { t, text, button, line, pair } = ui;
    if (!this.snapshot && this.loading) return this.skeleton(ui, 'cost');
    const root = v_flex().id('magpie-cost').flex_1().min_h(0).min_w(0).overflow_y_scrollbar().p(14).gap(20);
    root.child(h_flex().gap(2).flex_wrap().children(PERIODS.map(([id, title]) => button(`period-${id}`, title, this.period === id, cx => this.change('period', id, cx)))));
    const usage = this.snapshot?.period === this.period ? this.snapshot.usage : null;
    if (!usage) return root.child(this.loading ? this.skeleton(ui, 'cost-period') : text('Cost is unavailable · refresh to retry', t.muted, 13));
    root.child(h_flex().gap(20).items_end()
      .child(v_flex().gap(4).flex_1().child(text('Reported cost', t.muted, 13)).child(text(money(usage.cost), t.foreground, 28)))
      .child(v_flex().gap(4).child(text('Requests', t.muted, 13)).child(text(compact(usage.calls), t.foreground, 20)))
      .child(v_flex().gap(4).child(text('Cache hit', t.muted, 13)).child(text(percent(cacheHit(usage)), t.foreground, 20))));
    root.child(h_flex().gap(8).items_center().child(text(`${compact(tokenTotal(usage, this.withCache))} tokens`, t.foreground, 14).flex_1())
      .child(button('usage-cache', this.withCache ? 'Cache included' : 'Cache excluded', false, cx => { this.withCache = !this.withCache; cx.notify(); })));
    const bars = usageBars(usage.series, this.withCache);
    if (bars.length) {
      const peak = Math.max(1, ...bars.map(bar => bar.total || 0));
      root.child(h_flex().id('cost-chart').h(132).items_end().gap(3).border_b(1).border_color(t.border)
        .children(bars.map((bar, index) => v_flex().id(`usage-bar-${index}`).flex_1().min_w(0).h(132).justify_end()
          .accessibility_label(`${bar.label}: ${count(bar.total)} tokens`).tooltip(`${bar.label} · ${count(bar.input)} input · ${count(bar.output)} output`)
          .child(div().h(120 * (bar.output || 0) / peak).bg(t.accent))
          .child(div().h(120 * (bar.input || 0) / peak).bg(t.muted)))));
      root.child(h_flex().justify_between().child(text(bars[0].label, t.muted, 12)).child(text(bars.at(-1).label, t.muted, 12)));
    }
    root.child(h_flex().id('cost-legend').gap(16).items_center()
      .child(h_flex().gap(6).items_center().child(div().size(8).rounded(2).bg(t.muted)).child(text(this.withCache ? 'Input + cache' : 'Input', t.muted, 12)))
      .child(h_flex().gap(6).items_center().child(div().size(8).rounded(2).bg(t.accent)).child(text('Output', t.muted, 12))));
    root.child(line()).child(pair('Input / output', `${compact(usage.input)} / ${compact(usage.output)}`))
      .child(pair('Cache read / write', `${compact(usage.cache_read)} / ${compact(usage.cache_write)}`)).child(pair('Errors', count(usage.errors)));
    if (usage.unpriced) root.child(text(`${count(usage.unpriced)} unpriced calls excluded`, t.muted, 12));
    if (usage.cache_unknown_calls) root.child(text(`${count(usage.cache_unknown_calls)} calls with unknown cache excluded from hit rate`, t.muted, 12));
    root.child(line()).child(h_flex().gap(4)
      .child(button('usage-models', 'Models', this.usageBreakdown === 'models', cx => { this.usageBreakdown = 'models'; cx.notify(); }))
      .child(button('usage-agents', 'Clients', this.usageBreakdown === 'agents', cx => { this.usageBreakdown = 'agents'; cx.notify(); })));
    for (const item of usage[this.usageBreakdown] || []) root.child(v_flex().gap(6).min_w(0)
      .child(h_flex().gap(8).child(text(item.model || clientName(item.name), t.foreground, 14).flex_1().truncate()).child(text(money(item.cost), t.foreground, 14)))
      .child(h_flex().gap(8).justify_between().child(text(`${compact(item.calls)} requests`, t.muted, 12)).child(text(`${compact(item.input)} in · ${compact(item.output)} out`, t.muted, 12))));
    return root;
  }
  render() {
    const t = theme();
    if (this.connectionOpen) return this.connection.render(t);
    const text = (value, color = t.muted, size = 13) => div().min_w(0).text_size(size).text_color(color).child(plain(value, 240));
    const line = () => div().h(1).flex_none().bg(t.border);
    const button = (id, title, active, action) => div().id(id).role('button').tab_index(0).h(30).px(8).rounded(7).flex().items_center()
      .text_size(13).text_color(active ? t.foreground : t.muted).bg(active ? t.selected : t.background).cursor_pointer()
      .hover(s => s.bg(t.hover)).focus(s => s.bg(t.selected).text_color(t.accent))
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
    root.child(h_flex().h(42).px(6).gap(4).flex_none().items_center().border_b(1).border_color(t.border)
      .children([['routes', 'Routes'], ['usage', 'Usage'], ['cost', 'Cost']].map(([id, title]) => button(`page-${id}`, title, this.section === id, cx => this.activate(id, cx)))));
    if (this.unconfigured && !this.loading) return root.child(v_flex().p(14).gap(16)
      .child(text('Connect Magpie', t.foreground, 16)).child(text('Add your service address and Web key in Settings'))
      .child(button('connection-setup', 'Open settings', false, cx => this.openConnection(cx))));
    if (!this.snapshot && !this.trace.loaded && this.error && !this.loading && this.section !== 'usage') return root.child(v_flex().p(14).gap(16)
      .child(text('Connection unavailable', t.foreground, 16)).child(text(this.error))
      .child(button('connection-setup', 'Open settings', false, cx => this.openConnection(cx))));
    return root.child(this.section === 'routes' ? this.renderRoutes(ui) : this.section === 'usage' ? this.renderUsage(ui) : this.renderCost(ui));
  }
}
