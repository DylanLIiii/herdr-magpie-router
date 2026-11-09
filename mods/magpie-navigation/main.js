import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, theme, nextCommand, props as hostProps } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children || []) { const match = find(child, id); if (match) return match; }
  return null;
}

export default class MagpieNavigation extends View {
  init(initialProps, cx) {
    const props = hostProps() || initialProps;
    this.stack = props?.stack || "magpie-pages";
    this.focus = cx.focus_handle();
    cx.spawn(async (cx) => { for (;;) { if ((await nextCommand()) === "focus") this.focus.focus(); cx.notify(); } });
  }

  select(page) { run("layout.select", { stack: this.stack, child: page }); }

  render() {
    const t = theme();
    const active = find(layout(), this.stack)?.active;
    const item = (id, label) => div().id(`nav-${id}`).role("tab").aria_selected(active === id).tab_index(0).px(14).py(7).rounded(5).text_size(12)
      .bg(active === id ? t.selected : t.chrome).text_color(active === id ? t.foreground : t.muted)
      .focus(s => s.bg(t.selected).text_color(t.accent)).hover(s => s.bg(t.hover)).cursor_pointer()
      .on_key_down((e, cx) => { if (e.key === "enter" || e.key === "space") { cx.stop_propagation(); this.select(id); } })
      .on_click(() => { this.focus.focus(); this.select(id); }).child(label);
    return h_flex().id("magpie-nav").size_full().px(12).gap(6).items_center().bg(t.chrome)
      .track_focus(this.focus).on_key_down((e, cx) => {
        if (e.key === "left" || e.key === "right") {
          this.select(e.key === "left" ? "magpie-workspace" : "magpie-dashboard"); cx.stop_propagation();
        }
      })
      .child(item("magpie-workspace", "Workspace"))
      .child(item("magpie-dashboard", "Magpie"))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.muted).child("Routes & usage"));
  }
}
