import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";

const LIMIT = 16;
const DEADLINE_MS = 15000;
const text = (value, max = 64) => {
  const s = value == null || value === "" ? "—" : String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const count = (value) => Number.isFinite(value) && value >= 0 ? String(value) : "—";
const duration = (value) => Number.isFinite(value) && value >= 0
  ? (value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`) : "—";
const clock = (value) => {
  if (value == null || value === "") return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("zh-CN", { hour12: false });
};
const stateLabel = (s) => ({ success: "成功", error: "失败", pending: "进行中" })[s] || "未知";
const stateColor = (s, t) => s === "success" ? t.done : s === "error" ? t.blocked : s === "pending" ? t.working : t.muted;

export default class MagpieRouter extends View {
  init(props, cx) {
    this.endpoint = typeof props?.endpoint === "string" && props.endpoint.trim()
      ? props.endpoint.trim() : "http://127.0.0.1:4317/api/snapshot";
    this.mode = "live";
    this.paused = false;
    this.loading = false;
    this.queued = false;
    this.closed = false;
    this.snapshot = null;
    this.error = "";
    this.selected = null;
    this.generation = 0;
    this.startedAt = 0;
    cx.timer.every(5000, (cx) => {
      if (this.loading && Date.now() - this.startedAt >= DEADLINE_MS) {
        // GPUI fetch has no signal/timeout option. Expire UI ownership, not the network call.
        this.generation++;
        this.loading = false;
        this.queued = false;
        this.paused = true;
        this.error = "读取超过 15 秒，自动更新已暂停；旧数据可能过期。请刷新或切换模式重试。";
        cx.notify();
        return;
      }
      if (!this.paused && !this.loading) this.refresh(cx);
    });
    this.refresh(cx);
  }

  close() { this.closed = true; this.generation++; }

  refresh(cx) {
    if (this.closed) return;
    if (this.loading) { this.queued = true; return; }
    const mode = this.mode;
    const generation = ++this.generation;
    this.startedAt = Date.now();
    this.loading = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // Preserve optional endpoint query parameters; replace only mode.
        const hashless = this.endpoint.split("#")[0];
        const [base, query = ""] = hashless.split("?");
        const params = query.split("&").filter((p) => p && p.split("=")[0] !== "mode");
        params.push(`mode=${mode}`);
        const response = await fetch(`${base}?${params.join("&")}`);
        const data = await response.json();
        if (!data || typeof data !== "object" || Array.isArray(data)
          || !Array.isArray(data.requests) || !Array.isArray(data.providers)
          || !Array.isArray(data.groups) || data.mode !== mode) {
          throw new Error("桥接响应格式无效，或模式不匹配");
        }
        // An unconfigured bridge intentionally returns a useful snapshot with HTTP 503.
        if (!response.ok && response.status !== 503) throw new Error(`桥接服务 HTTP ${response.status}`);
        if (this.closed || this.mode !== mode || this.generation !== generation) return;
        this.snapshot = data;
        this.error = response.ok ? "" : text(data.error || "桥接尚未配置（HTTP 503）", 180);
        const rows = this.requests();
        if (!rows.some((r) => r.id === this.selected)) this.selected = rows[0]?.id ?? null;
      } catch (error) {
        if (!this.closed && this.mode === mode && this.generation === generation) this.error = text(error?.message || "无法读取桥接服务", 180);
      } finally {
        if (!this.closed && this.generation === generation) {
          this.loading = false;
          cx.notify();
          if (this.queued) { this.queued = false; this.refresh(cx); }
        }
      }
    });
  }

  requests() {
    return (this.snapshot?.requests || []).filter((r) => r && typeof r === "object")
      .slice().sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)).slice(0, LIMIT);
  }

  switchMode(mode, cx) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.snapshot = null;
    this.selected = null;
    this.error = "";
    this.refresh(cx);
    cx.notify();
  }

  render(cx) {
    const t = theme();
    const rows = this.requests();
    const selected = rows.find((r) => r.id === this.selected);
    const label = (s, color = t.muted, size = 11) => div().text_size(size).text_color(color).child(s);
    const button = (id, title, active, action) => div().id(id).px(9).py(5).rounded(5)
      .bg(active ? t.selected : t.raised).text_color(active ? t.accent : t.muted)
      .text_size(11).hover((s) => s.bg(t.hover)).on_click((_event, cx) => action(cx)).child(title);
    const card = () => v_flex().gap(7).p(11).rounded(8).bg(t.raised).border(1).border_color(t.border);
    const pair = (name, value) => h_flex().gap(8).justify_between()
      .child(label(name)).child(label(text(value, 40), t.foreground));
    const connection = this.snapshot?.connection;
    const connectionText = ({ connected: "已连接", disconnected: "连接已断开", unconfigured: "尚未配置" })[connection] || "等待连接";
    const body = v_flex().id("magpie-body").flex_1().overflow_y_scrollbar().gap(12).p(14);

    if (this.error || this.snapshot?.error) {
      body.child(card().child(label(this.snapshot ? "数据状态 · 请留意更新时间" : "暂时无法读取", t.blocked, 12))
        .child(label(text(this.error || this.snapshot.error, 180), t.foreground))
        .child(label("确认本机桥接服务与数据源配置后，点击刷新。")));
    }
    if (!this.snapshot) {
      body.child(card().child(label(this.loading ? "正在读取路由快照…" : "尚无可用快照", t.foreground, 13))
        .child(label(this.mode === "live" ? "实时模式只显示桥接服务返回的数据。" : "演示模式由桥接服务明确提供示例数据。")));
    } else {
      body.child(v_flex().gap(4)
        .child(h_flex().justify_between().child(label("数据源", t.dim)).child(label(text(connectionText, 26), t.accent)))
        .child(label(text(this.snapshot.source?.label, 48), t.foreground, 12))
        .child(label(text(this.snapshot.source?.detail, 90)))
        .child(label(`更新 ${clock(this.snapshot.updatedAt)}${this.paused ? " · 自动更新已暂停" : " · 每 5 秒更新"}`, t.dim)));

      if (selected) {
        const detail = card().child(h_flex().justify_between()
          .child(label("路由详情", t.foreground, 12))
          .child(label(selected.fallback === null ? "回退情况未知" : selected.fallback ? "已触发回退" : "未触发回退", selected.fallback ? t.working : t.dim)))
          .child(pair("请求分组", selected.group || "未分组"))
          .child(pair("实际模型", selected.model))
          .child(pair("提供商", selected.provider))
          .child(pair("请求模型", selected.requestedModel))
          .child(pair("耗时 / 首字", `${duration(selected.durationMs)} / ${duration(selected.ttftMs)}`))
          .child(pair("输入 / 输出 token", `${count(selected.inputTokens)} / ${count(selected.outputTokens)}`));
        const attempts = Array.isArray(selected.attempts) ? selected.attempts.filter((a) => a && typeof a === "object") : [];
        detail.child(label(`实际尝试 · ${attempts.length}`, t.dim));
        if (!attempts.length) detail.child(label("数据源未提供尝试记录"));
        attempts.forEach((a, i) => detail.child(v_flex().gap(3)
          .child(label(`${i + 1}. ${text(a.provider, 22)} / ${text(a.model, 30)}`, t.foreground))
          .child(label(`${stateLabel(a.status)} · ${duration(a.durationMs)}`, stateColor(a.status, t)))
          .children(a.status === "error" ? [label("此尝试失败 · 错误详情请查本机日志", t.blocked)] : [])));
        body.child(detail);
      }

      body.child(h_flex().justify_between().child(label("最近请求", t.foreground, 12))
        .child(label(`最新 ${rows.length} 条 · 最多 ${LIMIT} 条`, t.dim)));
      if (!rows.length) body.child(card().child(label("暂无请求", t.foreground, 13))
        .child(label(this.mode === "live" ? "数据源尚未返回路由记录。" : "演示源未返回记录。")));
      rows.forEach((r, i) => body.child(v_flex().id(`magpie-request-${i}`).p(10).gap(5).rounded(7)
        .bg(r.id === this.selected ? t.selected : t.raised).border(1)
        .border_color(r.id === this.selected ? t.accent : t.border).hover((s) => s.bg(t.hover))
        .on_click((_event, cx) => { this.selected = r.id; cx.notify(); })
        .child(h_flex().justify_between().gap(6).child(label(text(r.model, 36), t.foreground, 12))
          .child(label(stateLabel(r.status), stateColor(r.status, t))))
        .child(label(`${text(r.group, 21)} → ${text(r.provider, 24)}${r.fallback ? " · 回退" : ""}`))
        .child(h_flex().justify_between().child(label(clock(r.timestamp), t.dim))
          .child(label(`${duration(r.durationMs)} · 输出 ${count(r.outputTokens)}`, t.dim)))));

      body.child(label("提供商 · 数据源统计", t.foreground, 12));
      const providers = this.snapshot.providers.filter((p) => p && typeof p === "object");
      if (!providers.length) body.child(label("暂无提供商统计"));
      providers.forEach((p) => body.child(v_flex().gap(3)
        .child(h_flex().justify_between().child(label(text(p.name || p.id, 30), t.foreground))
          .child(label(text(p.status, 22))))
        .child(label(`请求 ${count(p.requests)} · 错误 ${count(p.errors)}`, t.dim))));
    }

    return v_flex().id("magpie-router-root").size_full().bg(t.surface).text_color(t.foreground).text_size(12)
      .child(v_flex().p(14).gap(10)
        .child(h_flex().items_center().justify_between()
          .child(v_flex().gap(3).child(div().text_size(17).font_semibold().child("Magpie"))
            .child(label("路由观察台", t.dim)))
          .child(label(this.mode === "demo" ? "演示数据" : "实时 · 只读", this.mode === "demo" ? t.working : t.accent)))
        .child(h_flex().gap(5).items_center()
          .child(button("magpie-live", "实时", this.mode === "live", (cx) => this.switchMode("live", cx)))
          .child(button("magpie-demo", "演示", this.mode === "demo", (cx) => this.switchMode("demo", cx)))
          .child(div().flex_1())
          .child(button("magpie-pause", this.paused ? "继续" : "暂停", this.paused, (cx) => {
            this.paused = !this.paused;
            if (!this.paused) this.refresh(cx);
            cx.notify();
          }))
          .child(button("magpie-refresh", this.loading ? "读取中" : "刷新", false, (cx) => this.refresh(cx)))))
      .child(div().h(1).bg(t.border))
      .child(body)
      .child(div().px(14).py(9).text_size(11).text_color(t.dim).child("MAGPIE / 仅观察路由 · 不修改配置"));
  }
}
