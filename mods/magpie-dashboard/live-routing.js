// State transitions adapted from Magpie's Routing client: poll(), play(),
// stopPlays() and home(). See THIRD_PARTY_NOTICES.md for MIT attribution.
import { destinationKey, routeNodes, rowY } from './routing.js';

export class TraceStore {
  constructor() { this.clear(); }
  clear() { this.seq = 0; this.epoch = ''; this.loaded = false; this.routes = new Map(); }
  apply(frame, caught = false) {
    const reset = frame.reset || this.loaded && (frame.epoch !== this.epoch || frame.seq < this.seq);
    if (reset) this.clear();
    const first = !this.loaded;
    const fresh = [];
    for (const route of frame.routes) {
      if (!this.routes.has(route.id)) fresh.push(route.id);
      this.routes.set(route.id, route);
    }
    if (Array.isArray(frame.ids)) {
      const kept = new Set(frame.ids);
      for (const [id, route] of this.routes) if (!route.done && !kept.has(id)) this.routes.delete(id);
    }
    const ordered = [...this.routes.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    for (const route of ordered.slice(120)) this.routes.delete(route.id);
    this.seq = frame.seq; this.epoch = frame.epoch; this.loaded = true;
    // Opening or returning to a hidden surface flies only unfinished requests.
    const play = first || caught ? ordered.filter(route => !route.done).map(route => route.id) : fresh;
    return { reset, first, play };
  }
}

const belongs = (route, group) => !group ? true : group.direct ? !route.group && !route.groupRef
  : [group.id, group.ref, `group/${group.id}`, `auto/${group.id}`].filter(Boolean).includes(route.group)
    || [group.id, group.ref, `group/${group.id}`, `auto/${group.id}`].filter(Boolean).includes(route.groupRef)
    || [group.ref, `group/${group.id}`, `auto/${group.id}`].filter(Boolean).includes(route.requestedModel);
const eventsOf = routes => routes.flatMap(route => route.attempts.map(attempt => ({ ...attempt, requestId: route.id })));
const modelTarget = attempt => attempt && { ...attempt, model: attempt.model || attempt.served };

export class LiveRouting {
  constructor(canRun = () => true) {
    this.canRun = canRun; this.routes = new Map(); this.dots = new Map(); this.nodes = []; this.total = 0;
    this.group = null; this.generation = 0; this.waiters = new Set(); this.latest = null; this.overflow = 0;
  }
  wake() { for (const resolve of this.waiters) resolve(); this.waiters.clear(); }
  stop() { this.generation++; this.dots.clear(); this.wake(); }
  setGroup(group, cx) { this.stop(); this.group = group; this.project(); cx?.notify(); }
  project() {
    const routes = [...this.routes.values()].filter(route => belongs(route, this.group)).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const events = eventsOf(routes.slice(0, 12).reverse());
    const live = [...this.dots.values()].flatMap(dot => {
      const attempt = this.routes.get(dot.id)?.attempts[dot.attempt];
      return attempt ? [modelTarget(attempt)] : [];
    });
    const flat = routeNodes(this.group, [...events, ...live]);
    this.nodes = flat.nodes; this.total = flat.all; this.latest = routes[0] || null;
  }
  ingest(store, play, cx, { animate = true, reset = false } = {}) {
    if (reset) this.stop();
    this.routes = new Map(store.routes);
    for (const id of this.dots.keys()) if (!this.routes.has(id)) this.dots.delete(id);
    this.project(); this.wake();
    if (animate && this.canRun()) {
      const candidates = play.filter(id => this.routes.has(id) && belongs(this.routes.get(id), this.group) && !this.dots.has(id));
      const room = Math.max(0, 4 - this.dots.size);
      this.overflow = Math.max(0, candidates.length - room);
      if (room) for (const id of candidates.slice(-room)) this.start(id, cx);
    }
  }
  position(dot) {
    const attempt = this.routes.get(dot.id)?.attempts[dot.attempt];
    const index = attempt ? this.nodes.findIndex(node => node.key === destinationKey(modelTarget(attempt))) : -1;
    const y = index >= 0 ? rowY(index) : 8;
    return { x: ['to-model', 'held', 'result'].includes(dot.phase) ? 30 : 6,
      y: ['enter', 'selecting', 'home', 'finished'].includes(dot.phase) ? 8 : y };
  }
  async until(test, valid) {
    while (valid() && !test()) await new Promise(resolve => this.waiters.add(resolve));
  }
  start(id, cx) {
    const generation = this.generation;
    const dot = { id, phase: 'enter', attempt: 0, outcome: 'pending' };
    this.dots.set(id, dot); cx.notify();
    cx.spawn(async current => {
      const valid = () => generation === this.generation && this.dots.get(id) === dot && this.canRun();
      const route = () => this.routes.get(id);
      const wait = ms => new Promise(resolve => current.timer.after(ms, () => resolve()));
      const phase = async (name, ms) => { if (!valid()) return; dot.phase = name; current.notify(); if (ms) await wait(ms); };
      try {
        await phase('selecting', 180);
        for (let index = 0; valid(); index++) {
          await this.until(() => !route() || route().attempts.length > index || route().done, valid);
          if (!valid() || !route() || index >= route().attempts.length) break;
          dot.attempt = index; dot.outcome = 'pending'; this.project();
          // Arrival waits at the model until the *same* upstream attempt is done.
          await phase('to-rail', 240);
          await phase('to-model', 180);
          await phase('held', 0);
          await this.until(() => !route() || route().attempts[index]?.done, valid);
          if (!valid() || !route()) break;
          dot.outcome = route().attempts[index].status;
          await phase('result', 180);
          if (dot.outcome === 'success') {
            await this.until(() => !route() || route().done, valid);
            if (!valid() || !route()) break;
            await phase('return-rail', 180); await phase('home', 240);
            break;
          }
          // An unsuccessful attempt returns to the router. It waits there for
          // the next actual try; no timer pretends that a fallback has begun.
          await phase('return-rail', 180); await phase('home', 240);
          if (!route() || route().done && index + 1 >= route().attempts.length) break;
          await phase('selecting', 0);
        }
      } finally {
        if (this.dots.get(id) === dot) { this.dots.delete(id); current.notify(); }
      }
    });
  }
}
