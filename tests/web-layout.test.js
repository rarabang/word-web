const assert = require('node:assert/strict');
const { test } = require('node:test');
const geometry = require('../web-layout.js');
const node = (id, x, y, width = 110, height = 42) => ({ id, x, y, width, height });

test('ports face aligned destinations even when the layout flows across them', () => {
  for (const direction of ['horizontal', 'vertical']) {
    const horizontal = direction === 'horizontal';
    const nodes = [node('a', 150, 150), node('b', horizontal ? 150 : 500, horizontal ? 500 : 150)];
    const ports = geometry.assignPorts(nodes, [['a', 'b']], { direction });
    const source = ports.get('0:a'), target = ports.get('0:b');
    const axis = horizontal ? 'y' : 'x';
    assert.ok(source.exit[axis] > source.anchor[axis]);
    assert.ok(target.exit[axis] < target.anchor[axis]);
    const routes = geometry.routeAll(nodes, [['a', 'b']], 700, 700, { direction });
    assert.equal(routes.length, 1);
    const points = routes[0].points;
    assert.ok(points.every((p, i) => !i || p[axis] >= points[i - 1][axis]), 'a clear route never doubles back');
  }
});

test('oversized and coincident pills get clearance even when the canvas is full', () => {
  const nodes = Array.from({ length: 24 }, (_, i) => node(`w${i}`, 40, 40, 720 + i * 3, 40 + (i % 4) * 12));
  const original = JSON.stringify(nodes);
  const layout = geometry.separateWords(nodes, 248, 160);
  assert.equal(JSON.stringify(nodes), original, 'placement leaves its input untouched');
  assert.equal(layout.nodes.length, nodes.length);
  assert.ok(layout.width > 248 && layout.height > 160, 'canvas grows to fit the pills');
  for (const [i, a] of layout.nodes.entries()) {
    assert.ok(a.x - a.width / 2 >= 38 && a.x + a.width / 2 <= layout.width - 38);
    assert.ok(a.y - a.height / 2 >= 38 && a.y + a.height / 2 <= layout.height - 38);
    for (const b of layout.nodes.slice(i + 1)) {
      assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + 48 ||
        Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + 48, 'every pill has clearance');
    }
  }
});

test('final pill placement preserves an already clear web', () => {
  const nodes = [node('a', 150, 150), node('b', 500, 150), node('c', 350, 350)];
  assert.deepEqual(geometry.separateWords(nodes, 800, 600), { nodes, width: 800, height: 600 });
});

test('layer ordering removes branch crossings without breaking alignment', () => {
  const nodes = ['hub', 'a', 'b', 'c', 'd', 'u', 'v'].map((id) => node(id, 0, 0, id === 'u' ? 420 : 110));
  const links = [['hub', 'a'], ['hub', 'b'], ['hub', 'c'], ['hub', 'd'], ['a', 'u'], ['c', 'u'], ['a', 'v'], ['b', 'v']];
  const original = JSON.stringify(nodes);
  for (const direction of ['horizontal', 'vertical']) {
    const layout = geometry.flowLayout(nodes, links, 248, 420, { direction });
    assert.equal(JSON.stringify(nodes), original);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const main = direction === 'horizontal' ? 'x' : 'y';
    const peers = ['a', 'b', 'c', 'd'].map((id) => byId.get(id));
    assert.ok(peers.every((n) => n[main] === peers[0][main]), 'peers stay in the same layer');
    const branches = links.slice(4).map(([a, b]) => [byId.get(a), byId.get(b)]);
    for (const [i, [a, b]] of branches.entries()) for (const [c, d] of branches.slice(i + 1)) {
      assert.ok(!geometry.intersects(a, b, c, d), 'branches line up without crossings');
    }
    assert.ok(layout.width > 248, 'the canvas grows to fit long words');
    for (const [i, a] of layout.nodes.entries()) for (const b of layout.nodes.slice(i + 1)) {
      assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + 48 ||
        Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + 48, 'layered words have clearance');
    }
  }
});

test('a remote busy group and long label do not widen a simple connection', () => {
  const simple = [node('a', 0, 0), node('b', 0, 0)];
  const basic = geometry.flowLayout(simple, [['a', 'b']], 812, 520);
  const nodes = [...simple, node('hub', 0, 0, 180, 80), ...Array.from({ length: 9 }, (_, i) => node(`leaf${i}`, 0, 0))];
  const links = [['a', 'b'], ...nodes.slice(3).map((n) => ['hub', n.id])];
  const labelSizes = links.map((_, i) => i ? { width: 500, height: 20 } : null);
  const layout = geometry.flowLayout(nodes, links, 812, 520, { labelSizes });
  const span = (result) => result.nodes.find((n) => n.id === 'b').x - result.nodes.find((n) => n.id === 'a').x;
  assert.equal(span(layout), span(basic), 'local gaps ignore unrelated degree and label sizes');
  for (const [i, a] of layout.nodes.entries()) for (const b of layout.nodes.slice(i + 1)) {
    assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + 48 - 1e-6 ||
      Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + 48 - 1e-6, 'packed groups retain word clearance');
  }
});

test('expanding one congested channel preserves the spacing in another group', () => {
  const nodes = ['a', 'b', 'c', 'd'].map((id) => node(id, 0, 0));
  const links = [['a', 'b'], ['c', 'd']];
  const compact = geometry.flowLayout(nodes, links, 812, 520);
  const expanded = geometry.flowLayout(nodes, links, 812, 520, { expansions: new Map([['a:channel:0', 2]]) });
  const gap = (layout, a, b) => layout.nodes.find((n) => n.id === b).x - layout.nodes.find((n) => n.id === a).x;
  assert.ok(gap(expanded, 'a', 'b') > gap(compact, 'a', 'b'));
  assert.equal(gap(expanded, 'c', 'd'), gap(compact, 'c', 'd'));
});

function validateRoutes(nodes, links, width, height) {
  const routes = geometry.routeAll(nodes, links, width, height);
  assert.equal(routes.length, links.length, 'every link must remain visible');
  for (const route of routes) {
    for (const point of route.points) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert.ok(point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height, 'route stays on board');
    }
    for (const [a, b] of geometry.segments(route.points)) {
      for (const n of nodes.filter((n) => !route.words.includes(n.id))) {
        assert.ok(!geometry.hitsBox(a, b, geometry.box(n, 3)), 'links leave unrelated labels clear');
      }
    }
  }
  // The old router exempted shared hubs. Check all route pairs, including those.
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    for (const [a, b] of geometry.segments(routes[i].points)) for (const [c, d] of geometry.segments(routes[j].points)) {
      assert.notEqual(geometry.congestion(a, b, [[c, d]]), Infinity, 'links cannot share the same lane');
    }
  }
  return routes;
}

test('moves a crossed pair of independent connections into a clearer layout', () => {
  const nodes = [node('a', 180, 150), node('b', 620, 470), node('c', 180, 470), node('d', 620, 150)];
  const links = [['a', 'b'], ['c', 'd']];
  assert.ok(geometry.intersects(...nodes));
  const moved = geometry.optimize(nodes, links, 800, 620);
  assert.ok(!geometry.intersects(...moved));
  validateRoutes(moved, links, 800, 620);
});

test('a busy hub has separate ports and routes for every spoke', () => {
  const hub = node('hub', 440, 350, 160, 68);
  const nodes = [hub, ...Array.from({ length: 7 }, (_, i) => node(`w${i}`, 440 + Math.cos(i * Math.PI * 2 / 7) * 290, 350 + Math.sin(i * Math.PI * 2 / 7) * 230))];
  const links = nodes.slice(1).map((n) => ['hub', n.id]);
  const ports = geometry.assignPorts(nodes, links);
  const anchors = links.map((_, i) => ports.get(`${i}:hub`).anchor);
  assert.equal(new Set(anchors.map((p) => `${p.x},${p.y}`)).size, links.length);
  validateRoutes(nodes, links, 880, 700);
});

test('routes around an intervening word and keeps nearby links separate', () => {
  const nodes = [node('a', 110, 260), node('b', 690, 260), node('obstacle', 400, 260, 150), node('c', 110, 420), node('d', 690, 420)];
  validateRoutes(nodes, [['a', 'b'], ['a', 'd'], ['c', 'b']], 800, 600);
});

test('dense web retains every link without overlapping labels or lanes', () => {
  const nodes = Array.from({ length: 8 }, (_, i) => node(`w${i}`, 700 + Math.cos(i * Math.PI / 4) * 450, 520 + Math.sin(i * Math.PI / 4) * 350, 160, 68));
  const links = nodes.flatMap((a, i) => nodes.slice(i + 1).map((b) => [a.id, b.id]));
  const moved = geometry.optimize(nodes, links, 1400, 1040);
  for (const a of moved) for (const b of moved) {
    if (a === b) continue;
    assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2, 'labels do not overlap');
  }
  validateRoutes(moved, links, 1400, 1040);
});

test('directed layers put converging sources before their destination in both orientations', () => {
  // Destination first in the word list and highest degree: neither should make it a source.
  const nodes = ['soil', 'rain', 'forest', 'root', 'seed', 'leaf'].map((id) => node(id, 0, 0));
  const links = [['rain', 'soil'], ['forest', 'soil'], ['root', 'soil'], ['soil', 'seed'], ['seed', 'leaf']];
  for (const direction of ['horizontal', 'vertical']) {
    const layout = geometry.flowLayout(nodes, links, 800, 600, { direction });
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const axis = direction === 'horizontal' ? 'x' : 'y';
    for (const [a, b] of links) assert.ok(byId.get(a)[axis] < byId.get(b)[axis], `${a} precedes ${b}`);
    assert.equal(byId.get('rain')[axis], byId.get('forest')[axis]);
  }
});

test('cycle arrows retain their direction and visit a lane outside the group', () => {
  const nodes = ['a', 'b', 'c'].map((id) => node(id, 0, 0));
  const links = [['a', 'b'], ['b', 'c'], ['c', 'a']];
  for (const direction of ['horizontal', 'vertical']) {
    const layout = geometry.flowLayout(nodes, links, 800, 600, { direction });
    const routes = geometry.routeAll(layout.nodes, links, layout.width, layout.height, { direction });
    assert.equal(routes.length, links.length);
    const returning = routes.find((r) => r.words[0] === 'c');
    const horizontal = direction === 'horizontal';
    const boundary = Math.min(...layout.nodes.map((n) => horizontal ? n.y - n.height / 2 : n.x - n.width / 2));
    assert.ok(returning.points.some((p) => p[horizontal ? 'y' : 'x'] <= boundary - 24));
    for (const route of routes) {
      const target = layout.nodes.find((n) => n.id === route.words[1]);
      assert.ok(Math.abs(route.points.at(-1).x - target.x) <= target.width / 2);
      assert.ok(Math.abs(route.points.at(-1).y - target.y) <= target.height / 2);
    }
  }
});


test('uneven branches align their parent with the shortest combined travel', () => {
  for (const direction of ['horizontal', 'vertical']) {
    const horizontal = direction === 'horizontal';
    const nodes = ['hub', 'a', 'b', 'c'].map((id) => node(id, 0, 0,
      id === 'c' && !horizontal ? 240 : 110, id === 'c' && horizontal ? 180 : 42));
    const links = [['hub', 'a'], ['hub', 'b'], ['hub', 'c']];
    const layout = geometry.flowLayout(nodes, links, 812, 520, { direction });
    const axis = horizontal ? 'y' : 'x';
    const parent = layout.nodes.find((n) => n.id === 'hub')[axis];
    const peers = layout.nodes.filter((n) => n.id !== 'hub').map((n) => n[axis]).sort((a, b) => a - b);
    const travel = peers.reduce((sum, value) => sum + Math.abs(parent - value), 0);
    assert.ok(Math.abs(travel - (peers[2] - peers[0])) < 0.001,
      'parent achieves the minimum travel to three fixed child positions');
    validateRoutes(layout.nodes, links, layout.width, layout.height);
  }
});

test('a busy branch reserves extra room only beside its immediate peers', () => {
  const peers = ['a', 'b', 'c', 'd', 'e'];
  const leaves = Array.from({ length: 10 }, (_, i) => `leaf${i}`);
  const nodes = ['hub', ...peers, ...leaves].map((id) => node(id, 0, 0));
  const links = [...peers.map((id) => ['hub', id]), ...leaves.map((id) => ['a', id])];
  const layout = geometry.flowLayout(nodes, links, 812, 520);
  const layer = layout.nodes.filter((n) => peers.includes(n.id)).sort((a, b) => a.y - b.y);
  const gaps = layer.slice(1).map((n, i) => ({
    busy: n.id === 'a' || layer[i].id === 'a',
    clearance: n.y - layer[i].y - (n.height + layer[i].height) / 2,
  }));
  assert.ok(gaps.some((gap) => !gap.busy), 'fixture includes quiet adjacent peers');
  assert.ok(gaps.filter((gap) => !gap.busy).every((gap) => Math.abs(gap.clearance - 48) < 0.001));
  assert.ok(gaps.filter((gap) => gap.busy).every((gap) => gap.clearance > 48));
});


test('serpentine chains fit both viewports with safe labels and ordered endpoints', () => {
  const nodes = Array.from({ length: 12 }, (_, i) => node(`term${i}`, 0, 0, 180 + (i % 3) * 15, 48));
  const links = nodes.slice(1).map((n, i) => [nodes[i].id, n.id]);
  const labelSizes = links.map(() => ({ width: 94, height: 34 }));
  for (const [width, height] of [[812, 520], [248, 420]]) {
    const layout = geometry.serpentineLayout([...nodes].reverse(), links, width, height, { labelSizes });
    const routes = geometry.routeAll(layout.nodes, links, layout.width, layout.height, { labelSizes });
    assert.deepEqual(geometry.layoutProblems(layout.nodes, links, routes, { labelSizes }), []);
    assert.equal(new Set(layout.nodes.map(n => n.id)).size, nodes.length);
    assert.ok(new Set(layout.nodes.map(n => n.y)).size > 1, 'chain folds into multiple rows');
    assert.ok(routes.some(r => r.points[0].x > r.points.at(-1).x), 'alternating row keeps backwards arrows pointing to the destination');
  }
  assert.equal(geometry.serpentineLayout(nodes, [...links, ['term0', 'term5']], 812, 520), null);
  assert.equal(geometry.serpentineLayout(nodes, [...links, ['term11', 'term0']], 812, 520), null);
});


test('graph themes preserve words, directed links, clearance and labels at both viewport sizes', () => {
  const nodes = ['hub', 'a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id, 0, 0, 130, 42));
  const original = JSON.stringify(nodes);
  for (const type of ['radial', 'circular', 'clustered', 'anatomical']) {
    const links = type === 'circular' ? nodes.map((n, i) => [n.id, nodes[(i + 1) % nodes.length].id])
      : type === 'anatomical' ? [['hub', 'a'], ['a', 'b'], ['b', 'c'], ['b', 'd'], ['c', 'e'], ['c', 'f']]
      : nodes.slice(1).map((n) => ['hub', n.id]);
    const labelSizes = links.map(() => ({ width: 80, height: 20 }));
    for (const width of [812, 248]) {
      const layout = geometry.themedLayout(type, nodes, links, width, 520, { labelSizes });
      assert.equal(layout.type, type);
      assert.equal(JSON.stringify(nodes), original, 'shape generation leaves input measurements untouched');
      assert.equal(new Set(layout.nodes.map(n => n.id)).size, nodes.length);
      const routes = geometry.routeAll(layout.nodes, links, layout.width, layout.height, { labelSizes });
      assert.deepEqual(geometry.layoutProblems(layout.nodes, links, routes, { labelSizes }), [], `${type} at ${width}`);
    }
  }
  assert.equal(geometry.themedLayout('unknown', nodes, [['hub', 'a']], 812, 520), null);
  assert.equal(geometry.themedLayout('radial', nodes, [], 812, 520), null);
});
