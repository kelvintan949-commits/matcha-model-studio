// Outward normals of the five source masonry walls. The corridor return is
// on the negative-Z side of its own bay, despite lying above the model center.
const SHELL_NORMALS = new Map([
  [10674248, [1, 0, 0]],
  [10674076, [0, 0, -1]],
  [10674369, [0, 0, -1]],
  [10674152, [-1, 0, 0]],
  [10674212, [0, 0, 1]],
]);

export function buildWallCutaway(elements) {
  const hosts = elements.filter(e => SHELL_NORMALS.has(e.id));
  const bindings = new Map();
  for (const e of elements) {
    const attached = e.category === 'Walls' || e.category === 'Doors' ||
      (e.category === 'Generic Models' && e.layer === 'wall') ||
      (e.category === 'Casework' && /^Fantasy Wall/.test(e.family || ''));
    if (!attached) continue;
    const center = e.bounds[0].map((v, axis) => (v + e.bounds[1][axis]) / 2);
    let host = hosts.find(h => h.id === e.id);
    if (!host) {
      let nearest = Infinity;
      for (const candidate of hosts) {
        // Match finishes to their physical host in plan, including the L-shaped return.
        const distance = [0, 2].reduce((sum, axis) => {
          const nearestPoint = Math.max(candidate.bounds[0][axis], Math.min(center[axis], candidate.bounds[1][axis]));
          return sum + (center[axis] - nearestPoint) ** 2;
        }, 0);
        if (distance < nearest) { nearest = distance; host = candidate; }
      }
    }
    if (host) bindings.set(e.id, { hostId: host.id, normal: SHELL_NORMALS.get(host.id) });
  }
  return bindings;
}

export function wallFacesCamera(normal, towardCamera, previouslyHidden = false) {
  const length = Math.hypot(...towardCamera);
  if (!length) return false;
  // At a true top view, show the perimeter: no vertical wall obscures the plan.
  if (Math.hypot(towardCamera[0], towardCamera[2]) / length < 0.03) return false;
  const facing = normal.reduce((sum, v, axis) => sum + v * towardCamera[axis], 0) / length;
  // Hysteresis keeps edge-on walls steady during tiny orbit movements.
  if (facing > 0.035) return true;
  if (facing < -0.035) return false;
  return previouslyHidden;
}
