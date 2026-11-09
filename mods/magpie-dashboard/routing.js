const STRATEGIES = {
  order: ["In order", "Tries members in order; failures move to the next."],
  rotate: ["Round robin", "Rotates the destination between requests."],
  weight: ["By weight", "Shares requests by member weight; the dot follows observed choices."],
  usage: ["Least used", "Prefers available accounts with lower usage."],
  pace: ["By pace", "Chooses accounts according to quota pacing."],
  free: ["Free first", "Prefers free models before paid ones."],
  fast: ["Fastest", "Prefers models with better observed response speed."],
  cheap: ["Lowest cost", "Prefers members with a lower current price."],
  manual: ["Manual", "Uses the selected member."],
  default: ["Default", "Uses the service's default routing strategy."],
};
const aliases = { priority: "order", ordered: "order", weighted: "weight", "round-robin": "rotate" };
export const strategyInfo = value => {
  const id = aliases[value] || value || "default";
  const [label, hint] = STRATEGIES[id] || [String(id), "Custom strategy; the dot follows observed choices."];
  return { id, label, hint };
};
export const destinationKey = value => `${value.provider}\u0000${value.model}`;
export const rowY = index => 42 + index * 36;

export function routeEvents(group, requests) {
  if (!group) return [];
  const refs = new Set([group.id, group.ref, `group/${group.id}`, `auto/${group.id}`].filter(Boolean));
  const relevant = requests.filter(request => refs.has(request.group) || refs.has(request.requestedModel))
    .slice(0, 12).reverse();
  return relevant.flatMap(request => {
    const attempts = request.attempts?.length ? request.attempts : [request];
    return attempts.slice(0, 8).filter(attempt => attempt.provider && attempt.model).map((attempt, index) => ({
      id: `${request.id}:${index}:${attempt.status}:${destinationKey(attempt)}`,
      requestId: request.id, provider: attempt.provider, model: attempt.model,
      status: attempt.status, fallback: index > 0, at: Date.parse(request.timestamp) || 0,
      observedUntil: (Date.parse(request.timestamp) || 0) + (request.durationMs || 0),
    }));
  }).slice(-12);
}

/** Flat destinations only. Nested groups are not invented as responding models. */
export function routeNodes(group, events) {
  const nodes = new Map();
  const configured = (group?.members || []).filter(member => !member.group && member.provider && member.model);
  for (const member of configured) nodes.set(destinationKey(member), { ...member, key: destinationKey(member), observed: false });
  for (const event of events) {
    const key = destinationKey(event);
    if (!nodes.has(key)) nodes.set(key, { key, provider: event.provider, model: event.model, ready: null, enabled: true, observed: true });
  }
  // Keep recent destinations visible, retaining configured order among those shown.
  const recent = [...new Set(events.slice().reverse().map(destinationKey))].slice(0, 4);
  const chosen = new Set([...recent, ...nodes.keys()].slice(0, 4));
  return { all: nodes.size, nodes: [...nodes.values()].filter(node => chosen.has(node.key)) };
}

/** Semantic route events schedule a few native transition targets, never animation frames. */
export class RouteSignal {
  constructor(canRun = () => true) {
    this.canRun = canRun;
    this.context = null;
    this.nodes = [];
    this.total = 0;
    this.events = [];
    this.seen = new Set();
    this.current = null;
    this.x = 6;
    this.y = 8;
    this.phase = "idle";
    this.label = "No observed requests";
    this.generation = 0;
    this.serial = 0;
    this.moving = false;
  }

  stop() { this.generation++; this.moving = false; this.phase = "idle"; }

  sync(group, requests, mode, cx, { animate = true, firstDemo = false, now = Date.now() } = {}) {
    const context = `${mode}:${group?.id || ""}`;
    const changed = this.context !== context;
    const events = routeEvents(group, requests);
    const { nodes, all } = routeNodes(group, events);
    const geometryChanged = nodes.map(node => node.key).join("|") !== this.nodes.map(node => node.key).join("|");
    const fresh = changed ? [] : events.filter(event => !this.seen.has(event.id) && Math.max(event.at, event.observedUntil) >= now - 30000);
    if (changed || geometryChanged) this.stop();
    this.context = context; this.nodes = nodes; this.total = all;
    this.events = events.filter(event => nodes.some(node => node.key === destinationKey(event)));
    this.seen = new Set(events.map(event => event.id));
    if (!this.moving) {
      this.current = this.events.at(-1) || null;
      this.phase = "idle";
      this.x = this.current ? 30 : 6;
      this.y = this.current ? rowY(nodes.findIndex(node => node.key === destinationKey(this.current))) : 8;
      this.label = this.current ? "Latest observed route" : "No observed requests";
    }
    if (animate && !this.moving) {
      if (changed && firstDemo && mode === "demo") this.play(this.events.slice(-6), cx, "Demo replay");
      else if (!changed && !geometryChanged && fresh.length) this.play(fresh.slice(-6), cx, "New observations");
    }
  }

  replay(cx) { this.play(this.events.slice(-6), cx, this.context?.startsWith("demo:") ? "Demo replay" : "History replay"); }

  play(events, cx, label) {
    this.stop();
    const queue = events.filter(event => this.nodes.some(node => node.key === destinationKey(event)));
    if (!queue.length) return;
    const generation = this.generation;
    this.moving = true; this.label = label;
    const later = (delay, callback, context) => context.timer.after(delay, next => {
      if (generation !== this.generation) return;
      if (!this.canRun()) { this.stop(); next.notify(); return; }
      callback(next);
    });
    const next = context => {
      const event = queue.shift();
      if (!event) {
        this.moving = false; this.phase = "idle";
        this.label = label === "New observations" ? "Latest observed route" : `${label} · finished`;
        context.notify(); return;
      }
      this.current = event; this.serial++;
      this.x = 6; this.y = 8; this.phase = "launch";
      const target = rowY(this.nodes.findIndex(node => node.key === destinationKey(event)));
      context.notify();
      // One transition down the shared rail, then one into the model node.
      later(40, vertical => { this.y = target; this.phase = "travel"; vertical.notify(); }, context);
      later(280, horizontal => { this.x = 30; horizontal.notify(); }, context);
      later(460, arrived => { this.phase = "arrived"; arrived.notify(); }, context);
      later(1080, next, context);
    };
    next(cx);
  }
}
