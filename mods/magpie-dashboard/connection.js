import { div } from 'gpui-kit';
import { h_flex, v_flex, InputState, Input } from 'gpui-base';

/** Retained native inputs. The key is write-only and is never stored in a mod's
 * localStorage, layout props or shipped config. */
export class ConnectionForm {
  constructor(endpoint, onSaved, onClose, preferences = {}) {
    this.endpoint = endpoint.split('#')[0].split('?')[0].replace(/\/api\/dashboard$/, '/api/connection');
    this.onSaved = onSaved; this.onClose = onClose; this.preferences = preferences;
    this.url = InputState.new({ placeholder: 'http://127.0.0.1:3430' });
    this.key = InputState.new({ placeholder: 'Magpie Web access key' }); this.key.set_masked(true);
    this.port = InputState.new({ placeholder: 'Auto · use the URL port' });
    this.info = null; this.message = ''; this.error = ''; this.busy = ''; this.generation = 0; this.closed = true;
    for (const [name, input] of [['url', this.url], ['key', this.key], ['port', this.port]]) {
      input.on('change', (_event, cx) => { this.message = ''; this.error = ''; cx.notify(); });
      input.on('focus', (_event, cx) => { this.focused = name; cx.notify(); });
      input.on('blur', (_event, cx) => { if (this.focused === name) this.focused = null; cx.notify(); });
    }
  }
  deadline(generation, saving, cx) {
    cx.timer.after(15000, current => {
      if (this.closed || generation !== this.generation || !this.busy) return;
      this.generation++; this.busy = ''; this.info = null;
      this.error = saving ? 'The save response timed out. Retry to read back the current connection before saving again.'
        : 'The bridge did not respond. Start it, then choose Retry.';
      // A save may already have reached disk; reread before allowing another write.
      current.notify();
    });
  }
  open(cx) {
    this.closed = false; this.info = null; this.error = ''; this.message = ''; this.busy = 'loading';
    this.key.set_value('');
    const generation = ++this.generation;
    this.deadline(generation, false, cx);
    cx.spawn(async current => {
      try {
        const response = await fetch(this.endpoint), info = await response.json();
        if (!response.ok || typeof info.url !== 'string' || typeof info.token !== 'string' || !Number.isSafeInteger(info.revision)) {
          throw new Error(response.ok ? 'Update and restart the local bridge to configure a connection here.' : info.error || 'Cannot read connection settings.');
        }
        if (this.closed || generation !== this.generation) return;
        this.info = info; this.url.set_value(info.url); this.port.set_value(info.cookiePort || '');
        this.message = info.notice || ''; this.url.focus();
      } catch (error) {
        if (!this.closed && generation === this.generation) this.error = String(error.message || 'Start the local bridge, then reopen Connection.').slice(0, 220);
      } finally {
        if (!this.closed && generation === this.generation) { this.busy = ''; current.notify(); }
      }
    });
  }
  close(cx) {
    if (this.busy === 'save') return;
    this.closed = true; this.generation++; this.key.set_value(''); this.busy = ''; this.onClose(cx);
  }
  dispose() { this.closed = true; this.generation++; this.key.set_value(''); }
  submit(save, cx) {
    if (this.busy || !this.info) return;
    const payload = { url: this.url.value(), key: this.key.value(), cookiePort: this.port.value(), revision: this.info.revision };
    if (!payload.url.trim()) { this.error = 'Enter the Magpie Web service address.'; cx.notify(); return; }
    this.busy = save ? 'save' : 'test'; this.error = ''; this.message = '';
    const generation = ++this.generation;
    this.deadline(generation, save, cx);
    cx.notify();
    cx.spawn(async current => {
      try {
        const response = await fetch(`${this.endpoint}${save ? '' : '/test'}`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Magpie-Config-Token': this.info.token }, body: JSON.stringify(payload) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Connection settings could not be applied.');
        if (this.closed || generation !== this.generation) return;
        if (!save && (payload.url !== this.url.value() || payload.key !== this.key.value() || payload.cookiePort !== this.port.value())) return;
        if (save) {
          if (typeof result.url !== 'string' || !Number.isSafeInteger(result.revision)) throw new Error('Incompatible settings response. Reopen Connection.');
          this.info = result; this.key.set_value(''); this.busy = ''; this.closed = true;
          this.onSaved(result, current);
        } else {
          if (!Array.isArray(result.checks)) throw new Error('Incompatible connection test response.');
          this.message = result.partial ? `Partially available: ${result.checks.map(check => `${check.name} ${check.ok ? 'OK' : 'unavailable'}`).join(' · ')}`
            : result.routingActive ? 'Connection verified' : 'Authenticated · the gateway is not routing yet';
        }
      } catch (error) {
        if (!this.closed && generation === this.generation) this.error = String(error.message || 'Cannot reach the bridge.').slice(0, 220);
      } finally {
        if (generation === this.generation) { this.busy = ''; current.notify(); }
      }
    });
  }
  render(t) {
    const text = (value, color = t.muted, size = 12) => div().min_w(0).text_size(size).text_color(color).child(value);
    const button = (id, title, action, disabled = false, primary = false) => div().id(id).role('button').tab_index(disabled ? -1 : 0)
      .h(32).px(10).rounded(7).flex().items_center().text_size(13)
      .bg(primary && !disabled ? t.solid : t.raised).text_color(disabled ? t.dim : primary ? t.solid_foreground : t.foreground)
      .when(!disabled, el => el.cursor_pointer().hover(s => s.bg(t.hover)).focus(s => s.bg(t.selected).text_color(t.accent)))
      .on_click((_event, cx) => { if (!disabled) action(cx); })
      .on_key_down((event, cx) => { if (event.key === 'enter' || event.key === 'space') { cx.stop_propagation(); if (!disabled) action(cx); } })
      .child(title);
    const field = (name, label, input, hint) => v_flex().gap(6).min_w(0)
      .child(text(label, t.foreground))
      .child(div().id(`connection-${name}`).min_w(0).on_mouse_down('left', (_event, cx) => cx.stop_propagation())
        .child(Input.new(input).disabled(Boolean(this.busy)).h(36).w_full().px(10).rounded(7).border_1().border_color(this.focused === name ? t.accent : t.input)
          .bg(t.background).text_color(t.foreground).text_size(13).accessibility_label(label)))
      .child(text(hint, t.muted, 12));
    const body = v_flex().id('connection-form').flex_1().min_h(0).min_w(0).overflow_y_scrollbar().p(14).gap(16)
      .child(text('Magpie connection', t.foreground, 16).font_semibold());
    if (this.busy === 'loading') body.child(text('Reading connection settings…'));
    if (this.info) body
      .child(field('url', 'Service URL', this.url, 'HTTP(S) address · paths such as /mac/ are supported'))
      .child(field('key', 'Web access key', this.key, this.info.hasKey ? 'Key saved. Leave blank to keep it for the same address.' : 'Use the Web access key, not the model gateway API key.'))
      .child(field('port', 'Internal Web port · optional', this.port, 'For a reverse proxy, usually 3430'));
    if (this.error) body.child(text(this.error, t.blocked));
    if (this.message) body.child(text(this.message, t.foreground));
    body.child(h_flex().gap(7).flex_wrap()
      .child(button('connection-test', this.busy === 'test' ? 'Testing…' : 'Test connection', cx => this.submit(false, cx), Boolean(this.busy || !this.info)))
      .child(button('connection-save', this.busy === 'save' ? 'Saving…' : 'Save & connect', cx => this.submit(true, cx), Boolean(this.busy || !this.info), true)))
      .child(text('Key stored privately on this computer', t.muted, 12));
    if (this.preferences.motion) body.child(div().h(1).bg(t.border)).child(h_flex().items_center().gap(12)
      .child(text('Routing motion', t.foreground, 13).flex_1())
      .child(button('route-motion', this.preferences.motion() ? 'On' : 'Off', cx => this.preferences.toggleMotion(cx))));
    if (!this.info && !this.busy) body.child(button('connection-retry', 'Retry', cx => this.open(cx)));
    return v_flex().id('magpie-connection').size_full().min_w(0).min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).px(14).gap(8).flex_none().items_center().border_b(1).border_color(t.border)
        .child(text('Settings', t.foreground, 13).font_semibold()).child(div().flex_1())
        .child(button('connection-back', 'Back', cx => this.close(cx), this.busy === 'save')))
      .child(body);
  }
}
