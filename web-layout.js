/* Geometry uses only the player's links. The answer key never enters this module. */
(function (root) {
  const GAP = 12;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const segments = (points) => points.slice(1).map((p, i) => [points[i], p]);
  const box = (node, pad = 0) => ({ left: node.x - node.width / 2 - pad, right: node.x + node.width / 2 + pad, top: node.y - node.height / 2 - pad, bottom: node.y + node.height / 2 + pad });

  function hitsBox(a, b, rect) {
    let low = 0, high = 1;
    for (const [origin, delta, min, max] of [[a.x, b.x - a.x, rect.left, rect.right], [a.y, b.y - a.y, rect.top, rect.bottom]]) {
      if (Math.abs(delta) < 0.00001) { if (origin <= min || origin >= max) return false; }
      else {
        const first = (min - origin) / delta, last = (max - origin) / delta;
        low = Math.max(low, Math.min(first, last));
        high = Math.min(high, Math.max(first, last));
        if (low >= high - 0.00001) return false;
      }
    }
    return true;
  }

  function intersects(a, b, c, d) {
    const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return cross(a, b, c) * cross(a, b, d) < -0.01 && cross(c, d, a) * cross(c, d, b) < -0.01;
  }

  // Place connected groups without a later force/collision pass undoing their
  // layers. Only the player's graph and measured button/label sizes enter here.
  function flowLayout(nodes, links, width, height, { direction = 'horizontal', wordGap = 48, labelSizes = [], expansions = new Map() } = {}) {
    const horizontal = direction === 'horizontal';
    const depth = horizontal ? 'width' : 'height', breadth = horizontal ? 'height' : 'width';
    const measured = new Map(nodes.map((n) => [n.id, n]));
    const neighbors = new Map(nodes.map((n) => [n.id, new Set()]));
    const outgoing = new Map(nodes.map((n) => [n.id, []]));
    const incoming = new Map(nodes.map((n) => [n.id, 0]));
    links.forEach(([a, b]) => {
      neighbors.get(a).add(b); neighbors.get(b).add(a);
      outgoing.get(a).push(b); incoming.set(b, incoming.get(b) + 1);
    });
    const margin = 38;
    const blocks = [], visited = new Set();
    const growth = (group, region) => expansions.get(`${group}:${region}`) || 1;
    // Intervals that do not overlap can use the same connector lane.
    const laneCount = (intervals) => {
      const events = intervals.filter(([a, b]) => Math.abs(a - b) > 1)
        .flatMap(([a, b]) => [[Math.min(a, b), 1], [Math.max(a, b), -1]])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let active = 0, maximum = 0;
      events.forEach(([, delta]) => { active += delta; maximum = Math.max(maximum, active); });
      return maximum;
    };
    for (const seed of nodes) {
      if (visited.has(seed.id) || !neighbors.get(seed.id).size) continue;
      const group = [], queue = [seed.id];
      visited.add(seed.id);
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i]; group.push(id);
        for (const other of neighbors.get(id)) if (!visited.has(other)) { visited.add(other); queue.push(other); }
      }
      // Stable ties follow puzzle word order, so rotating does not shuffle peers.
      const members = nodes.filter((n) => group.includes(n.id));
      // Put sources before destinations. DFS identifies only the edges that
      // close cycles; the remaining graph can be ranked in topological order.
      const state = new Map(), order = [], returning = new Set();
      function visit(id) {
        state.set(id, 1);
        for (const other of outgoing.get(id)) {
          if (state.get(other) === 1) returning.add(`${id}>${other}`);
          else if (!state.has(other)) visit(other);
        }
        state.set(id, 2); order.push(id);
      }
      [...members.filter((n) => !incoming.get(n.id)), ...members].forEach((n) => {
        if (!state.has(n.id)) visit(n.id);
      });
      const ranks = new Map(members.map((n) => [n.id, 0])), layers = [];
      for (const id of order.reverse()) for (const other of outgoing.get(id)) {
        if (!returning.has(`${id}>${other}`)) ranks.set(other, Math.max(ranks.get(other), ranks.get(id) + 1));
      }
      members.forEach((n) => (layers[ranks.get(n.id)] ||= []).push(n.id));
      const crossingCount = () => {
        const slots = new Map(layers.flatMap((layer) => layer.map((id, i) => [id, i])));
        let count = 0;
        for (let rank = 0; rank < layers.length - 1; rank++) {
          const edges = links.filter(([a, b]) => Math.abs(ranks.get(a) - ranks.get(b)) === 1 && Math.min(ranks.get(a), ranks.get(b)) === rank)
            .map(([a, b]) => ranks.get(a) === rank ? [a, b] : [b, a]);
          edges.forEach(([a, b], i) => edges.slice(i + 1).forEach(([c, d]) => {
            if ((slots.get(a) - slots.get(c)) * (slots.get(b) - slots.get(d)) < 0) count++;
          }));
        }
        return count;
      };
      // Median/barycenter sweeps align children with parents. Keep the best
      // ordering: a sweep must never introduce more inter-layer crossings.
      let best = layers.map((layer) => [...layer]), bestScore = crossingCount();
      for (let pass = 0; pass < 8; pass++) {
        const order = Array.from({ length: layers.length }, (_, i) => i);
        if (pass % 2) order.reverse();
        for (const rank of order) {
          const adjacent = rank + (pass % 2 ? 1 : -1);
          if (!layers[adjacent]) continue;
          const slots = new Map(layers[adjacent].map((id, i) => [id, i]));
          const center = (id, fallback) => {
            const peers = [...neighbors.get(id)].filter((other) => slots.has(other));
            return peers.length ? peers.reduce((sum, other) => sum + slots.get(other), 0) / peers.length : fallback;
          };
          layers[rank] = layers[rank].map((id, i) => ({ id, i, center: center(id, i) }))
            .sort((a, b) => a.center - b.center || a.i - b.i).map((entry) => entry.id);
        }
        const score = crossingCount();
        if (score <= bestScore) { bestScore = score; best = layers.map((layer) => [...layer]); }
      }
      layers.splice(0, layers.length, ...best);
      // Break equal-crossing ties by physical edge length. Neighbors sharing a
      // parent then stay together instead of inheriting arbitrary puzzle order.
      const orderingLength = () => {
        const slots = new Map();
        layers.forEach((layer) => {
          let cursor = -(layer.reduce((sum, id) => sum + measured.get(id)[breadth], 0) + wordGap * (layer.length - 1)) / 2;
          layer.forEach((id) => {
            slots.set(id, cursor + measured.get(id)[breadth] / 2);
            cursor += measured.get(id)[breadth] + wordGap;
          });
        });
        return links.reduce((sum, [a, b]) => ranks.has(a) && ranks.has(b)
          ? sum + Math.abs(slots.get(a) - slots.get(b)) : sum, 0);
      };
      let orderingScore = crossingCount(), orderingDistance = orderingLength();
      for (let pass = 0; pass < 4; pass++) {
        let improved = false;
        for (const layer of layers) for (let i = 1; i < layer.length; i++) {
          [layer[i - 1], layer[i]] = [layer[i], layer[i - 1]];
          const crossings = crossingCount(), length = orderingLength();
          if (crossings < orderingScore || (crossings === orderingScore && length < orderingDistance - 0.01)) {
            orderingScore = crossings; orderingDistance = length; improved = true;
          } else [layer[i - 1], layer[i]] = [layer[i], layer[i - 1]];
        }
        if (!improved) break;
      }
      const groupLinks = links.map(([a, b], edge) => ({ a, b, edge }))
        .filter(({ a, b }) => ranks.has(a) && ranks.has(b));
      // Extra port clearance belongs to the busy word and its immediate
      // neighbors, rather than every pair of words in the same layer.
      const crossGaps = layers.map((layer, rank) => {
        const clearance = layer.map((id) => {
          const n = measured.get(id);
          const capacity = Math.max(1, Math.floor((horizontal ? n.height * 0.8 : Math.max(12, n.width - n.height)) / GAP) - 1);
          const counts = [0, 0];
          neighbors.get(id).forEach((other) => counts[ranks.get(other) < rank ? 0 : 1]++);
          const spill = Math.ceil(counts.reduce((sum, count) => sum + Math.max(0, count - capacity), 0) / 2);
          return Math.max(wordGap, 36 + Math.max(0, spill - 1) * GAP);
        });
        return layer.slice(1).map((_, i) => Math.max(clearance[i], clearance[i + 1]) * growth(seed.id, `layer:${rank}`));
      });
      const centers = new Map();
      layers.forEach((layer, rank) => {
        const size = layer.reduce((sum, id) => sum + measured.get(id)[breadth], 0) + crossGaps[rank].reduce((sum, gap) => sum + gap, 0);
        let cross = -size / 2;
        layer.forEach((id, i) => { centers.set(id, cross + measured.get(id)[breadth] / 2); cross += measured.get(id)[breadth] + (crossGaps[rank][i] || 0); });
      });
      // Align each layer with its neighbors, projecting desired centers onto
      // non-overlapping positions while preserving the crossing-reduced order.
      for (let pass = 0; pass < 5; pass++) {
        const order = layers.map((_, i) => i);
        if (pass % 2) order.reverse();
        order.forEach((rank) => {
          const layer = layers[rank];
          const offsets = [], pools = [];
          layer.forEach((id, i) => {
            offsets[i] = i ? offsets[i - 1] + (measured.get(layer[i - 1])[breadth] + measured.get(id)[breadth]) / 2 + crossGaps[rank][i - 1] : 0;
            // Finish with a forward pass so a simple chain stays exactly
            // aligned rather than accumulating small routing bends.
            const peers = [...neighbors.get(id)].filter((other) => pass === 4 ? ranks.get(other) === rank - 1 : ranks.get(other) !== rank);
            const target = peers.length ? peers.reduce((sum, other) => sum + centers.get(other), 0) / peers.length : centers.get(id);
            pools.push({ start: i, end: i, sum: target - offsets[i], count: 1 });
            while (pools.length > 1 && pools.at(-2).sum / pools.at(-2).count > pools.at(-1).sum / pools.at(-1).count) {
              const last = pools.pop(), previous = pools.at(-1);
              previous.end = last.end; previous.sum += last.sum; previous.count += last.count;
            }
          });
          pools.forEach((pool) => {
            for (let i = pool.start; i <= pool.end; i++) centers.set(layer[i], pool.sum / pool.count + offsets[i]);
          });
        });
      }
      // Minimize total cross-axis travel using neighbor medians (the optimum
      // for absolute distance). Keep a move only when the whole graph improves;
      // separation constraints and the established branch order remain intact.
      const travel = () => groupLinks.reduce((sum, { a, b }) => sum + Math.abs(centers.get(a) - centers.get(b)), 0);
      let bestTravel = travel();
      for (let pass = 0; pass < 12; pass++) {
        let improved = false;
        const sweep = pass % 2 ? [...layers].reverse() : layers;
        for (const layer of sweep) {
          const shifts = layer.flatMap((id) => [...neighbors.get(id)]
            .filter((other) => ranks.get(other) !== ranks.get(id))
            .map((other) => centers.get(other) - centers.get(id))).sort((a, b) => a - b);
          if (!shifts.length) continue;
          const shift = Math.max(shifts[Math.floor((shifts.length - 1) / 2)], Math.min(shifts[Math.floor(shifts.length / 2)], 0));
          layer.forEach((id) => centers.set(id, centers.get(id) + shift));
          const shiftedTravel = travel();
          if (shiftedTravel < bestTravel - 0.01) { bestTravel = shiftedTravel; improved = true; }
          else layer.forEach((id) => centers.set(id, centers.get(id) - shift));
          for (let i = 0; i < layer.length; i++) {
            const id = layer[i], rank = ranks.get(id), previous = centers.get(id);
            const targets = [...neighbors.get(id)].map((other) => centers.get(other)).sort((a, b) => a - b);
            const lowerMedian = targets[Math.floor((targets.length - 1) / 2)];
            const upperMedian = targets[Math.floor(targets.length / 2)];
            let target = Math.max(lowerMedian, Math.min(upperMedian, previous));
            const low = i ? centers.get(layer[i - 1]) + (measured.get(layer[i - 1])[breadth] + measured.get(id)[breadth]) / 2 + crossGaps[rank][i - 1] : -Infinity;
            const high = i < layer.length - 1 ? centers.get(layer[i + 1]) - (measured.get(layer[i + 1])[breadth] + measured.get(id)[breadth]) / 2 - crossGaps[rank][i] : Infinity;
            target = Math.max(low, Math.min(high, target));
            centers.set(id, target);
            const nextTravel = travel();
            if (nextTravel < bestTravel - 0.01) { bestTravel = nextTravel; improved = true; }
            else centers.set(id, previous);
          }
        }
        if (!improved) break;
      }
      const local = [];
      let offset = 0, endReserve = 0;
      layers.forEach((layer, rank) => {
        const layerDepth = Math.max(...layer.map((id) => measured.get(id)[depth]));
        layer.forEach((id) => {
          const n = measured.get(id), main = offset + layerDepth / 2, side = centers.get(id);
          local.push({ ...n, x: horizontal ? main : side, y: horizontal ? side : main, layer: rank, group: seed.id });
        });
        const edges = groupLinks.filter(({ a, b }) => Math.min(ranks.get(a), ranks.get(b)) <= rank &&
          (Math.max(ranks.get(a), ranks.get(b)) > rank || (rank === layers.length - 1 && returning.has(`${a}>${b}`))));
        const labelDepth = Math.max(0, ...edges.map(({ edge }) => labelSizes[edge]?.[depth] || 0));
        const lanes = laneCount(edges.map(({ a, b }) => [centers.get(a), centers.get(b)]));
        // Include both the word's padded edge and the label's padding. A gap
        // that only fits the glyphs forces labels above/below the whole layer.
        const channel = Math.max(48, labelDepth + 32, 32 + lanes * GAP) * growth(seed.id, `channel:${rank}`);
        // A final layer needs an outside channel only for its returning links.
        endReserve = rank === layers.length - 1 && edges.length ? channel : 0;
        offset += layerDepth + channel;
      });
      const left = Math.min(...local.map((n) => n.x - n.width / 2));
      const top = Math.min(...local.map((n) => n.y - n.height / 2));
      const right = Math.max(...local.map((n) => n.x + n.width / 2));
      const bottom = Math.max(...local.map((n) => n.y + n.height / 2));
      // Keep returning arrows in dedicated lanes outside the group's words.
      const returnReserve = returning.size ? 36 + returning.size * GAP : 0;
      const skipping = groupLinks.filter(({ a, b }) => Math.abs(ranks.get(a) - ranks.get(b)) > 1);
      // Long arrows need side corridors even when every layer has one word.
      // Grow those corridors on retry; increasing peer spacing alone cannot
      // create any room in a single-word layer.
      const sideReserve = skipping.length ? (24 + skipping.length * GAP +
        Math.max(0, ...skipping.map(({ edge }) => labelSizes[edge]?.[breadth] || 0))) *
        Math.max(...layers.map((_, rank) => growth(seed.id, `layer:${rank}`))) : 0;
      blocks.push({ nodes: local.map((n) => ({ ...n,
        x: n.x - left + (horizontal ? 0 : returnReserve + sideReserve),
        y: n.y - top + (horizontal ? returnReserve + sideReserve : 0) })),
        width: right - left + (horizontal ? endReserve : returnReserve + sideReserve * 2),
        height: bottom - top + (horizontal ? returnReserve + sideReserve * 2 : endReserve) });
    }
    // Pack islands and unconnected words as separate rectangles, so short
    // groups and loose words can fill the space beside longer groups.
    nodes.filter((n) => !visited.has(n.id)).forEach((n) => blocks.push({
      width: n.width, height: n.height, nodes: [{ ...n, x: n.width / 2, y: n.height / 2 }],
    }));
    const ratio = horizontal ? width / height : height / width;
    const area = blocks.reduce((sum, block) => sum + (block[depth] + wordGap) * (block[breadth] + wordGap), 0);
    const target = Math.max(0, ...blocks.map((block) => block[depth]), Math.sqrt(area * ratio));
    let main = margin, cross = margin, rowSize = 0, usedWidth = 0, usedHeight = 0;
    const placed = [];
    blocks.forEach((block) => {
      if (main > margin && main + block[depth] > target + margin) { main = margin; cross += rowSize + wordGap; rowSize = 0; }
      const x = horizontal ? main : cross, y = horizontal ? cross : main;
      usedWidth = Math.max(usedWidth, x + block.width);
      usedHeight = Math.max(usedHeight, y + block.height);
      block.nodes.forEach((n) => placed.push({ ...n, x: n.x + x, y: n.y + y }));
      main += block[depth] + wordGap;
      rowSize = Math.max(rowSize, block[breadth]);
    });
    return { nodes: placed, width: Math.ceil(Math.max(width, usedWidth + margin)), height: Math.ceil(Math.max(height, usedHeight + margin)) };
  }

  // A folded sequence uses only player-created paths. Branches and cycles
  // remain the responsibility of the directed flowchart layout.
  function serpentineLayout(nodes, links, width, height, { wordGap = 48, labelSizes = [], spacingScale = 1 } = {}) {
    if (!links.length) return null;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const next = new Map(), previous = new Map();
    for (const [a, b] of links) {
      if (!byId.has(a) || !byId.has(b) || next.has(a) || previous.has(b) || a === b) return null;
      next.set(a, b); previous.set(b, a);
    }
    const paths = [], visited = new Set();
    for (const node of nodes) {
      if (previous.has(node.id)) continue;
      const path = [];
      for (let id = node.id; id !== undefined; id = next.get(id)) {
        if (visited.has(id)) return null;
        visited.add(id); path.push(byId.get(id));
      }
      paths.push(path);
    }
    if (visited.size !== nodes.length || !paths.some((path) => path.length >= 4)) return null;
    const margin = 38;
    const cellWidth = Math.max(...nodes.map((n) => n.width));
    const cellHeight = Math.max(...nodes.map((n) => n.height));
    const xGap = Math.max(wordGap, ...labelSizes.map((size) => size ? size.width + 64 : 0)) * spacingScale;
    const yGap = Math.max(wordGap, ...labelSizes.map((size) => size ? size.height + 64 : 0)) * spacingScale;
    let best = null, bestFit = -Infinity;
    for (let columns = 2; columns <= Math.max(...paths.map((path) => path.length)); columns++) {
      const placed = [];
      let row = 0;
      for (const path of paths) {
        path.forEach((n, index) => {
          const pathRow = Math.floor(index / columns);
          const slot = index % columns;
          const column = pathRow % 2 ? columns - 1 - slot : slot;
          placed.push({ ...n, x: margin + cellWidth / 2 + column * (cellWidth + xGap),
            y: margin + cellHeight / 2 + (row + pathRow) * (cellHeight + yGap) });
        });
        row += Math.ceil(path.length / columns);
      }
      const usedWidth = Math.max(...placed.map((n) => n.x + n.width / 2)) + margin;
      const usedHeight = Math.max(...placed.map((n) => n.y + n.height / 2)) + margin;
      const fit = Math.min((width - 24) / usedWidth, (height - 24) / usedHeight);
      if (fit > bestFit) {
        bestFit = fit;
        best = { nodes: placed, width: Math.max(width, usedWidth), height: Math.max(height, usedHeight), type: 'serpentine' };
      }
    }
    return best;
  }

  // Graph-shaped themes never inspect authored answers or word meanings.
  // Connected components are built solely from the player's links.
  function themedLayout(type, nodes, links, width, height, options = {}) {
    if (type === 'serpentine') return serpentineLayout(nodes, links, width, height, options);
    if (!['radial', 'circular', 'clustered', 'anatomical'].includes(type) || !links.length) return null;
    const { wordGap = 48, labelSizes = [], spacingScale = 1 } = options;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const neighbors = new Map(nodes.map((n) => [n.id, new Set()]));
    const indegree = new Map(nodes.map((n) => [n.id, 0]));
    const edgeSizes = new Map();
    links.forEach(([a, b], i) => {
      if (!byId.has(a) || !byId.has(b)) return;
      neighbors.get(a).add(b); neighbors.get(b).add(a);
      indegree.set(b, indegree.get(b) + 1);
      edgeSizes.set([a, b].sort().join('\0'), labelSizes[i] || { width: 0, height: 0 });
    });
    const visited = new Set(), blocks = [], margin = 38;
    const aspect = Math.max(0.65, Math.min(1.65, Math.sqrt(width / height)));
    for (const seed of nodes) {
      if (visited.has(seed.id)) continue;
      const component = [seed.id]; visited.add(seed.id);
      for (let i = 0; i < component.length; i++) for (const other of neighbors.get(component[i])) {
        if (!visited.has(other)) { visited.add(other); component.push(other); }
      }
      const roots = type === 'anatomical' ? component.filter((id) => !indegree.get(id)) : [];
      const root = [...(roots.length ? roots : component)].sort((a, b) => neighbors.get(b).size - neighbors.get(a).size)[0];
      const children = new Map(component.map((id) => [id, []]));
      const depth = new Map([[root, 0]]), queue = [root];
      for (let i = 0; i < queue.length; i++) for (const other of neighbors.get(queue[i])) {
        if (!depth.has(other)) {
          depth.set(other, depth.get(queue[i]) + 1); children.get(queue[i]).push(other); queue.push(other);
        }
      }
      const weight = new Map(), longest = new Map();
      [...queue].reverse().forEach((id) => {
        weight.set(id, Math.max(1, children.get(id).reduce((sum, child) => sum + weight.get(child), 0)));
        longest.set(id, 1 + Math.max(0, ...children.get(id).map((child) => longest.get(child))));
      });
      const points = new Map();
      const ordered = [];
      function radial(id, start, span) {
        ordered.push(id);
        const angle = start + span / 2;
        points.set(id, { x: depth.get(id) * Math.cos(angle) * aspect, y: depth.get(id) * Math.sin(angle) / aspect });
        let cursor = start;
        children.get(id).forEach((child) => {
          const part = span * weight.get(child) / weight.get(id);
          radial(child, cursor, part); cursor += part;
        });
      }
      radial(root, -Math.PI / 2, Math.PI * 2);
      if (type === 'circular' && ordered.length > 1) ordered.forEach((id, i) => {
        const angle = -Math.PI / 2 + Math.PI * 2 * i / ordered.length;
        points.set(id, { x: Math.cos(angle) * aspect, y: Math.sin(angle) / aspect });
      });
      if (type === 'anatomical') {
        // A longest backbone stays upright; shorter branches spread beside it.
        const occupied = new Map();
        function spine(id, x) {
          const row = depth.get(id);
          if (!occupied.has(row)) occupied.set(row, new Set());
          while (occupied.get(row).has(x)) x += x < 0 ? -1 : 1;
          occupied.get(row).add(x);
          points.set(id, { x, y: row });
          const branches = [...children.get(id)].sort((a, b) => longest.get(b) - longest.get(a));
          branches.forEach((child, i) => spine(child, i ? x + (i % 2 ? -1 : 1) * Math.ceil(i / 2) : x));
        }
        spine(root, 0);
      }
      if (type === 'clustered') {
        // Stable force relaxation pulls linked terms together. A later measured
        // scaling pass supplies exact clearance for the differently sized pills.
        const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length * aspect)));
        ordered.forEach((id, i) => points.set(id, { x: i % columns, y: Math.floor(i / columns) }));
        for (let pass = 0; pass < 60; pass++) {
          const moves = new Map(ordered.map((id) => [id, { x: 0, y: 0 }]));
          ordered.forEach((a, i) => ordered.slice(i + 1).forEach((b) => {
            const p = points.get(a), q = points.get(b);
            let dx = q.x - p.x, dy = q.y - p.y;
            if (Math.abs(dx) + Math.abs(dy) < 0.001) dx = 0.01;
            const d = Math.max(0.01, Math.hypot(dx, dy));
            const attraction = neighbors.get(a).has(b) ? (d - 1.5) * 0.035 : 0;
            const force = attraction - 0.035 / (d * d);
            const x = dx / d * force, y = dy / d * force;
            moves.get(a).x += x; moves.get(a).y += y;
            moves.get(b).x -= x; moves.get(b).y -= y;
          }));
          ordered.forEach((id) => {
            const p = points.get(id), delta = moves.get(id);
            p.x += Math.max(-0.15, Math.min(0.15, delta.x));
            p.y += Math.max(-0.15, Math.min(0.15, delta.y));
          });
        }
      }
      // Scale until each pair has clearance on at least one axis. Linked pairs
      // also reserve local space for their own connector label and exit ports.
      let scale = 1;
      ordered.forEach((a, i) => ordered.slice(i + 1).forEach((b) => {
        const p = points.get(a), q = points.get(b), na = byId.get(a), nb = byId.get(b);
        const label = edgeSizes.get([a, b].sort().join('\0'));
        const gapX = label ? Math.max(wordGap, label.width + 64) : wordGap;
        const gapY = label ? Math.max(wordGap, label.height + 64) : wordGap;
        const sx = ((na.width + nb.width) / 2 + gapX) / Math.max(0.0001, Math.abs(p.x - q.x));
        const sy = ((na.height + nb.height) / 2 + gapY) / Math.max(0.0001, Math.abs(p.y - q.y));
        scale = Math.max(scale, Math.min(sx, sy));
      }));
      scale *= spacingScale;
      const placed = ordered.map((id) => ({ ...byId.get(id), x: points.get(id).x * scale, y: points.get(id).y * scale }));
      const left = Math.min(...placed.map((n) => n.x - n.width / 2)), top = Math.min(...placed.map((n) => n.y - n.height / 2));
      const right = Math.max(...placed.map((n) => n.x + n.width / 2)), bottom = Math.max(...placed.map((n) => n.y + n.height / 2));
      blocks.push({ width: right - left, height: bottom - top, nodes: placed.map((n) => ({ ...n, x: n.x - left, y: n.y - top })) });
    }
    const area = blocks.reduce((sum, b) => sum + (b.width + wordGap) * (b.height + wordGap), 0);
    const target = Math.max(...blocks.map((b) => b.width), Math.sqrt(area * width / height));
    let x = margin, y = margin, rowHeight = 0, usedWidth = 0, usedHeight = 0;
    const placed = [];
    blocks.forEach((block) => {
      if (x > margin && x + block.width > target + margin) { x = margin; y += rowHeight + wordGap; rowHeight = 0; }
      block.nodes.forEach((n) => placed.push({ ...n, x: n.x + x, y: n.y + y }));
      usedWidth = Math.max(usedWidth, x + block.width); usedHeight = Math.max(usedHeight, y + block.height);
      x += block.width + wordGap; rowHeight = Math.max(rowHeight, block.height);
    });
    return { nodes: placed, width: Math.max(width, usedWidth + margin), height: Math.max(height, usedHeight + margin), type };
  }

  // Shared acceptance checks for optional layouts. An unsafe candidate never
  // replaces the flowchart, even if it would have a better fit scale.
  function layoutProblems(nodes, links, routes, { labelSizes = [], wordGap = 48 } = {}) {
    const problems = [];
    if (routes.length !== links.length || new Set(routes.map((r) => r.edge)).size !== links.length) problems.push('missing route');
    nodes.forEach((a, i) => nodes.slice(i + 1).forEach((b) => {
      if (Math.abs(a.x - b.x) < (a.width + b.width) / 2 + wordGap - 0.001 &&
          Math.abs(a.y - b.y) < (a.height + b.height) / 2 + wordGap - 0.001) problems.push('word clearance');
    }));
    for (const route of routes) {
      const expected = links[route.edge];
      if (!expected || route.words[0] !== expected[0] || route.words[1] !== expected[1]) problems.push('direction');
      if (labelSizes[route.edge] && !route.label) problems.push('missing label');
      const source = nodes.find((n) => n.id === route.words[0]);
      const destination = nodes.find((n) => n.id === route.words[1]);
      const anchored = (point, node) => {
        if (!point || !node) return false;
        const bounds = box(node, 0.01);
        return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
      };
      if (!anchored(route.points[0], source) || !anchored(route.points.at(-1), destination)) problems.push('detached endpoint');
      const lines = segments(route.points);
      if (route.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) problems.push('invalid point');
      lines.forEach(([a, b], index) => {
        for (const n of nodes) {
          if ((index === 0 && n.id === route.words[0]) || (index === lines.length - 1 && n.id === route.words[1])) continue;
          if (hitsBox(a, b, box(n, 10))) problems.push('word collision');
        }
      });
      if (!route.label) continue;
      if (nodes.some((n) => overlaps(route.label, box(n, 10)))) problems.push('label collision');
      for (const other of routes) {
        if (segments(other.points).some(([a, b]) => hitsBox(a, b, route.label))) problems.push('label route collision');
        if (other !== route && other.label && overlaps(route.label, other.label)) problems.push('label overlap');
      }
    }
    if (hasSharedLanes(routes)) problems.push('shared lane');
    return [...new Set(problems)];
  }

  function optimize(nodes, links, width, height, { wordGap = 48, minimumLinkDistance = 220 } = {}) {
    const result = nodes.map((n) => ({ ...n }));
    const byId = new Map(result.map((n) => [n.id, n]));
    const degrees = new Map(result.map((n) => [n.id, 0]));
    links.forEach(([a, b]) => { degrees.set(a, degrees.get(a) + 1); degrees.set(b, degrees.get(b) + 1); });
    const anchors = new Map(result.map((n) => [n.id, { x: n.x, y: n.y }]));
    const edges = links.map(([a, b]) => [byId.get(a), byId.get(b)]);
    const clamp = (n) => {
      n.x = Math.max(n.width / 2 + 38, Math.min(width - n.width / 2 - 38, n.x));
      n.y = Math.max(n.height / 2 + 38, Math.min(height - n.height / 2 - 38, n.y));
    };
    result.forEach(clamp);
    function score() {
      let value = 0, crowding = 0;
      for (let i = 0; i < result.length; i++) {
        const a = result[i];
        value += distance(a, anchors.get(a.id)) ** 2 * (degrees.get(a.id) > 2 ? 0.02 : 0.006);
        if (!degrees.get(a.id) && links.length) {
          const radius = Math.hypot((a.x - width / 2) / (width / 2), (a.y - height / 2) / (height / 2));
          value += Math.max(0, 0.78 - radius) ** 2 * 20000;
        }
        for (const b of result.slice(i + 1)) {
          const ox = (a.width + b.width) / 2 + wordGap - Math.abs(a.x - b.x);
          const oy = (a.height + b.height) / 2 + wordGap - Math.abs(a.y - b.y);
          if (ox > 0 && oy > 0) crowding += ox * oy;
        }
      }
      edges.forEach(([a, b], index) => {
        const comfortableDistance = Math.max(minimumLinkDistance, Math.hypot((a.width + b.width) / 2 + wordGap, (a.height + b.height) / 2 + wordGap));
        value += Math.max(0, distance(a, b) - comfortableDistance) ** 2 * 0.004;
        for (const n of result) if (n !== a && n !== b && hitsBox(a, b, box(n, 16))) value += 15000;
        for (const [c, d] of edges.slice(index + 1)) {
          if (a !== c && a !== d && b !== c && b !== d && intersects(a, b, c, d)) value += 10000;
        }
      });
      return [crowding, value];
    }
    // Clearance takes priority over shorter links, anchors, and crossings.
    const improves = (candidate, best) => candidate[0] < best[0] || (candidate[0] === best[0] && candidate[1] < best[1]);
    let best = score();
    for (const step of [70, 45, 28, 16, 8]) {
      for (let pass = 0; pass < 2; pass++) {
        for (const n of result) {
          const original = { x: n.x, y: n.y };
          let chosen = original;
          for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            n.x = original.x + dx * step; n.y = original.y + dy * step; clamp(n);
            const candidate = score();
            if (improves(candidate, best)) { best = candidate; chosen = { x: n.x, y: n.y }; }
          }
          Object.assign(n, chosen);
        }
        // Swapping two spokes can remove a crossing without growing the graph.
        for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
          const a = result[i], b = result[j];
          if (!degrees.get(a.id) || !degrees.get(b.id)) continue;
          const old = [a.x, a.y, b.x, b.y];
          [a.x, a.y, b.x, b.y] = [b.x, b.y, a.x, a.y]; clamp(a); clamp(b);
          const candidate = score();
          if (improves(candidate, best)) best = candidate;
          else [a.x, a.y, b.x, b.y] = old;
        }
      }
    }
    return result;
  }

  // Final placement treats pill clearance as a requirement, after the softer
  // crossing optimization. Grow the canvas if no free position remains.
  function separateWords(nodes, width, height, gap = 48, margin = 38) {
    width = Math.max(width, ...nodes.map((n) => n.width + margin * 2));
    height = Math.max(height, ...nodes.map((n) => n.height + margin * 2));
    const placed = [];
    for (const node of nodes) {
      const minX = node.width / 2 + margin, maxX = width - minX;
      const minY = node.height / 2 + margin, maxY = height - minY;
      const desired = {
        x: Math.max(minX, Math.min(maxX, node.x)),
        y: Math.max(minY, Math.min(maxY, node.y)),
      };
      const clear = (p) => placed.every((other) =>
        Math.abs(p.x - other.x) >= (node.width + other.width) / 2 + gap ||
        Math.abs(p.y - other.y) >= (node.height + other.height) / 2 + gap);
      let chosen = desired;
      if (!clear(desired)) {
        // A free rectangle can start beside any occupied rectangle. Include
        // board edges and the desired axes to find the nearest available spot.
        const axes = (coordinate, size, low, high) => [...new Set([
          desired[coordinate], low, high,
          ...placed.flatMap((other) => {
            const separation = (node[size] + other[size]) / 2 + gap + 1;
            return [other[coordinate] - separation, other[coordinate] + separation];
          }),
        ].filter((value) => value >= low && value <= high))];
        const xs = axes('x', 'width', minX, maxX);
        const ys = axes('y', 'height', minY, maxY);
        let best = Infinity;
        chosen = null;
        for (const x of xs) for (const y of ys) {
          const cost = (x - desired.x) ** 2 + (y - desired.y) ** 2;
          if (cost < best && clear({ x, y })) { chosen = { x, y }; best = cost; }
        }
        if (!chosen) {
          chosen = {
            x: desired.x,
            y: Math.max(...placed.map((other) => other.y + other.height / 2)) + gap + 1 + node.height / 2,
          };
          height = Math.max(height, Math.ceil(chosen.y + node.height / 2 + margin));
        }
      }
      placed.push({ ...node, ...chosen });
    }
    return { nodes: placed, width, height };
  }

  function assignPorts(nodes, links, { direction } = {}) {
    const ports = new Map();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) {
      const sides = { left: [], right: [], top: [], bottom: [] };
      links.forEach(([a, b], edge) => {
        if (a !== n.id && b !== n.id) return;
        const other = byId.get(a === n.id ? b : a);
        const dx = other.x - n.x, dy = other.y - n.y;
        const returning = direction && n.group !== undefined && n.group === other.group &&
          (a === n.id ? n.layer >= other.layer : other.layer >= n.layer);
        // Compare distance from the pill boundary so wide words can use a
        // top/bottom port when that gives the most direct approach.
        const choices = [['right', dx / n.width], ['left', -dx / n.width], ['bottom', dy / n.height], ['top', -dy / n.height]].sort((a, b) => b[1] - a[1]);
        if (direction) {
          const horizontal = direction === 'horizontal';
          const delta = horizontal ? dx : dy;
          const preferred = returning ? (horizontal ? 'top' : 'left') : Math.abs(delta) < 1 ? choices[0][0]
            : horizontal ? (delta > 0 ? 'right' : 'left') : (delta > 0 ? 'bottom' : 'top');
          choices.sort((a, b) => Number(b[0] === preferred) - Number(a[0] === preferred));
        }
        const capacity = (side) => Math.max(1, Math.floor((side === 'top' || side === 'bottom' ? Math.max(12, n.width - n.height) : n.height * 0.8) / GAP) - 1);
        const facing = choices.filter(([, score]) => score > 0);
        const candidates = returning ? [choices[0]] : facing.length ? facing : choices;
        const side = candidates.find(([name]) => sides[name].length < capacity(name))?.[0] || candidates[0][0];
        sides[side].push({ edge, other });
      });
      for (const [side, entries] of Object.entries(sides)) {
        const horizontal = side === 'top' || side === 'bottom';
        entries.sort((a, b) => horizontal ? a.other.x - b.other.x : a.other.y - b.other.y);
        entries.forEach(({ edge }, index) => {
          const fraction = (index + 1) / (entries.length + 1) - 0.5;
          let x, y, dx = 0, dy = 0;
          if (horizontal) {
            x = n.x + fraction * Math.max(12, n.width - n.height);
            dy = side === 'top' ? -1 : 1; y = n.y + dy * n.height / 2;
          } else {
            y = n.y + fraction * n.height * 0.8;
            dx = side === 'left' ? -1 : 1;
            const radius = n.height / 2;
            x = n.x + dx * (n.width / 2 - radius + Math.sqrt(radius ** 2 - (y - n.y) ** 2));
          }
          // Measure the exit from the bounding box rather than the rounded
          // pill edge: curved-side ports must still clear the padded obstacle.
          const escape = 24 + (direction ? index * GAP : 0);
          ports.set(`${edge}:${n.id}`, { anchor: { x, y }, exit: { x: dx ? n.x + dx * (n.width / 2 + escape) : x, y: dy ? n.y + dy * (n.height / 2 + escape) : y } });
        });
      }
    }
    return ports;
  }

  class Heap {
    constructor() { this.items = []; }
    push(item) {
      const a = this.items; a.push(item); let i = a.length - 1;
      while (i) { const p = (i - 1) >> 1; if (a[p].priority <= item.priority) break; a[i] = a[p]; i = p; } a[i] = item;
    }
    pop() {
      const a = this.items, first = a[0], last = a.pop();
      if (a.length) { let i = 0; while (2 * i + 1 < a.length) { let c = 2 * i + 1; if (c + 1 < a.length && a[c + 1].priority < a[c].priority) c++; if (a[c].priority >= last.priority) break; a[i] = a[c]; i = c; } a[i] = last; }
      return first;
    }
  }

  function simplify(points) {
    const out = [];
    for (const p of points) {
      if (out.length && distance(p, out.at(-1)) < 0.001) continue;
      while (out.length >= 2) {
        const a = out.at(-2), b = out.at(-1);
        const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
        const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y);
        if (Math.abs(cross) > 0.001 || dot < 0) break;
        out.pop();
      }
      out.push(p);
    }
    return out;
  }

  function congestion(a, b, previous, hardOverlap = true) {
    let cost = 0;
    const horizontal = Math.abs(a.y - b.y) < 0.001;
    for (const [c, d] of previous) {
      const otherHorizontal = Math.abs(c.y - d.y) < 0.001;
      if (horizontal === otherHorizontal) {
        const gap = horizontal ? Math.abs(a.y - c.y) : Math.abs(a.x - c.x);
        const overlap = horizontal ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) : Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
        if (overlap > 0.01 && gap < GAP) {
          if (gap < 0.01 && hardOverlap) return Infinity;
          cost += overlap * (GAP - gap) * 12;
        }
      } else {
        const h = horizontal ? [a, b] : [c, d], v = horizontal ? [c, d] : [a, b];
        // Include endpoints: a grid junction must not hide a crossing from the scorer.
        if (v[0].x >= Math.min(h[0].x, h[1].x) - 0.001 && v[0].x <= Math.max(h[0].x, h[1].x) + 0.001 && h[0].y >= Math.min(v[0].y, v[1].y) - 0.001 && h[0].y <= Math.max(v[0].y, v[1].y) + 0.001) cost += 600;
      }
    }
    return cost;
  }

  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  function hasSharedLanes(routes) {
    return routes.some((route, i) => {
      const prior = routes.slice(i + 1).flatMap((other) => segments(other.points));
      return segments(route.points).some(([a, b]) => congestion(a, b, prior) === Infinity);
    });
  }

  function placeLabel(route, size, nodes, others, ports, width, height) {
    if (!size) return null;
    const padding = 6;
    const rectangles = [...nodes.map((n) => box(n, 14)), ...others.filter((r) => r.label).map((r) => r.label)];
    const lines = [...others.flatMap((r) => [...segments(r.points), ...(r.label?.leader ? [r.label.leader] : [])]),
      ...[...ports.values()].map((p) => [p.anchor, p.exit])];
    const own = segments(route.points);
    // Prefer a centered label just beside a long straight segment. Larger
    // offsets are fallback callouts, with a short leader back to the link.
    for (const extra of [0, 18, 36, 72, 120]) {
      for (const [a, b] of [...own].sort((a, b) => distance(...b) - distance(...a))) {
        const horizontal = Math.abs(a.y - b.y) < 0.01;
        if (distance(a, b) < (horizontal ? size.width : size.height) + 12) continue;
        for (const fraction of [0.5, 0.3, 0.7]) for (const side of [-1, 1]) {
          const anchor = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
          const offset = (horizontal ? size.height : size.width) / 2 + padding + extra;
          const x = anchor.x + (horizontal ? 0 : side * offset), y = anchor.y + (horizontal ? side * offset : 0);
          const rect = { x, y, width: size.width, height: size.height, left: x - size.width / 2 - padding,
            right: x + size.width / 2 + padding, top: y - size.height / 2 - padding, bottom: y + size.height / 2 + padding };
          if (rect.left < 4 || rect.top < 4 || rect.right > width - 4 || rect.bottom > height - 4) continue;
          if (rectangles.some((r) => overlaps(rect, r)) || [...lines, ...own].some(([c, d]) => hitsBox(c, d, rect))) continue;
          const tip = { x: horizontal ? x : x - side * size.width / 2, y: horizontal ? y - side * size.height / 2 : y };
          const leaderObstacles = [...lines, ...own.filter(([c, d]) => c !== a || d !== b)];
          if (extra && (rectangles.some((r) => hitsBox(anchor, tip, r)) || congestion(anchor, tip, leaderObstacles) >= 600)) continue;
          return { ...rect, leader: extra ? [anchor, tip] : null };
        }
      }
    }
    return null;
  }

  function routeAll(nodes, links, width, height, options = {}) {
    const ports = assignPorts(nodes, links, options);
    const obstacles = nodes.map((n) => box(n, 12));
    const allExits = [...ports.values()].map((p) => p.exit);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const returnLanes = new Map(), returnCounts = new Map();
    if (options.direction) links.forEach(([a, b], edge) => {
      const source = byId.get(a), target = byId.get(b);
      if (source.group === undefined || source.group !== target.group || source.layer < target.layer) return;
      const horizontal = options.direction === 'horizontal';
      const group = nodes.filter((n) => n.group === source.group);
      const boundary = Math.min(...group.map((n) => horizontal ? n.y - n.height / 2 : n.x - n.width / 2));
      const index = returnCounts.get(source.group) || 0;
      returnCounts.set(source.group, index + 1);
      returnLanes.set(edge, { axis: horizontal ? 'y' : 'x', value: boundary - 24 - index * GAP });
    });
    // Shared visibility grid: word boundaries, dedicated ports, and separate perimeter lanes.
    const axis = (size, coordinate, low, high, rectangles, lanePoints) => [...new Set([
      ...Array.from({ length: 4 }, (_, i) => 6 + i * GAP),
      ...Array.from({ length: 4 }, (_, i) => size - 6 - i * GAP),
      ...rectangles.flatMap((r) => [r[low] - GAP, r[high] + GAP]),
      ...allExits.map((p) => p[coordinate]),
      ...[...returnLanes.values()].filter((lane) => lane.axis === coordinate).map((lane) => lane.value),
      ...lanePoints.flatMap((p) => [p[coordinate] - GAP, p[coordinate] + GAP]),
    ].filter((v) => v >= 2 && v <= size - 2))].sort((a, b) => a - b);
    function buildGrid(rectangles = obstacles, lanePoints = []) {
      const xs = axis(width, 'x', 'left', 'right', rectangles, lanePoints), ys = axis(height, 'y', 'top', 'bottom', rectangles, lanePoints);
      const points = ys.flatMap((y) => xs.map((x) => ({ x, y })));
      const adjacency = points.map(() => []);
      points.forEach((p, index) => {
        for (const [next, direction] of [[index % xs.length < xs.length - 1 ? index + 1 : -1, 1], [index + xs.length < points.length ? index + xs.length : -1, 2]]) {
          if (next < 0 || rectangles.some((r) => hitsBox(p, points[next], r))) continue;
          adjacency[index].push({ next, direction }); adjacency[next].push({ next: index, direction });
        }
      });
      return { points, adjacency, gridIndex: (p) => {
        const x = xs.indexOf(p.x), y = ys.indexOf(p.y);
        return x < 0 || y < 0 ? -1 : y * xs.length + x;
      } };
    }
    const baseGrid = buildGrid();

    function search(edge, others, hardOverlap = true, expanded = false) {
      const [a, b] = links[edge], start = ports.get(`${edge}:${a}`), end = ports.get(`${edge}:${b}`);
      const prior = others.flatMap((r) => [...segments(r.points), ...(r.label?.leader ? [r.label.leader] : [])]);
      const labels = others.filter((r) => r.label).map((r) => r.label);
      for (const [portId, port] of ports) {
        if (!portId.startsWith(`${edge}:`)) prior.push([port.anchor, port.exit]);
      }
      // A label can close a corridor on the coarse grid. Before accepting a
      // shared lane, add visibility lines around its box and existing routes.
      const { points, adjacency, gridIndex } = expanded ? buildGrid([...obstacles, ...labels], prior.flat()) : baseGrid;
      const source = gridIndex(start.exit), target = gridIndex(end.exit);
      if (source < 0 || target < 0) return null;
      const lane = returnLanes.get(edge);
      const stride = lane ? 6 : 3;
      const queue = new Heap(), costs = new Float64Array(points.length * stride).fill(Infinity), parent = new Int32Array(points.length * stride).fill(-1);
      const penaltyCache = new Map();
      const initial = source * stride + (lane && Math.abs(points[source][lane.axis] - lane.value) < 0.001 ? 3 : 0);
      costs[initial] = 0; queue.push({ state: initial, cost: 0, priority: 0 });
      let final = -1;
      while (queue.items.length) {
        const { state, cost } = queue.pop();
        if (cost > costs[state]) continue;
        const index = Math.floor(state / stride), direction = state % 3;
        const visitedLane = lane && state % stride >= 3;
        if (index === target && (!lane || visitedLane)) { final = state; break; }
        for (const move of adjacency[index]) {
          if (lane) {
            const mainAxis = lane.axis === 'y' ? 'x' : 'y';
            if (points[move.next][mainAxis] < points[index][mainAxis] &&
              (points[index][lane.axis] > lane.value || points[move.next][lane.axis] > lane.value)) continue;
          }
          if (labels.some((r) => hitsBox(points[index], points[move.next], r))) continue;
          const cacheKey = Math.min(index, move.next) * points.length + Math.max(index, move.next);
          if (!penaltyCache.has(cacheKey)) penaltyCache.set(cacheKey, congestion(points[index], points[move.next], prior, hardOverlap));
          // Keep detours available around obstacles, but prefer paths that
          // progress toward the destination. Cycle lanes intentionally return.
          const remaining = (p) => Math.abs(p.x - end.exit.x) + Math.abs(p.y - end.exit.y);
          const backward = lane ? 0 : Math.max(0, remaining(points[move.next]) - remaining(points[index]));
          const nextCost = cost + distance(points[index], points[move.next]) + backward * 4 + (direction && direction !== move.direction ? 24 : 0) + penaltyCache.get(cacheKey);
          const reachedLane = lane && (visitedLane || Math.abs(points[move.next][lane.axis] - lane.value) < 0.001);
          const nextState = move.next * stride + move.direction + (reachedLane ? 3 : 0);
          if (nextCost >= costs[nextState]) continue;
          costs[nextState] = nextCost; parent[nextState] = state;
          const p = points[move.next];
          queue.push({ state: nextState, cost: nextCost, priority: nextCost + Math.abs(p.x - end.exit.x) + Math.abs(p.y - end.exit.y) });
        }
      }
      if (final < 0) return !expanded ? search(edge, others, true, true) : hardOverlap ? search(edge, others, false, true) : null;
      const path = [];
      for (let state = final; state >= 0; state = parent[state]) path.push(points[Math.floor(state / stride)]);
      return { edge, words: links[edge], points: simplify([start.anchor, ...path.reverse(), end.anchor]) };
    }

    const order = links.map((_, i) => i).sort((i, j) => distance(byId.get(links[i][0]), byId.get(links[i][1])) - distance(byId.get(links[j][0]), byId.get(links[j][1])));
    const routes = [];
    for (const edge of order) {
      const route = search(edge, routes);
      if (route) {
        route.label = placeLabel(route, options.labelSizes?.[edge], nodes, routes, ports, width, height);
        routes.push(route);
      }
    }
    // Reconsider earlier routes with the complete web present, including shared hubs.
    for (let i = routes.length - 1; i >= 0; i--) {
      const others = routes.filter((_, index) => index !== i);
      const candidate = search(routes[i].edge, others);
      const prior = others.flatMap((r) => segments(r.points));
      const score = (r) => segments(r.points).reduce((sum, [a, b]) => sum + distance(a, b) + congestion(a, b, prior, false), r.points.length * 24);
      if (candidate) {
        candidate.label = placeLabel(candidate, options.labelSizes?.[candidate.edge], nodes, others, ports, width, height);
        const wasShared = segments(routes[i].points).some(([a, b]) => congestion(a, b, prior) === Infinity);
        const nowShared = segments(candidate.points).some(([a, b]) => congestion(a, b, prior) === Infinity);
        if ((!routes[i].label || candidate.label) && ((!nowShared && wasShared) || (nowShared === wasShared && score(candidate) < score(routes[i])))) routes[i] = candidate;
      }
    }
    return routes.sort((a, b) => a.edge - b.edge);
  }

  const api = { themedLayout, serpentineLayout, layoutProblems, flowLayout, optimize, separateWords, routeAll, assignPorts, hasSharedLanes, intersects, hitsBox, box, segments, congestion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WebLayout = api;
})(globalThis);
