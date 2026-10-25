const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const WebLayout = require('../web-layout.js');

// A small DOM fixture exercises the real game event handlers and sizing logic.
// Geometry tests cover the actual routing; this does not replace browser rendering.
function game(viewportWidth = 812, { authoredPuzzles = false, storage = new Map() } = {}) {
  const elements = new Map();
  class Element {
    constructor(id = '') { this.id = id; this.children = []; this.style = {}; this.dataset = {}; this.handlers = {}; this.attributes = {}; this.classList = { toggle() {}, add() {} }; }
    get clientWidth() { return this.id === 'board-viewport' ? viewportWidth : this.id === 'word-board' ? elements.get('board-wrap').clientWidth : parseFloat(this.style.width) || viewportWidth; }
    get clientHeight() { return this.id === 'board-viewport' ? (viewportWidth < 600 ? 420 : 520) : this.id === 'word-board' ? elements.get('board-wrap').clientHeight : parseFloat(this.style.height) || 420; }
    get offsetWidth() { return Math.max((this.textContent || '').length * 7 + 34, parseFloat(this.style.minWidth) || 0); }
    get offsetHeight() { return Math.max(40, parseFloat(this.style.minHeight) || 0); }
    getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight, left: 0, top: 0 }; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    querySelectorAll(selector) { return selector === '.connection-label' ? this.children.filter(child => child.attributes.tabindex === '0') : this.children; }
    setAttribute(k, v) { this.attributes[k] = v; }
    addEventListener(k, f) { this.handlers[k] = f; }
    showModal() { this.open = true; }
    showPopover() { this.open = true; }
    hidePopover() { this.open = false; }
    close() { this.open = false; this.handlers.close?.(); }
    focus() { this.focused = true; }
    setPointerCapture(id) { this.pointer = id; }
    hasPointerCapture(id) { return this.pointer === id; }
    releasePointerCapture() { this.pointer = null; }
    closest(selector) { return selector === '.word-node' && this.dataset.word ? this : null; }
  }
  const document = { querySelector(selector) { const id = selector.slice(1); if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); }, createElement() { return new Element(); }, createElementNS() { return new Element(); } };
  let seed = 42;
  const math = Object.create(Math);
  math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const context = vm.createContext({ Math: math, document, WebLayout, window: { innerWidth: 1200, innerHeight: 800, localStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } }, setTimeout() { return 1; }, clearTimeout() {}, handlers: {}, addEventListener(k, f) { this.handlers[k] = f; } }, Intl, Date, cancelAnimationFrame() {}, requestAnimationFrame(f) { f(); } });
  if (authoredPuzzles) {
    vm.runInContext(fs.readFileSync(require.resolve('../puzzles.js'), 'utf8'), context);
    context.WORD_WEB_PUZZLES = context.window.WORD_WEB_PUZZLES;
  }
  vm.runInContext(fs.readFileSync(require.resolve('../game.js'), 'utf8'), context);
  return { run: (code) => vm.runInContext(code, context), elements, document, resize: (width) => { viewportWidth = width; vm.runInContext('update(true)', context); } };
}

test('existing connectors can be edited, cancelled, and activated with the keyboard', () => {
  const app = game(812, { authoredPuzzles: true });
  app.run('chooseWord(puzzle.words[0]); chooseWord(puzzle.words[1])');
  const original = app.run('JSON.stringify(connections[0])');
  const label = () => app.elements.get('connections').children.find(child => child.attributes.role === 'button');
  label().handlers.click({ stopPropagation() {} });
  const menu = app.elements.get('connector-menu');
  assert.equal(menu.open, true);
  assert.equal(menu.children[0].attributes['aria-selected'], 'true');
  assert.equal(menu.children.length, app.run('puzzleLabels().length'));
  assert.equal(menu.children[0].focused, true);
  menu.handlers.keydown({ key: 'ArrowDown', target: menu.children[0], preventDefault() {}, stopPropagation() {} });
  assert.equal(menu.children[1].focused, true);
  menu.handlers.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(menu.open, false);
  assert.equal(app.run('JSON.stringify(connections[0])'), original);
  label().handlers.keydown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
  menu.children[1].handlers.click();
  assert.equal(menu.open, false);
  assert.equal(app.run('connections.length'), 1);
  assert.deepEqual(JSON.parse(app.run('JSON.stringify(connections[0].slice(0, 2))')), JSON.parse(original).slice(0, 2));
  assert.equal(app.run('connections[0][2]'), app.run('puzzleLabels()[1]'));
  label().handlers.click({ stopPropagation() {} });
  menu.handlers.toggle({ newState: 'closed' });
  assert.equal(app.run('editingConnection'), null);
  assert.equal(label().attributes['aria-expanded'], 'false');
  assert.equal(label().focused, true);
  app.run('checked = true; update()');
  assert.equal(label(), undefined, 'checked connections cannot be edited');
});

test('word dragging connects in source order, toggles links, and suppresses the release click', () => {
  const app = game(812, { authoredPuzzles: true });
  const [source, target] = app.elements.get('word-board').children;
  app.document.elementFromPoint = () => target;
  const event = { button: 0, pointerId: 9, clientX: 10, clientY: 10, preventDefault() {} };
  const drag = () => {
    source.handlers.pointerdown(event);
    source.handlers.pointermove({ ...event, clientX: 80 });
    assert.equal(app.elements.get('connection-drag-preview').style.display, 'block');
    source.handlers.pointerup({ ...event, clientX: 80 });
    source.handlers.click({ detail: 1 });
  };
  app.run('selected = puzzle.words[2]');
  drag();
  assert.equal(app.run('connections[0][0]'), source.dataset.word);
  assert.equal(app.run('connections[0][1]'), target.dataset.word);
  assert.equal(app.run('connections[0][2]'), app.run('selectedLabel'));
  assert.equal(app.run('selected'), null);
  assert.equal(app.elements.get('connection-drag-preview').style.display, 'none');
  drag();
  assert.equal(app.run('connections.length'), 0);
});

test('word drag cancellation, empty drops, taps, and checked boards do not add links', () => {
  const app = game();
  const source = app.elements.get('word-board').children[0];
  const event = { button: 0, pointerId: 3, clientX: 0, clientY: 0, preventDefault() {} };
  app.document.elementFromPoint = () => null;
  for (const end of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    source.handlers.pointerdown(event);
    source.handlers.pointermove({ ...event, clientX: 80 });
    source.handlers[end](event);
    assert.equal(app.run('wordGesture'), null);
    assert.equal(app.run('connections.length'), 0);
  }
  source.handlers.pointerdown(event);
  source.handlers.pointerup(event);
  source.handlers.click({ detail: 1 });
  assert.equal(app.run('selected'), source.dataset.word, 'a tap keeps ordinary word selection');
  app.run('checked = true');
  source.handlers.pointerdown(event);
  assert.equal(app.run('wordGesture'), null);
});

test('dense gameplay expands the board, draws every link, then resets cleanly', () => {
  const app = game();
  app.run("connections = puzzle.words.flatMap((a,i) => puzzle.words.slice(i+1).map(b => [a,b])); arrangeWeb(); update(true)");
  assert.equal(app.run('cachedRoutes.length'), 28);
  assert.ok(app.elements.get('board-wrap').clientWidth > 812);
  assert.ok(app.elements.get('board-wrap').clientHeight > 660);
  assert.ok(app.run('camera.scale < 1'));
  assert.ok(app.run('camera.x + contentBounds().left * camera.scale >= 11.999 && camera.y + contentBounds().top * camera.scale >= 11.999 && camera.x + contentBounds().right * camera.scale <= viewport.clientWidth - 11.999 && camera.y + contentBounds().bottom * camera.scale <= viewport.clientHeight - 11.999'));
  assert.ok(app.run("[...svg.children].every(p => !/NaN|Infinity/.test(p.attributes.d))"));
  app.elements.get('reset-button').handlers.click();
  assert.equal(app.run('connections.length'), 0);
  assert.equal(app.run('cachedRoutes.length'), 0);
  assert.equal(app.elements.get('board-wrap').clientWidth, 812);
});

test('adding/removing links and resizing keep routes synchronized', () => {
  const app = game(280);
  app.run("chooseWord('forest'); chooseWord('root'); chooseWord('root'); chooseWord('soil')");
  assert.equal(app.run('cachedRoutes.length'), 2);
  app.resize(1100);
  assert.equal(app.run('cachedRoutes.length'), 2);
  app.run("chooseWord('forest'); chooseWord('root')");
  assert.equal(app.run('cachedRoutes.length'), 1);
});


test('narrow starting board gives every word enough room', () => {
  const app = game(248);
  assert.ok(app.elements.get('board-wrap').clientHeight > 420);
  const overlap = app.run(`(() => {
    const nodes = measureNodes();
    return nodes.some((a, i) => nodes.slice(i + 1).some(b => Math.abs(a.x-b.x) < (a.width+b.width)/2 && Math.abs(a.y-b.y) < (a.height+b.height)/2));
  })()`);
  assert.equal(overlap, false);
});

test('authored puzzle pills retain clearance through linking, resizing, and resetting', () => {
  const app = game(248, { authoredPuzzles: true });
  function assertClearance() {
    const nodes = app.run('measureNodes()');
    const wrap = app.elements.get('board-wrap');
    for (const [i, a] of nodes.entries()) {
      assert.ok(a.x - a.width / 2 >= 38 - 1e-6 && a.x + a.width / 2 <= wrap.clientWidth - 38 + 1e-6, `${a.id} fits horizontally`);
      assert.ok(a.y - a.height / 2 >= 38 - 1e-6 && a.y + a.height / 2 <= wrap.clientHeight - 38 + 1e-6, `${a.id} fits vertically`);
      for (const b of nodes.slice(i + 1)) {
        assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + 48 - 1e-6 ||
          Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + 48 - 1e-6,
        `${a.id} and ${b.id} have pill clearance`);
      }
    }
  }
  for (let index = 0; index < app.run('puzzles.length'); index++) {
    app.run(`changePuzzle(${index})`);
    assertClearance();
    app.run('connections = puzzle.links.slice(0, 3).map(link => [...linkWords(link), (linkLabels(link)[0] || null)]); arrangeWeb(); update(true)');
    assertClearance();
    app.resize(812);
    assertClearance();
    app.resize(248);
    assertClearance();
    app.elements.get('reset-button').handlers.click();
    assertClearance();
  }
});

test('linked groups start with pill clearance before collision correction', () => {
  const app = game(248);
  for (const links of [
    [['forest', 'root'], ['soil', 'river']],
    [['forest', 'root'], ['forest', 'soil'], ['forest', 'river'], ['forest', 'rain']],
    [['forest', 'root'], ['root', 'soil'], ['soil', 'forest']],
  ]) {
    app.run(`connections = ${JSON.stringify(links)}; expandBoard(); arrangeWeb()`);
    const nodes = app.run('measureNodes().filter(node => connections.some(pair => pair.includes(node.id)))');
    for (const [i, a] of nodes.entries()) for (const b of nodes.slice(i + 1)) {
      assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + 48 - 1e-6 ||
        Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + 48 - 1e-6, `${a.id} and ${b.id} start spaced apart`);
    }
  }
});

test('large linked groups keep long pills spaced without relying on collision correction', () => {
  const app = game(248, { authoredPuzzles: true });
  app.run(`
    changePuzzle(2);
    connections = puzzle.words.slice(1).map((word, index) => [puzzle.words[index], word]);
    expandBoard();
    arrangeWeb();
  `);
  const nodes = app.run('measureNodes()');
  const wrap = app.elements.get('board-wrap');
  for (const [i, a] of nodes.entries()) {
    assert.ok(a.x - a.width / 2 >= 38 - 1e-6 && a.x + a.width / 2 <= wrap.clientWidth - 38 + 1e-6);
    assert.ok(a.y - a.height / 2 >= 38 - 1e-6 && a.y + a.height / 2 <= wrap.clientHeight - 38 + 1e-6);
    for (const b of nodes.slice(i + 1)) {
      assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + 48 - 1e-6 ||
        Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + 48 - 1e-6, `${a.id} and ${b.id} have clearance`);
    }
  }
});

test('incrementally building a dense web preserves all routes and distinct lanes', () => {
  const app = game();
  app.run(`
    const pairsToAdd = puzzle.words.flatMap((a, i) => puzzle.words.slice(i+1).map(b => [a,b]));
    for (const [a,b] of pairsToAdd) {
      chooseWord(a); chooseWord(b);
      if (cachedRoutes.length !== connections.length) throw new Error('A link disappeared');
      for (let i = 0; i < cachedRoutes.length; i++) for (let j = i+1; j < cachedRoutes.length; j++) {
        const prior = WebLayout.segments(cachedRoutes[j].points);
        for (const [p,q] of WebLayout.segments(cachedRoutes[i].points)) {
          if (WebLayout.congestion(p,q,prior) === Infinity) throw new Error('Links share a lane after adding ' + connections.length + ' links');
        }
      }
    }
  `);
  assert.equal(app.run('cachedRoutes.length'), 28);
});


test('zoom and pan preserve routes; fit and layout changes restore full visibility', () => {
  const app = game(280);
  app.run("connections = puzzle.words.flatMap((a,i) => puzzle.words.slice(i+1).map(b => [a,b])); arrangeWeb(); update(true)");
  const fitted = app.run('camera.scale');
  const routes = app.run('JSON.stringify(cachedRoutes)');
  app.elements.get('zoom-in').handlers.click();
  assert.ok(app.run('camera.scale') > fitted);
  assert.equal(app.run('JSON.stringify(cachedRoutes)'), routes);
  const viewport = app.elements.get('board-viewport');
  const before = app.run('camera.x');
  viewport.handlers.pointerdown({ target: viewport, button: 0, pointerId: 1, clientX: 100, clientY: 100, preventDefault() {} });
  viewport.handlers.pointermove({ pointerId: 1, clientX: 60, clientY: 100 });
  assert.ok(app.run('camera.x') < before);
  viewport.handlers.pointerup({ pointerId: 1 });
  assert.equal(app.run('panGesture'), null);
  app.elements.get('fit-view').handlers.click();
  assert.equal(app.run('camera.scale'), fitted);
  assert.equal(app.run('camera.zoom'), 1);
  app.run('zoomView(2)');
  app.run("chooseWord('forest')");
  assert.equal(app.run('camera.zoom'), 2, 'selecting a word keeps the closer view');
  app.run("chooseWord('root')");
  assert.equal(app.run('camera.zoom'), 1, 'changing links fits the rearranged web');
  app.run('zoomView(2)');
  app.resize(900);
  assert.equal(app.run('camera.zoom'), 1);
  assert.ok(app.run('camera.x + contentBounds().left * camera.scale >= 11.999 && camera.y + contentBounds().top * camera.scale >= 11.999 && camera.x + contentBounds().right * camera.scale <= viewport.clientWidth - 11.999 && camera.y + contentBounds().bottom * camera.scale <= viewport.clientHeight - 11.999'));
});

test('keyboard controls zoom, pan within bounds, and fit the view', () => {
  const app = game(280);
  const viewport = app.elements.get('board-viewport');
  const press = (key) => viewport.handlers.keydown({ target: viewport, key, preventDefault() {} });
  press('+');
  assert.ok(app.run('camera.zoom') > 1);
  for (let i = 0; i < 40; i++) press('ArrowDown');
  assert.ok(app.run('camera.y >= viewport.clientHeight - contentBounds().bottom * camera.scale - 12'));
  press('Home');
  assert.equal(app.run('camera.zoom'), 1);
  for (let i = 0; i < 40; i++) press('-');
  assert.equal(app.run('camera.zoom'), 1);
});


test('fit zooms to content rather than empty board, including outlying link paths', () => {
  const app = game();
  app.run(`
    puzzle.words.forEach((word, i) => positions.set(word, [42 + (i % 4) * 5, 43 + Math.floor(i / 4) * 14]));
    cachedRoutes = [{ words: ['forest', 'root'], points: [{x: 260, y: 160}, {x: 650, y: 100}, {x: 600, y: 230}] }];
    fitView();
  `);
  assert.ok(app.run('camera.scale > 1'), 'small webs can be enlarged past 100%');
  const bounds = app.run('contentBounds()');
  const scale = app.run('camera.scale');
  const viewport = app.elements.get('board-viewport');
  assert.ok(Math.abs(Math.max((bounds.right - bounds.left) * scale / (viewport.clientWidth - 24), (bounds.bottom - bounds.top) * scale / (viewport.clientHeight - 24)) - 1) < 1e-9, 'one dimension uses all available space');
  assert.ok(app.run('camera.x + contentBounds().left * camera.scale >= 11.999 && camera.y + contentBounds().top * camera.scale >= 11.999 && camera.x + contentBounds().right * camera.scale <= viewport.clientWidth - 11.999 && camera.y + contentBounds().bottom * camera.scale <= viewport.clientHeight - 11.999'));
});

test('full authored webs keep all labels and routes clear of words in both orientations', () => {
  const app = game(248, { authoredPuzzles: true });
  for (let puzzleIndex = 0; puzzleIndex < app.run('puzzles.length'); puzzleIndex++) {
    app.run(`changePuzzle(${puzzleIndex}); connections = puzzle.links.map(link => [...linkWords(link), (linkLabels(link)[0] || null)]);`);
    for (const width of [248, 812]) {
      app.resize(width);
      const nodes = app.run('measureNodes()'), routes = app.run('cachedRoutes');
      const name = app.run('puzzle.title');
      assert.equal(routes.length, app.run('connections.length'), `${name}: every route is drawn`);
      assert.equal(app.elements.get('connections').children.filter((el) => el.textContent).length, routes.length, `${name}: every label is rendered`);
      for (const route of routes) {
        assert.ok(route.label, `${name}: every connector has a clear label position`);
        const lines = WebLayout.segments(route.points);
        lines.forEach(([a, b], index) => {
          for (const n of nodes) {
            if ((index === 0 && n.id === route.words[0]) || (index === lines.length - 1 && n.id === route.words[1])) continue;
            assert.ok(!WebLayout.hitsBox(a, b, WebLayout.box(n, 10)), `${name}: route leaves ${n.id} clear`);
          }
        });
        const r = route.label;
        for (const n of nodes) {
          const b = WebLayout.box(n, 10);
          assert.ok(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom, `${name}: label avoids ${n.id}`);
        }
        for (const other of routes) {
          for (const [a, b] of WebLayout.segments(other.points)) assert.ok(!WebLayout.hitsBox(a, b, r), `${name}: routes avoid label boxes`);
          if (route === other) continue;
          const b = other.label;
          assert.ok(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom, `${name}: connector labels do not overlap`);
        }
      }
      assert.ok(app.run('camera.x + contentBounds().left * camera.scale >= 11.999 && camera.y + contentBounds().top * camera.scale >= 11.999 && camera.x + contentBounds().right * camera.scale <= viewport.clientWidth - 11.999 && camera.y + contentBounds().bottom * camera.scale <= viewport.clientHeight - 11.999'), 'fit includes the label bounds');
    }
  }
});

test('game updates and rotation preserve aligned flowchart layers', () => {
  const app = game(248);
  app.run("connections = [['forest','root'],['forest','soil'],['forest','river'],['root','rain'],['soil','seed']]; update(true)");
  for (const width of [248, 812, 248]) {
    app.resize(width);
    const nodes = new Map(app.run('measureNodes()').map((n) => [n.id, n]));
    const axis = width < 500 ? 'y' : 'x';
    assert.ok(Math.abs(nodes.get('root')[axis] - nodes.get('soil')[axis]) < 1e-6);
    assert.ok(Math.abs(nodes.get('root')[axis] - nodes.get('river')[axis]) < 1e-6);
    assert.ok(Math.abs(nodes.get('rain')[axis] - nodes.get('seed')[axis]) < 1e-6);
    assert.ok(nodes.get('forest')[axis] < nodes.get('root')[axis]);
    assert.ok(nodes.get('root')[axis] < nodes.get('rain')[axis]);
  }
});

test('dense labeled webs gain room instead of sharing lanes or losing labels', () => {
  const app = game(248, { authoredPuzzles: true });
  app.run("connections = puzzle.words.slice(0, 8).flatMap((a, i, words) => words.slice(i + 1).map(b => [a, b, 'nourishes']));");
  for (const width of [248, 812]) {
    app.resize(width);
    const routes = app.run('cachedRoutes');
    assert.equal(routes.length, 28);
    assert.ok(routes.every((route) => route.label), 'all connector labels remain visible');
    assert.equal(WebLayout.hasSharedLanes(routes), false, 'routes have distinct lanes');
    for (const route of routes) for (const other of routes) {
      for (const [a, b] of WebLayout.segments(other.points)) assert.ok(!WebLayout.hitsBox(a, b, route.label), 'routes leave labels clear');
    }
  }
});

test('source selection previews direction and rendered arrows point to the selected destination', () => {
  const app = game(812, { authoredPuzzles: true });
  app.run("selectedLabel = 'nourishes'; chooseWord('rain')");
  assert.equal(app.elements.get('label-status').textContent, 'rain nourishes → choose a destination');
  app.run("chooseWord('soil')");
  assert.equal(app.run("connections[0].join('|')"), 'rain|soil|nourishes');
  assert.equal(app.run("cachedRoutes[0].words.slice(0, 2).join('|')"), 'rain|soil');
  assert.equal(app.run('WebLayout.layoutProblems(measureNodes(), connections, cachedRoutes, {labelSizes}).length'), 0);
  const lines = () => app.elements.get('connections').children.filter((el) => el.attributes['marker-end']);
  assert.equal(lines().length, 1);
  assert.equal(lines()[0].attributes['marker-end'], 'url(#arrow)');
  app.elements.get('check-button').handlers.click();
  assert.equal(lines()[0].attributes['marker-end'], 'url(#arrow-correct)');
  app.run('layoutMode = "flowchart"; update(true)');
  assert.ok(app.run("flowNodes.get('rain').x < flowNodes.get('soil').x"), 'flowchart retains its directed layer order');
  assert.equal(lines()[0].attributes['marker-end'], 'url(#arrow-correct)');
});

function pressConnectorKey(app, key, options = '{}') {
  return app.run(`(() => {
    const event = { key: ${JSON.stringify(key)}, target: viewport, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...${options} };
    viewport.handlers.keydown(event);
    window.handlers.keydown(event);
    return event.defaultPrevented;
  })()`);
}

test('WASD pans like arrow keys while words or connectors have focus', () => {
  const app = game(280, { authoredPuzzles: true });
  app.run("chooseWord('rain')");
  const source = app.run('selected');
  const label = app.run('selectedLabel');
  for (const [letter, arrow] of [['w', 'ArrowUp'], ['a', 'ArrowLeft'], ['s', 'ArrowDown'], ['d', 'ArrowRight']]) {
    app.run('fitView(); zoomView(4)');
    const before = app.run('JSON.stringify([camera.x, camera.y])');
    pressConnectorKey(app, arrow);
    const expected = app.run('JSON.stringify([camera.x, camera.y])');
    assert.notEqual(expected, before, `${arrow} moves the zoomed view`);
    for (const target of ['viewport', 'board.children[0]', 'labelPanel.children[0]']) {
      app.run('fitView(); zoomView(4)');
      assert.equal(pressConnectorKey(app, letter, `{ target: ${target} }`), true);
      assert.equal(app.run('JSON.stringify([camera.x, camera.y])'), expected);
    }
  }
  assert.equal(app.run('selected'), source);
  assert.equal(app.run('selectedLabel'), label);
  assert.equal(app.run('connections.length'), 0);
});

test('WASD supports held and uppercase keys, respects bounds, and ignores typing and modifiers', () => {
  const app = game(280);
  app.run('zoomView(4); checked = true');
  const before = app.run('camera.y');
  assert.equal(pressConnectorKey(app, 'S', '{ shiftKey: true, repeat: true }'), true);
  assert.ok(app.run('camera.y') < before, 'panning remains available after grading');
  for (const options of [
    '{ ctrlKey: true }', '{ metaKey: true }', '{ altKey: true }',
    '{ isComposing: true }', '{ defaultPrevented: true }',
    '{ target: { isContentEditable: true } }',
    '{ target: { closest() { return {}; } } }',
  ]) {
    const position = app.run('JSON.stringify(camera)');
    pressConnectorKey(app, 'w', options);
    assert.equal(app.run('JSON.stringify(camera)'), position);
  }
  for (let i = 0; i < 100; i++) pressConnectorKey(app, 's', '{ repeat: true }');
  const edge = app.run('camera.y');
  pressConnectorKey(app, 's');
  assert.equal(app.run('camera.y'), edge, 'panning stops at the content boundary');
  pressConnectorKey(app, 'Home');
  const fitted = app.run('JSON.stringify(camera)');
  for (const letter of ['w', 'a', 's', 'd']) pressConnectorKey(app, letter);
  assert.equal(app.run('JSON.stringify(camera)'), fitted, 'the fitted web stays centered');
});

test('number hotkeys select connectors in displayed order and clear the source like a click', () => {
  const app = game(812, { authoredPuzzles: true });
  const buttons = app.elements.get('link-labels').children;
  assert.equal(buttons[0].attributes['aria-keyshortcuts'], '1');
  assert.equal(buttons[1].children[0].textContent, '2');
  app.run("chooseWord('rain')");
  assert.equal(pressConnectorKey(app, '2'), true);
  assert.equal(app.run('selectedLabel === puzzle.labels[1]'), true);
  assert.equal(app.run('selected'), null);
  assert.equal(buttons[0].attributes['aria-pressed'], 'false');
  assert.equal(buttons[1].attributes['aria-pressed'], 'true');
  assert.ok(app.elements.get('label-status').textContent.startsWith(buttons[1].dataset.label));
  buttons[0].handlers.click();
  assert.equal(app.run('selectedLabel === puzzle.labels[0]'), true);
  assert.equal(buttons[1].attributes['aria-pressed'], 'false');
});

test('connector hotkeys ignore typing, modifiers, composition, missing options, and graded puzzles', () => {
  const app = game(812, { authoredPuzzles: true });
  const original = app.run('selectedLabel');
  for (const options of [
    '{ ctrlKey: true }', '{ metaKey: true }', '{ altKey: true }', '{ shiftKey: true }',
    '{ isComposing: true }', '{ repeat: true }', '{ defaultPrevented: true }',
    '{ target: { isContentEditable: true } }',
    '{ target: { closest() { return {}; } } }',
  ]) {
    pressConnectorKey(app, '2', options);
    assert.equal(app.run('selectedLabel'), original);
  }
  assert.equal(pressConnectorKey(app, '9'), false);
  app.run('checked = true');
  assert.equal(pressConnectorKey(app, '2'), false);
  assert.equal(app.run('selectedLabel'), original);
});

test('zero chooses the tenth connector and leaves Home available for fitting', () => {
  const app = game(812, { authoredPuzzles: true });
  app.run('puzzles.push({ ...puzzles[0], labels: Array.from({length: 10}, (_, i) => `connector ${i + 1}`), links: [] }); changePuzzle(puzzles.length - 1)');
  assert.equal(pressConnectorKey(app, '0'), true);
  assert.equal(app.run('selectedLabel === puzzle.labels[9]'), true);
  assert.equal(app.elements.get('link-labels').children[9].attributes['aria-keyshortcuts'], '0');
  app.run('zoomView(2)');
  pressConnectorKey(app, 'Home');
  assert.equal(app.run('camera.zoom'), 1);
  app.run('changePuzzle(0); zoomView(2)');
  pressConnectorKey(app, '0');
  assert.equal(app.run('camera.zoom'), 1, 'zero still fits when the puzzle has fewer than ten connectors');
});


test('long connector labels wrap into measured lines and retain their sentence preview', () => {
  const app = game();
  app.run("connections = [['rain', 'soil', 'raises the chance of']]; update(true)");
  const size = app.run('labelSizes[0]');
  assert.equal(size.lines.length, 2);
  assert.equal(size.lines.join(' '), 'raises the chance of');
  assert.ok(size.width < 'raises the chance of'.length * 7 + 8);
  const label = app.elements.get('connections').children.find((node) => node.attributes.tabindex === '0');
  assert.ok(label, 'connector remains keyboard focusable');
  assert.equal(label.children.length, 2);
  assert.equal(label.attributes['aria-label'], 'rain raises the chance of soil');
  label.handlers.focus();
  assert.equal(app.elements.get('term-preview').textContent, 'rain raises the chance of soil');
  assert.equal(app.elements.get('term-preview').hidden, false);
  label.handlers.blur();
  assert.equal(app.elements.get('term-preview').hidden, true);
});

test('word hover and keyboard focus preview text without moving the web', () => {
  const app = game();
  const word = app.elements.get('word-board').children[0];
  const before = app.run('JSON.stringify([...positions])');
  word.handlers.pointerenter({ pointerType: 'mouse' });
  assert.equal(app.elements.get('term-preview').textContent, word.textContent);
  assert.equal(app.elements.get('term-preview').hidden, false);
  assert.equal(app.run('JSON.stringify([...positions])'), before);
  word.handlers.pointerleave();
  assert.equal(app.elements.get('term-preview').hidden, true);
  word.handlers.pointerenter({ pointerType: 'touch' });
  assert.equal(app.elements.get('term-preview').hidden, true);
  word.handlers.focus();
  assert.equal(app.elements.get('term-preview').hidden, false);
  word.handlers.blur();
  assert.equal(app.elements.get('term-preview').hidden, true);
});


test('DCML puzzle folds safely, improves Fit, and keeps links when switching layouts', () => {
  const app = game(812, { authoredPuzzles: true });
  app.run('changePuzzle(puzzles.findIndex(p => p.layout?.type === "serpentine")); connections = puzzle.links.map(link => [...linkWords(link), linkLabels(link)[0]]); update(true)');
  assert.equal(app.run('activeLayout'), 'serpentine');
  const themedScale = app.run('camera.scale');
  const links = app.run('JSON.stringify(connections)');
  assert.equal(app.run('WebLayout.layoutProblems(measureNodes(), connections, cachedRoutes, {labelSizes}).length'), 0);
  const picker = app.elements.get('layout-select');
  picker.value = 'flowchart'; picker.handlers.change();
  assert.equal(app.run('activeLayout'), 'flowchart');
  assert.ok(themedScale > app.run('camera.scale'), 'folding keeps the fitted text larger than the linear flowchart');
  assert.equal(app.run('JSON.stringify(connections)'), links);
  picker.value = 'puzzle'; picker.handlers.change();
  assert.equal(app.run('activeLayout'), 'serpentine');
  for (const width of [248, 812]) {
    app.resize(width);
    assert.equal(app.run('cachedRoutes.length'), app.run('connections.length'));
    assert.equal(app.run('WebLayout.layoutProblems(measureNodes(), connections, cachedRoutes, {labelSizes}).length'), 0);
  }
  app.elements.get('check-button').handlers.click();
  const score = app.elements.get('result').innerHTML;
  picker.value = 'flowchart'; picker.handlers.change();
  assert.equal(app.elements.get('result').innerHTML, score, 'changing shape preserves the grade');
  assert.equal(app.run('checked'), true);
  app.elements.get('reset-button').handlers.click();
  assert.equal(app.run('connections.length'), 0);
  assert.equal(app.run('cachedRoutes.length'), 0);
});

test('themed layout uses player links and falls back for branches and cycles', () => {
  const app = game(812, { authoredPuzzles: true });
  app.run('changePuzzle(puzzles.findIndex(p => p.layout?.type === "serpentine"))');
  assert.equal(app.run('activeLayout'), 'flowchart');
  assert.equal(app.run('cachedRoutes.length'), 0, 'opening scatter reveals no authored connections');
  app.run('connections = [[puzzle.words[0], puzzle.words[1], puzzleLabels()[0]], [puzzle.words[0], puzzle.words[2], puzzleLabels()[0]]]; update(true)');
  assert.equal(app.run('activeLayout'), 'flowchart');
  app.run('connections = [[puzzle.words[0], puzzle.words[1], puzzleLabels()[0]], [puzzle.words[1], puzzle.words[2], puzzleLabels()[0]], [puzzle.words[2], puzzle.words[0], puzzleLabels()[0]]]; update(true)');
  assert.equal(app.run('activeLayout'), 'flowchart');
  assert.equal(app.run('cachedRoutes.length'), 3);
  app.run('puzzles.push({ ...puzzles[0], layout: undefined }); changePuzzle(puzzles.length - 1)');
  assert.equal(app.elements.get('layout-picker').hidden, true);
  assert.equal(app.run('layoutMode'), 'puzzle');
});


test('bone themes select safe shapes with Fit at least as readable as the routed flowchart', () => {
  const app = game(812, { authoredPuzzles: true });
  for (const title of ['Scalp layers', 'carpal bones', 'tarsal bones', 'Bones from head to toe']) {
    app.run(`changePuzzle(puzzles.findIndex(p => p.title === ${JSON.stringify(title)})); connections = puzzle.links.map(l => [...l.words, linkLabels(l)[0]]); update(true)`);
    const shape = app.run('activeLayout'), scale = app.run('camera.scale');
    assert.notEqual(shape, 'flowchart', `${title} benefits from a themed layout`);
    assert.equal(app.run('WebLayout.layoutProblems(measureNodes(), connections, cachedRoutes, {labelSizes}).length'), 0);
    const links = app.run('JSON.stringify(connections)');
    const picker = app.elements.get('layout-select');
    picker.value = 'flowchart'; picker.handlers.change();
    assert.ok(scale >= app.run('camera.scale'), `${title}: themes preserve or improve fitted text size`);
    assert.equal(app.run('JSON.stringify(connections)'), links);
    picker.value = 'puzzle'; picker.handlers.change();
    app.resize(248);
    assert.equal(app.run('WebLayout.layoutProblems(measureNodes(), connections, cachedRoutes, {labelSizes}).length'), 0);
    app.resize(812);
  }
});

test('radial concept map keeps its hub central without adding answer-key links', () => {
  const app = game();
  app.run('puzzles.push({category:"TEST",title:"Star",layout:{type:"radial"},words:["hub",...Array.from({length:8},(_,i)=>`leaf${i}`)],labels:["has"],links:Array.from({length:8},(_,i)=>({words:["hub",`leaf${i}`],label:"has"}))}); changePuzzle(puzzles.length-1)');
  assert.equal(app.run('cachedRoutes.length'), 0);
  app.run('connections=puzzle.links.map(l=>[...l.words,l.label]); update(true)');
  assert.equal(app.run('activeLayout'), 'radial');
  assert.equal(app.run('cachedRoutes.length'), 8);
  assert.equal(app.run('WebLayout.layoutProblems(measureNodes(), connections, cachedRoutes, {labelSizes}).length'), 0);
  app.run('connections.pop(); update(true)');
  assert.equal(app.run('cachedRoutes.length'), 7, 'removing a link never reveals a replacement from the answer key');
});


test('puzzle badges retain best completion and reject extra links for perfect', () => {
  const app = game();
  assert.match(app.elements.get('puzzle-select').children[0].textContent, /New/);
  app.run("chooseWord('forest'); chooseWord('root')");
  assert.match(app.elements.get('puzzle-select').children[0].textContent, /Incomplete/);
  app.elements.get('check-button').handlers.click();
  assert.match(app.elements.get('puzzle-select').children[0].textContent, /Complete/);
  app.run('connections = puzzle.links.map(link => [...linkWords(link), null]); connections.push(["forest", "seed", null])');
  app.elements.get('check-button').handlers.click();
  assert.match(app.elements.get('puzzle-select').children[0].textContent, /Complete/);
  app.run('connections.pop()');
  app.elements.get('check-button').handlers.click();
  assert.match(app.elements.get('puzzle-select').children[0].textContent, /Perfect/);
  app.elements.get('reset-button').handlers.click();
  assert.match(app.elements.get('puzzle-select').children[0].textContent, /Perfect/);
});

test('pathway follows correct directed links, excludes mistakes, and clears on change', () => {
  const app = game(812, { authoredPuzzles: true });
  app.run('connections = puzzle.links.slice(0, 3).map(link => [...linkWords(link), linkLabels(link)[0]]); connections.push([puzzle.words[1], puzzle.words[0], "wrong"]); update(true)');
  app.elements.get('check-button').handlers.click();
  assert.equal(app.run('pathwayLinks.length'), 3);
  assert.equal(app.elements.get('pathway-panel').hidden, true);
  assert.equal(app.elements.get('result-overlay').hidden, false);
  app.elements.get('explore-pathway').handlers.click();
  assert.equal(app.elements.get('result-overlay').hidden, true);
  assert.equal(app.elements.get('pathway-panel').hidden, false);
  assert.equal(app.elements.get('pathway-sentence').textContent, app.run('pathwayLinks[0].join(" → ")'));
  app.elements.get('pathway-next').handlers.click();
  assert.equal(app.run('pathwayIndex'), 1);
  app.elements.get('pathway-play').handlers.click();
  app.elements.get('show-result').handlers.click();
  assert.equal(app.run('pathwayPlaying'), false);
  assert.equal(app.elements.get('pathway-panel').hidden, true);
  assert.equal(app.elements.get('result-overlay').hidden, false);
  app.run('changePuzzle(1)');
  assert.equal(app.elements.get('result-overlay').hidden, true);
  assert.equal(app.elements.get('pathway-panel').hidden, true);
  assert.equal(app.run('pathwayLinks.length'), 0);
});


test('badges persist across visits and tolerate unavailable storage', () => {
  const storage = new Map();
  const first = game(812, { storage });
  first.run("chooseWord('forest'); chooseWord('root')");
  const second = game(812, { storage });
  assert.match(second.elements.get('puzzle-select').children[0].textContent, /Incomplete/);
  const broken = { get() { throw Error('unavailable'); }, set() { throw Error('unavailable'); } };
  const third = game(812, { storage: broken });
  third.run("chooseWord('forest'); chooseWord('root')");
  assert.match(third.elements.get('puzzle-select').children[0].textContent, /Incomplete/);
});


test('empty and zero-hit results can return to the board without a pathway', () => {
  const app = game();
  app.elements.get('check-button').handlers.click();
  assert.equal(app.elements.get('result-overlay').hidden, false);
  assert.equal(app.elements.get('explore-pathway').hidden, true);
  app.elements.get('dismiss-result').handlers.click();
  assert.equal(app.elements.get('result-overlay').hidden, true);
  app.run('connections = [["forest", "seed", null]]');
  app.elements.get('check-button').handlers.click();
  assert.equal(app.elements.get('explore-pathway').hidden, true);
  assert.equal(app.elements.get('pathway-panel').hidden, true);
  app.elements.get('reset-button').handlers.click();
  assert.equal(app.elements.get('result-overlay').hidden, true);
});

test('pathway card supports bounded dragging, keyboard movement, and reset', () => {
  const app = game();
  const panel = app.elements.get('pathway-panel');
  panel.getBoundingClientRect = () => ({ width: 300, height: 140,
    left: parseFloat(panel.style.left) || 500, top: parseFloat(panel.style.top) || 12 });
  const handle = app.elements.get('pathway-drag');
  handle.handlers.pointerdown({ button: 0, pointerId: 7, clientX: 510, clientY: 20, preventDefault() {} });
  handle.handlers.pointermove({ pointerId: 7, clientX: -1000, clientY: 2000 });
  assert.equal(panel.style.left, '8px');
  assert.equal(panel.style.top, '652px');
  handle.handlers.pointermove({ pointerId: 7, clientX: 2000, clientY: 2000 });
  assert.equal(panel.style.left, '892px', 'card can move beyond the game board to the window edge');
  handle.handlers.pointermove({ pointerId: 7, clientX: -1000, clientY: 2000 });
  handle.handlers.pointerup();
  handle.handlers.pointermove({ pointerId: 7, clientX: 600, clientY: 40 });
  assert.equal(panel.style.left, '8px', 'released drags stop moving the card');
  handle.handlers.keydown({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} });
  assert.equal(panel.style.left, '28px');
  app.elements.get('reset-button').handlers.click();
  assert.equal(app.run('pathwayPosition'), null);
  assert.equal(panel.style.left, '');
  assert.equal(panel.style.top, '');
});

test('Toy Box audio follows interactions, mutes immediately, and remembers the preference', () => {
  const storage = new Map();
  const app = game(812, { storage });
  app.run(`
    window.strikes = [];
    window.volume = null;
    window.AudioContext = class {
      constructor() { this.currentTime = 0; this.state = 'running'; }
      createGain() { const bus = !this.hasBus; this.hasBus = true; return { gain: { value: 0, setValueAtTime(v) { if (bus) window.volume = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
      createOscillator() { return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start(at) { window.strikes.push(at); }, stop() {} }; }
    };
    chooseWord('forest'); chooseWord('root');
  `);
  assert.equal(app.run('window.strikes.length'), 6);
  app.elements.get('sound-toggle').handlers.click();
  assert.equal(app.run('window.volume'), 0);
  app.run("chooseWord('root'); chooseWord('soil')");
  assert.equal(app.run('window.strikes.length'), 6);
  assert.equal(storage.get('word-web-sound'), 'off');
  assert.equal(game(812, { storage }).elements.get('sound-toggle').attributes['aria-pressed'], 'false');
  app.elements.get('sound-toggle').handlers.click();
  assert.equal(app.run('window.volume'), 0.55);
  assert.equal(app.run('window.strikes.length'), 9);
});
