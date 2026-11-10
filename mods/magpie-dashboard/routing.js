// Informational strategy labels only. The live view never selects or filters a group.
const STRATEGIES = {
  direct: 'Direct', order: 'In order', rotate: 'Round robin', weight: 'By weight',
  usage: 'Least used', pace: 'By pace', free: 'Free first', fast: 'Fastest', cheap: 'Lowest cost',
  manual: 'Manual', default: 'Default',
};
const aliases = { priority: 'order', ordered: 'order', weighted: 'weight', 'round-robin': 'rotate' };
export const strategyInfo = value => {
  const id = aliases[value] || value || 'default';
  return { id, label: STRATEGIES[id] || String(id) };
};
export const destinationKey = value => `${value.provider}\u0000${value.model}`;
export const rowY = index => 42 + index * 36;
