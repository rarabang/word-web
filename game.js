const fallbackPuzzles = [
  {
    category: "NATURE",
    title: "The living world",
    words: ["forest", "root", "soil", "river", "rain", "seed", "leaf", "sunlight"],
    // Each pair is a valid direct relationship. Players can discover these in any order.
    links: [["forest", "root"], ["root", "soil"], ["soil", "seed"], ["seed", "leaf"], ["leaf", "sunlight"], ["river", "rain"], ["rain", "soil"], ["forest", "river"], ["sunlight", "seed"]],
  },
  {
    category: "table",
    title: "tables",
    words: ["table", "material", "wood", "metal", "glass", "legs", "top", "dining", "coffee"],
    links: [["table", "material"], ["material", "wood"], ["material", "metal"], ["material", "glass"], ["table", "legs"], ["table", "top"], ["dining", "table"], ["coffee", "table"]],
  }
];
const puzzles = typeof WORD_WEB_PUZZLES === "undefined" ? fallbackPuzzles : WORD_WEB_PUZZLES;

// Toy Box: short synthesized wooden strikes and xylophone-like partials.
// Create the audio context only during an interaction; audio is optional.
const soundToggle = document.querySelector("#sound-toggle");
let soundEnabled = true;
let toyAudio = null;
let toyBus = null;
try { soundEnabled = window.localStorage.getItem("word-web-sound") !== "off"; } catch {}
function refreshSoundToggle() {
  soundToggle.textContent = soundEnabled ? "Sound on" : "Sound off";
  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
}
function toySound(kind) {
  if (!soundEnabled) return;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  try {
    if (!toyAudio) {
      toyAudio = new Audio();
      toyBus = toyAudio.createGain();
      toyBus.gain.value = 0.55;
      toyBus.connect(toyAudio.destination);
    }
    if (toyAudio.state === "suspended") toyAudio.resume().catch(() => {});
    const start = toyAudio.currentTime + 0.015;
    const notes = {
      select: [[680, 0, 0.055]],
      connect: [[784, 0, 0.24]],
      remove: [[523, 0, 0.12]],
      retry: [[330, 0, 0.13], [270, 0.11, 0.16]],
      perfect: [[523, 0, 0.3], [659, 0.13, 0.3], [784, 0.26, 0.3], [1047, 0.4, 0.45]],
      step: [[659, 0, 0.12]],
    }[kind] || [];
    notes.forEach(([frequency, delay, duration]) => {
      [1, 2.76, 5.4].forEach((ratio, index) => {
        const oscillator = toyAudio.createOscillator();
        const envelope = toyAudio.createGain();
        const at = start + delay;
        oscillator.frequency.setValueAtTime(frequency * ratio, at);
        if (kind === "retry") oscillator.frequency.exponentialRampToValueAtTime(frequency * ratio * 0.7, at + duration);
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(0.16 / (1 + index * 3), at + 0.003);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration / (1 + index));
        oscillator.connect(envelope);
        envelope.connect(toyBus);
        oscillator.start(at);
        oscillator.stop(at + duration);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
      });
    });
  } catch { /* Unsupported or blocked audio must never interrupt the puzzle. */ }
}
soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  if (toyBus) toyBus.gain.setValueAtTime(soundEnabled ? 0.55 : 0, toyAudio.currentTime);
  try { window.localStorage.setItem("word-web-sound", soundEnabled ? "on" : "off"); } catch {}
  refreshSoundToggle();
  if (soundEnabled) toySound("connect");
});
refreshSoundToggle();

const board = document.querySelector("#word-board");
const boardWrap = document.querySelector("#board-wrap");
const svg = document.querySelector("#connections");
const viewport = document.querySelector("#board-viewport");
let cachedRoutes = [];
let labelSizes = [];
let flowDirection = "horizontal";
let flowNodes = new Map();
const camera = { zoom: 1, scale: 1, x: 0, y: 0 };
let panGesture = null;
const count = document.querySelector("#connection-count");
const result = document.querySelector("#result");
let puzzleIndex = 0;
let puzzle = puzzles[puzzleIndex];
let selected = null;
let selectedLabel = puzzleLabels()[0] || null;
let layoutMode = "puzzle";
let activeLayout = "flowchart";
let connections = [];
let checked = false;
const progressKey = "word-web-progress-v1";
let progress = {};
try { const saved = JSON.parse(window.localStorage.getItem(progressKey) || "{}"); if (saved && typeof saved === "object" && !Array.isArray(saved)) progress = saved; } catch {}
const statusNames = ["○ New", "◐ Incomplete", "✓ Complete", "★ Perfect"];
function puzzleProgressKey(item) { return JSON.stringify([item.category, item.title, item.links]); }
function refreshBadges() {
  [...puzzleSelect.children].forEach((option, index) => {
    const item = puzzles[index];
    const rank = progress[puzzleProgressKey(item)];
    option.textContent = `${statusNames[Number.isInteger(rank) && rank >= 0 && rank <= 3 ? rank : 0]} · ${item.title} · ${item.category}`;
  });
}
function saveProgress(rank) {
  const id = puzzleProgressKey(puzzle);
  progress[id] = Math.max(Number(progress[id]) || 0, rank);
  try { window.localStorage.setItem(progressKey, JSON.stringify(progress)); } catch {}
  refreshBadges();
}
let pathwayLinks = [];
let pathwayIndex = -1;
let pathwayTimer = null;
let pathwayPlaying = false;
const resultOverlay = document.querySelector("#result-overlay");
const explorePathway = document.querySelector("#explore-pathway");
function showResult() {
  pausePathway();
  pathwayPanel.hidden = true;
  resultOverlay.hidden = false;
  explorePathway.hidden = !pathwayLinks.length;
  (pathwayLinks.length ? explorePathway : document.querySelector("#dismiss-result")).focus?.();
}
function dismissResult() {
  resultOverlay.hidden = true;
  viewport.focus?.();
}
explorePathway.addEventListener("click", () => {
  if (!pathwayLinks.length) return;
  resultOverlay.hidden = true;
  pathwayPanel.hidden = false;
  if (pathwayPosition) movePathway(pathwayPosition.x, pathwayPosition.y);
  pathwayPlay.focus?.();
});
document.querySelector("#dismiss-result").addEventListener("click", dismissResult);
document.querySelector("#show-result").addEventListener("click", showResult);
document.querySelector("#pathway-exit").addEventListener("click", () => {
  pausePathway();
  pathwayPanel.hidden = true;
  pathwayIndex = -1;
  highlightPathway();
  endPathwayDrag();
  viewport.focus?.();
});
const pathwayPanel = document.querySelector("#pathway-panel");
const pathwaySentence = document.querySelector("#pathway-sentence");
const pathwayPlay = document.querySelector("#pathway-play");
const pathwayNext = document.querySelector("#pathway-next");
const pathwayDrag = document.querySelector("#pathway-drag");
let pathwayPosition = null;
let pathwayGesture = null;
function movePathway(x, y) {
  const rect = pathwayPanel.getBoundingClientRect();
  const inset = 8;
  pathwayPosition = {
    x: Math.max(inset, Math.min(x, window.innerWidth - rect.width - inset)),
    y: Math.max(inset, Math.min(y, window.innerHeight - rect.height - inset)),
  };
  pathwayPanel.style.left = `${pathwayPosition.x}px`;
  pathwayPanel.style.top = `${pathwayPosition.y}px`;
  pathwayPanel.style.right = "auto";
}
function pathwayOrigin() {
  const panel = pathwayPanel.getBoundingClientRect();
  return { x: panel.left, y: panel.top };
}
pathwayDrag.addEventListener("pointerdown", event => {
  if (event.button !== 0 || event.isPrimary === false) return;
  const origin = pathwayOrigin();
  pathwayGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, origin };
  pathwayDrag.setPointerCapture(event.pointerId);
  pathwayPanel.classList.toggle("dragging", true);
  event.preventDefault();
});
pathwayDrag.addEventListener("pointermove", event => {
  if (!pathwayGesture || event.pointerId !== pathwayGesture.id) return;
  movePathway(pathwayGesture.origin.x + event.clientX - pathwayGesture.x,
    pathwayGesture.origin.y + event.clientY - pathwayGesture.y);
});
function endPathwayDrag() {
  pathwayGesture = null;
  pathwayPanel.classList.toggle("dragging", false);
}
pathwayDrag.addEventListener("pointerup", endPathwayDrag);
pathwayDrag.addEventListener("pointercancel", endPathwayDrag);
pathwayDrag.addEventListener("lostpointercapture", endPathwayDrag);
pathwayDrag.addEventListener("keydown", event => {
  const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
  if (!delta) return;
  const origin = pathwayOrigin();
  movePathway(origin.x + delta[0], origin.y + delta[1]);
  event.preventDefault();
  event.stopPropagation();
});
function pausePathway() {
  if (pathwayTimer !== null) window.clearTimeout(pathwayTimer);
  pathwayTimer = null;
  pathwayPlaying = false;
  pathwayPlay.textContent = "Play";
}
function clearPathway() {
  pausePathway();
  pathwayLinks = [];
  pathwayIndex = -1;
  pathwayPanel.hidden = true;
  endPathwayDrag();
  pathwayPosition = null;
  pathwayPanel.style.left = "";
  pathwayPanel.style.top = "";
  pathwayPanel.style.right = "";
  resultOverlay.hidden = true;
  highlightPathway();
}
function highlightPathway() {
  const active = pathwayLinks[pathwayIndex];
  board.querySelectorAll(".word-node").forEach(node => node.classList.toggle("pathway-word", Boolean(active && [active[0], active[2]].includes(node.dataset.word))));
  svg.querySelectorAll(".connection-line").forEach(line => line.classList.toggle("pathway-line", Boolean(active && line.dataset.pair === key(active[0], active[2]))));
}
function showPathwayStep(index) {
  pathwayIndex = index;
  const [source, connector, destination] = pathwayLinks[index];
  pathwaySentence.textContent = `${source} → ${connector} → ${destination}`;
  document.querySelector("#pathway-count").textContent = `${index + 1} / ${pathwayLinks.length}`;
  pathwayNext.disabled = index === pathwayLinks.length - 1;
  highlightPathway();
  if (pathwayPosition && !pathwayPanel.hidden) movePathway(pathwayPosition.x, pathwayPosition.y);
  if (!pathwayPanel.hidden) toySound("step");
}
function advancePathway() {
  if (pathwayIndex + 1 >= pathwayLinks.length) { pausePathway(); pathwayPlay.textContent = "Replay"; return; }
  showPathwayStep(pathwayIndex + 1);
  pathwayTimer = window.setTimeout(advancePathway, 2800);
}
function playPathway() {
  if (pathwayPlaying) { pausePathway(); return; }
  if (pathwayIndex === pathwayLinks.length - 1) pathwayIndex = -1;
  pathwayPlaying = true;
  pathwayPlay.textContent = "Pause";
  advancePathway();
}
function preparePathway() {
  clearPathway();
  const expected = expectedKeys();
  const remaining = connections.filter(([a, b, label]) => expected.has(expectedConnectionKey(a, b, label))).map(([a, b, label]) => [a, label || "connects to", b]);
  // Follow outgoing edges, starting at roots where possible; visit branches and cycles once.
  let destination = null;
  while (remaining.length) {
    let index = remaining.findIndex(link => link[0] === destination);
    if (index < 0) index = remaining.findIndex(link => !remaining.some(other => other[2] === link[0]));
    const [link] = remaining.splice(index < 0 ? 0 : index, 1);
    pathwayLinks.push(link);
    destination = link[2];
  }
  pathwayPanel.hidden = true;
  if (pathwayLinks.length) {
    showPathwayStep(0);
    pathwayPlay.textContent = "Play";
  }
}
pathwayPlay.addEventListener("click", playPathway);
pathwayNext.addEventListener("click", () => { pausePathway(); if (pathwayIndex + 1 < pathwayLinks.length) showPathwayStep(pathwayIndex + 1); });


const puzzleNumber = document.querySelector("#puzzle-number");
const puzzleTitle = document.querySelector("#puzzle-title");
const puzzleSelect = document.querySelector("#puzzle-select");
const labelPanel = document.querySelector("#link-labels");
const labelStatus = document.querySelector("#label-status");
const layoutSelect = document.querySelector("#layout-select");
const layoutPicker = document.querySelector("#layout-picker");
const layoutStatus = document.querySelector("#layout-status");
const termPreview = document.querySelector("#term-preview");
layoutSelect.addEventListener("change", () => {
  layoutMode = layoutSelect.value === "flowchart" ? "flowchart" : "puzzle";
  update(true);
});
function hidePreview() {
  termPreview.hidden = true;
  board.querySelectorAll(".word-node").forEach((node) => node.classList.toggle("preview-endpoint", false));
}
function showPreview(anchor, text, words = []) {
  hidePreview();
  termPreview.textContent = text;
  termPreview.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const preview = termPreview.getBoundingClientRect();
  const width = window.innerWidth || viewport.clientWidth;
  const height = window.innerHeight || viewport.clientHeight;
  const left = Math.max(12, Math.min(width - preview.width - 12, rect.left + rect.width / 2 - preview.width / 2));
  const above = rect.top - preview.height - 10;
  const top = Math.max(12, Math.min(height - preview.height - 12, above >= 12 ? above : rect.top + rect.height + 10));
  termPreview.style.left = `${left}px`;
  termPreview.style.top = `${top}px`;
  board.querySelectorAll(".word-node").forEach((node) => node.classList.toggle("preview-endpoint", words.includes(node.dataset.word)));
}
function bindPreview(element, text, words = []) {
  element.setAttribute("aria-describedby", "term-preview");
  element.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "touch") showPreview(element, text, words);
  });
  element.addEventListener("pointerleave", hidePreview);
  element.addEventListener("focus", () => showPreview(element, text, words));
  element.addEventListener("blur", hidePreview);
}
window.addEventListener("scroll", hidePreview, true);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    cancelWordDrag();
    hidePreview();
    if (!resultOverlay.hidden) dismissResult();
  }
});
function updatePuzzleHeading() {
  puzzleNumber.innerHTML = `PUZZLE ${String(puzzleIndex + 1).padStart(2, "0")} <span>·</span> ${puzzle.category}`;
  puzzleTitle.textContent = puzzle.title;
  layoutPicker.hidden = !puzzle.layout;
  layoutSelect.value = layoutMode;
}
function changePuzzle(index) {
  cancelWordDrag();
  clearPathway();
  puzzleIndex = index;
  puzzle = puzzles[puzzleIndex];
  layoutMode = "puzzle";
  selected = null;
  selectedLabel = puzzleLabels()[0] || null;
  connections = [];
  checked = false;
  positions.clear();
  outerPositions.clear();
  cachedRoutes = [];
  result.hidden = true;
  document.querySelector("#check-button").disabled = false;
  updatePuzzleHeading();
  renderLabels();
  scatterWords();
  renderWords();
  update(true);
}
puzzles.forEach((item, index) => {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = `${item.title} · ${item.category}`;
  puzzleSelect.append(option);
});
refreshBadges();
puzzleSelect.value = "0";
puzzleSelect.addEventListener("change", () => changePuzzle(Number(puzzleSelect.value)));
updatePuzzleHeading();
document.querySelector("#date-label").textContent = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date()).toUpperCase();

const positions = new Map();
const outerPositions = new Map();
const layoutSettings = {
  minimumLinkDistance: 220, // pixels between linked word centers
  wordGap: 48, // clear space between word buttons
  iterations: 90, // collision-resolution passes per layout update
};

function randomBetween(min, max) { return min + Math.random() * (max - min); }

// Every word starts in a shuffled scatter. These positions are independent of
// the puzzle's answer key, so the opening board does not hint at relationships.
function scatterWords() {
  const spots = [];
  puzzle.words.forEach(() => {
    let spot;
    let attempts = 0;
    do {
      spot = [randomBetween(13, 87), randomBetween(18, 82)];
      attempts += 1;
    } while (attempts < 40 && spots.some(([x, y]) => Math.hypot((spot[0] - x) * 0.62, spot[1] - y) < 17));
    spots.push(spot);
  });
  puzzle.words.forEach((word, index) => {
    positions.set(word, spots[index]);
    const angle = Math.random() * Math.PI * 2;
    outerPositions.set(word, [50 + Math.cos(angle) * 40, 50 + Math.sin(angle) * 40]);
  });
}

function key(a, b) { return [a, b].sort().join("|"); }
function linkWords(link) { return Array.isArray(link) ? link.slice(0, 2) : link.words; }
function linkLabels(link) {
  if (Array.isArray(link)) return [];
  const labels = link.labels ?? link.label;
  if (Array.isArray(labels)) return labels.filter((label) => typeof label === "string" && label);
  return typeof labels === "string" && labels ? [labels] : [];
}
function puzzleLabels() {
  return [...new Set([...(puzzle.labels || []), ...puzzle.links.flatMap(linkLabels)])];
}
function expectedKeys() {
  return new Set(puzzle.links.flatMap((link) => {
    const [a, b] = linkWords(link);
    const labels = linkLabels(link);
    return labels.length ? labels.map((label) => `${a}>${b}|${label}`) : [key(a, b)];
  }));
}
function expectedRelationKeys() {
  return new Set(puzzle.links.map((link) => {
    const [a, b] = linkWords(link);
    return linkLabels(link).length ? `${a}>${b}` : key(a, b);
  }));
}

const connectorMenu = document.querySelector("#connector-menu");
let editingConnection = null;
let connectorTrigger = null;

function closeConnectorMenu(restoreFocus = false) {
  connectorMenu.hidePopover();
  connectorTrigger?.setAttribute("aria-expanded", "false");
  if (restoreFocus) {
    const target = [...svg.querySelectorAll(".connection-label")].find((label) => label.dataset.pair === connectorTrigger?.dataset.pair);
    (target || connectorTrigger)?.focus();
  }
  editingConnection = null;
  connectorTrigger = null;
}

function editConnector(connection, trigger) {
  if (checked || !connections.includes(connection) || !puzzleLabels().length) return;
  editingConnection = connection;
  connectorTrigger = trigger;
  hidePreview();
  connectorMenu.setAttribute("aria-label", `Connector for ${connection[0]} → ${connection[1]}`);
  connectorMenu.replaceChildren();
  puzzleLabels().forEach((label) => {
    const option = document.createElement("button");
    option.type = "button";
    option.textContent = label;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(label === connection[2]));
    option.addEventListener("click", () => {
      if (!checked && connections.includes(editingConnection) && editingConnection[2] !== label) {
        editingConnection[2] = label;
        selected = null;
        toySound("connect");
        saveProgress(1);
        update(true);
        labelStatus.textContent = "Connector updated. Select a connection label to edit another.";
      }
      closeConnectorMenu(true);
    });
    connectorMenu.append(option);
  });
  trigger.setAttribute("aria-expanded", "true");
  connectorMenu.showPopover();
  const anchor = trigger.getBoundingClientRect();
  const menu = connectorMenu.getBoundingClientRect();
  const width = window.innerWidth || viewport.clientWidth;
  const height = window.innerHeight || viewport.clientHeight;
  connectorMenu.style.left = `${Math.max(8, Math.min(anchor.left + anchor.width / 2 - menu.width / 2, width - menu.width - 8))}px`;
  const below = anchor.top + anchor.height + 8;
  const top = below + menu.height <= height - 8 ? below : anchor.top - menu.height - 8;
  connectorMenu.style.top = `${Math.max(8, Math.min(top, height - menu.height - 8))}px`;
  const options = [...connectorMenu.children];
  (options[puzzleLabels().indexOf(connection[2])] || options[0]).focus();
}

connectorMenu.addEventListener("toggle", (event) => {
  if (event.newState === "closed") {
    connectorTrigger?.setAttribute("aria-expanded", "false");
    editingConnection = null;
    connectorTrigger = null;
    hidePreview();
  }
});
connectorMenu.addEventListener("keydown", (event) => {
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    closeConnectorMenu(true);
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const options = [...connectorMenu.children];
    const index = options.indexOf(event.target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  }
});
window.addEventListener("scroll", (event) => {
  if (editingConnection && !connectorMenu.contains(event.target)) closeConnectorMenu();
}, true);
window.addEventListener("resize", () => { if (editingConnection) closeConnectorMenu(); });

function selectConnector(label) {
  if (checked || !puzzleLabels().includes(label)) return;
  toySound("select");
  selectedLabel = label;
  selected = null;
  labelPanel.querySelectorAll(".link-label").forEach((button) => {
    const active = button.dataset.label === label;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  labelStatus.textContent = `${label}: choose the source word, then the destination`;
  update();
}

function renderLabels() {
  labelPanel.replaceChildren();
  const labels = puzzleLabels();
  labels.forEach((label, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link-label";
    button.dataset.label = label;
    button.textContent = label;
    if (index < 10) {
      const shortcut = String((index + 1) % 10);
      const badge = document.createElement("kbd");
      badge.className = "connector-shortcut";
      badge.textContent = shortcut;
      badge.setAttribute("aria-hidden", "true");
      button.append(badge);
      button.setAttribute("aria-keyshortcuts", shortcut);
      button.title = `${label} (press ${shortcut})`;
    }
    button.setAttribute("aria-pressed", String(selectedLabel === label));
    button.classList.toggle("active", selectedLabel === label);
    button.addEventListener("click", () => selectConnector(label));
    labelPanel.append(button);
  });
  labelStatus.textContent = selectedLabel
    ? "Choose the source word, then the destination"
    : "Choose a connector, then its source and destination";
}

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.isComposing ||
    event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target?.isContentEditable || event.target?.closest?.(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
  )) return;
  const moves = { w: [0, 48], a: [48, 0], s: [0, -48], d: [-48, 0] };
  const move = moves[event.key.toLowerCase()];
  if (move) {
    event.preventDefault();
    camera.x += move[0];
    camera.y += move[1];
    applyCamera();
    return;
  }
  if (event.repeat || checked || event.shiftKey) return;
  if (!/^[0-9]$/.test(event.key)) return;
  const index = event.key === "0" ? 9 : Number(event.key) - 1;
  const label = puzzleLabels()[index];
  if (!label) return;
  event.preventDefault();
  selectConnector(label);
});

function resolveLayout() {
  const bounds = { width: board.clientWidth, height: board.clientHeight };
  if (!bounds.width || !bounds.height) return;

  const nodes = [...board.querySelectorAll(".word-node")];
  const items = nodes.map((node) => {
    const [x, y] = positions.get(node.dataset.word);
    return {
      node,
      x: (x / 100) * bounds.width,
      y: (y / 100) * bounds.height,
      width: node.offsetWidth,
      height: node.offsetHeight,
    };
  });
  const linkedPairs = new Set(connections.map(([a, b]) => key(a, b)));
  const linkDistance = Math.min(layoutSettings.minimumLinkDistance, bounds.width * 0.3);

  function keepInside(item) {
    item.x = Math.max(item.width / 2 + 38, Math.min(bounds.width - item.width / 2 - 38, item.x));
    item.y = Math.max(item.height / 2 + 38, Math.min(bounds.height - item.height / 2 - 38, item.y));
  }

  items.forEach(keepInside);
  for (let pass = 0; pass < layoutSettings.iterations; pass += 1) {
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          const angle = (i * 2.4 + j) % (Math.PI * 2);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }

        if (linkedPairs.has(key(a.node.dataset.word, b.node.dataset.word)) && distance < linkDistance) {
          const push = (linkDistance - distance) / 2;
          a.x -= (dx / distance) * push;
          a.y -= (dy / distance) * push;
          b.x += (dx / distance) * push;
          b.y += (dy / distance) * push;
        }

        dx = b.x - a.x;
        dy = b.y - a.y;
        const overlapX = (a.width + b.width) / 2 + layoutSettings.wordGap - Math.abs(dx);
        const overlapY = (a.height + b.height) / 2 + layoutSettings.wordGap - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          if (overlapX < overlapY) {
            const direction = dx === 0 ? (i % 2 ? -1 : 1) : Math.sign(dx);
            a.x -= direction * overlapX / 2;
            b.x += direction * overlapX / 2;
          } else {
            const direction = dy === 0 ? (j % 2 ? -1 : 1) : Math.sign(dy);
            a.y -= direction * overlapY / 2;
            b.y += direction * overlapY / 2;
          }
        }
        keepInside(a);
        keepInside(b);
      }
    }
  }

  items.forEach(({ node, x, y }) => {
    positions.set(node.dataset.word, [(x / bounds.width) * 100, (y / bounds.height) * 100]);
  });
}

let wordGesture = null;
const dragPreview = document.querySelector("#connection-drag-preview");
const dragLine = document.querySelector("#connection-drag-line");
function wordAtPointer(event) {
  const node = document.elementFromPoint(event.clientX, event.clientY)?.closest(".word-node");
  return node && puzzle.words.includes(node.dataset.word) ? node : null;
}
function cancelWordDrag() {
  const gesture = wordGesture;
  wordGesture = null;
  dragPreview.style.display = "none";
  board.querySelectorAll(".word-node").forEach(node => {
    node.classList.toggle("drag-source", false);
    node.classList.toggle("drop-target", false);
  });
  if (gesture?.node.hasPointerCapture(gesture.id)) gesture.node.releasePointerCapture(gesture.id);
}
function renderWords() {
  board.replaceChildren();
  puzzle.words.forEach((word, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "word-node";
    button.textContent = word;
    button.dataset.word = word;
    const [x, y] = positions.get(word);
    button.style.left = `${x}%`;
    button.style.top = `${y}%`;
    button.setAttribute("aria-pressed", "false");
    bindPreview(button, word);
    let suppressClick = false;
    button.addEventListener("click", event => {
      if (suppressClick && event?.detail !== 0) { suppressClick = false; return; }
      hidePreview(); chooseWord(word);
    });
    button.addEventListener("pointerdown", event => {
      if (checked || wordGesture || event.button !== 0 || event.isPrimary === false) return;
      suppressClick = false;
      wordGesture = { id: event.pointerId, node: button, word, x: event.clientX, y: event.clientY, active: false };
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener("pointermove", event => {
      const gesture = wordGesture;
      if (!gesture || gesture.id !== event.pointerId) return;
      if (!gesture.active && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6) return;
      gesture.active = true;
      suppressClick = true;
      hidePreview();
      const target = wordAtPointer(event);
      board.querySelectorAll(".word-node").forEach(node => {
        node.classList.toggle("drag-source", node === button);
        node.classList.toggle("drop-target", node === target && node !== button);
      });
      const rect = button.getBoundingClientRect();
      for (const [name, value] of Object.entries({ x1: rect.left + rect.width / 2, y1: rect.top + rect.height / 2, x2: event.clientX, y2: event.clientY })) dragLine.setAttribute(name, value);
      dragPreview.style.display = "block";
      event.preventDefault();
    });
    button.addEventListener("pointerup", event => {
      const gesture = wordGesture;
      if (!gesture || gesture.id !== event.pointerId) return;
      const target = gesture.active ? wordAtPointer(event) : null;
      cancelWordDrag();
      if (target && target !== button && !checked) {
        selected = null;
        chooseWord(word);
        if (selected === word) chooseWord(target.dataset.word);
      }
    });
    for (const type of ["pointercancel", "lostpointercapture"]) button.addEventListener(type, event => {
      if (wordGesture?.id === event.pointerId) cancelWordDrag();
    });
    board.append(button);
  });
}

function measureLinkLabels() {
  return connections.map(([, , label]) => {
    if (!label) return null;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.classList.add("connection-label");
    svg.append(text);
    const measure = (value) => {
      text.textContent = value;
      return text.getComputedTextLength?.() || value.length * 7;
    };
    let lines = [label];
    const words = label.split(/\s+/);
    if (measure(label) > 110 && words.length > 1) {
      let best = Infinity;
      for (let split = 1; split < words.length; split++) {
        const candidate = [words.slice(0, split).join(" "), words.slice(split).join(" ")];
        const width = Math.max(...candidate.map(measure));
        if (width < best) { lines = candidate; best = width; }
      }
    }
    return { width: Math.ceil(Math.max(...lines.map(measure))) + 8, height: lines.length * 14 + 6, lines };
  });
}

function applyLayout(layout) {
  boardWrap.style.width = `${layout.width}px`;
  boardWrap.style.height = `${layout.height}px`;
  layout.nodes.forEach((node) => positions.set(node.id, [node.x / layout.width * 100, node.y / layout.height * 100]));
}

function arrangeWeb(expansions = new Map(), bounds = { width: boardWrap.clientWidth, height: boardWrap.clientHeight }) {
  flowDirection = viewport.clientWidth >= viewport.clientHeight ? "horizontal" : "vertical";
  const layout = WebLayout.flowLayout(measureNodes(), connections, bounds.width, bounds.height,
    { ...layoutSettings, direction: flowDirection, labelSizes, expansions });
  flowNodes = new Map(layout.nodes.map((node) => [node.id, node]));
  applyLayout(layout);
}

function tryPuzzleLayout() {
  if (layoutMode !== "puzzle" || !puzzle.layout?.type) return false;
  const nodes = measureNodes(), width = viewport.clientWidth, height = viewport.clientHeight;
  const baseline = { nodes, width: boardWrap.clientWidth, height: boardWrap.clientHeight };
  const baselineRoutes = cachedRoutes;
  const fit = (layout, routes = []) => {
    const rects = [...layout.nodes.map((n) => WebLayout.box(n, 8)), ...routes.flatMap((r) => [
      ...r.points.map((p) => ({ left: p.x - 3, right: p.x + 3, top: p.y - 3, bottom: p.y + 3 })), ...(r.label ? [r.label] : [])])];
    return Math.min((width - 24) / (Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left))),
      (height - 24) / (Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top))));
  };
  const types = [...new Set([puzzle.layout.type, ...(puzzle.layout.alternatives || [])])];
  const minimumFit = fit(baseline, baselineRoutes), candidates = [];
  for (const type of types) for (const spacingScale of [1, 1.25, 1.5]) {
    const layout = WebLayout.themedLayout(type, nodes, connections, width, height, { ...layoutSettings, labelSizes, spacingScale });
    if (layout && fit(layout) >= minimumFit) candidates.push({ layout, upperFit: fit(layout) });
  }
  candidates.sort((a, b) => b.upperFit - a.upperFit);
  let chosen = null;
  // Routing is the costly part: examine only the four most promising shapes.
  for (const { layout, upperFit } of candidates.slice(0, 4)) {
    if (chosen && upperFit <= chosen.fit) break;
    const routes = WebLayout.routeAll(layout.nodes, connections, layout.width, layout.height, { labelSizes });
    if (WebLayout.layoutProblems(layout.nodes, connections, routes, { ...layoutSettings, labelSizes }).length) continue;
    const actualFit = fit(layout, routes);
    if (actualFit >= minimumFit && (!chosen || actualFit > chosen.fit)) chosen = { layout, routes, fit: actualFit };
  }
  if (chosen) {
    flowNodes = new Map(chosen.layout.nodes.map((node) => [node.id, node]));
    flowDirection = undefined;
    applyLayout(chosen.layout);
    cachedRoutes = chosen.routes;
    activeLayout = chosen.layout.type;
    return true;
  }
  return false;
}

function chooseWord(word) {
  if (checked) return;
  if (puzzleLabels().length && !selectedLabel) {
    labelStatus.textContent = "Choose a connector before selecting words";
    return;
  }
  if (!selected) {
    toySound("select");
    selected = word;
    if (selectedLabel) labelStatus.textContent = `${word} ${selectedLabel} → choose a destination`;
  } else if (selected === word) {
    selected = null;
    if (selectedLabel) labelStatus.textContent = "Choose the source word, then the destination";
  } else {
    const pair = key(selected, word);
    const existing = connections.findIndex((item) => key(item[0], item[1]) === pair);
    if (existing >= 0) connections.splice(existing, 1);
    else connections.push([selected, word, selectedLabel]);
    toySound(existing >= 0 ? "remove" : "connect");
    saveProgress(1);
    selected = null;
    if (selectedLabel) labelStatus.textContent = "Arrow added. Select its label to change the connector, or choose a source word.";
    update(true);
    return;
  }
  update();
}

function roundedPath(points) {
  if (points.length < 3) return `M ${points[0].x} ${points[0].y} L ${points.at(-1).x} ${points.at(-1).y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const previous = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const beforeLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const afterLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const radius = Math.min(10, beforeLength / 2, afterLength / 2);
    const before = { x: corner.x + ((previous.x - corner.x) / beforeLength) * radius, y: corner.y + ((previous.y - corner.y) / beforeLength) * radius };
    const after = { x: corner.x + ((next.x - corner.x) / afterLength) * radius, y: corner.y + ((next.y - corner.y) / afterLength) * radius };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = points.at(-1);
  return `${path} L ${last.x} ${last.y}`;
}

function measureNodes() {
  return [...board.querySelectorAll(".word-node")].map((node) => {
    const [x, y] = positions.get(node.dataset.word);
    return { id: node.dataset.word, x: x * boardWrap.clientWidth / 100, y: y * boardWrap.clientHeight / 100, width: node.offsetWidth, height: node.offsetHeight };
  });
}

function expandBoard() {
  const degree = new Map(puzzle.words.map((word) => [word, 0]));
  connections.forEach(([a, b]) => { degree.set(a, degree.get(a) + 1); degree.set(b, degree.get(b) + 1); });
  const linkedCount = [...degree.values()].filter(Boolean).length;
  const extraLinks = Math.max(0, connections.length - linkedCount + 1);
  const maxDegree = Math.max(0, ...degree.values());
  boardWrap.style.width = `${Math.max(viewport.clientWidth, connections.length ? Math.min(1400, 600 + linkedCount * 28 + extraLinks * 34) : 0)}px`;
  const scatterColumns = Math.max(1, Math.floor((viewport.clientWidth - 76) / 142));
  const scatterRows = Math.ceil(puzzle.words.length / scatterColumns);
  // Give larger word sets a taller opening canvas so collision resolution can
  // separate long labels without squeezing the words into a compact cluster.
  const scatterHeight = Math.max(480, scatterRows * 104 + 80);
  viewport.style.height = connections.length
    ? ""
    : `${Math.min(680, Math.max(520, 440 + scatterRows * 32))}px`;
  boardWrap.style.height = `${connections.length ? Math.max(scatterHeight, Math.min(1120, 420 + maxDegree * 16 + extraLinks * 24)) : scatterHeight}px`;
  board.querySelectorAll('.word-node').forEach((node) => {
    const count = degree.get(node.dataset.word);
    node.style.minWidth = count > 2 ? `${110 + count * 7}px` : '';
    node.style.minHeight = count > 2 ? `${38 + count * 4}px` : '';
  });
}

function contentBounds() {
  // Include complete buttons (plus shadows/focus rings) and every route bend.
  // Rounded curves lie inside the envelope of their control points.
  const rects = measureNodes().map((node) => ({
    left: node.x - node.width / 2 - 8, right: node.x + node.width / 2 + 8,
    top: node.y - node.height / 2 - 8, bottom: node.y + node.height / 2 + 8,
  }));
  cachedRoutes.forEach((route) => {
    route.points.forEach((point) => rects.push({ left: point.x - 3, right: point.x + 3, top: point.y - 3, bottom: point.y + 3 }));
    if (route.label) rects.push(route.label);
  });
  if (!rects.length) return { left: 0, top: 0, right: boardWrap.clientWidth, bottom: boardWrap.clientHeight };
  return {
    left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)),
    top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)),
  };
}

function fitScale() {
  const bounds = contentBounds();
  return Math.min(Math.max(1, viewport.clientWidth - 24) / Math.max(1, bounds.right - bounds.left), Math.max(1, viewport.clientHeight - 24) / Math.max(1, bounds.bottom - bounds.top));
}

function maxZoom() { return Math.max(4, 1 / fitScale()); }

function applyCamera() {
  hidePreview();
  const bounds = contentBounds();
  const width = (bounds.right - bounds.left) * camera.scale;
  const height = (bounds.bottom - bounds.top) * camera.scale;
  camera.x = width <= viewport.clientWidth - 24 + 0.001
    ? (viewport.clientWidth - width) / 2 - bounds.left * camera.scale
    : Math.max(viewport.clientWidth - 12 - bounds.right * camera.scale, Math.min(12 - bounds.left * camera.scale, camera.x));
  camera.y = height <= viewport.clientHeight - 24 + 0.001
    ? (viewport.clientHeight - height) / 2 - bounds.top * camera.scale
    : Math.max(viewport.clientHeight - 12 - bounds.bottom * camera.scale, Math.min(12 - bounds.top * camera.scale, camera.y));
  boardWrap.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
  viewport.classList.toggle('zoomed', camera.zoom > 1.001);
  document.querySelector('#zoom-level').textContent = `${Math.round(camera.scale * 100)}%`;
  document.querySelector('#zoom-out').disabled = camera.zoom <= 1.001;
  document.querySelector('#zoom-in').disabled = camera.zoom >= maxZoom() - 0.001;
}

function fitView() {
  camera.zoom = 1;
  camera.scale = fitScale();
  const bounds = contentBounds();
  camera.x = viewport.clientWidth / 2 - (bounds.left + bounds.right) / 2 * camera.scale;
  camera.y = viewport.clientHeight / 2 - (bounds.top + bounds.bottom) / 2 * camera.scale;
  applyCamera();
}

function zoomView(multiplier) {
  const oldScale = camera.scale;
  camera.zoom = Math.max(1, Math.min(maxZoom(), camera.zoom * multiplier));
  camera.scale = fitScale() * camera.zoom;
  // Keep the point beneath the viewport center stationary as the scale changes.
  camera.x = viewport.clientWidth / 2 - (viewport.clientWidth / 2 - camera.x) * camera.scale / oldScale;
  camera.y = viewport.clientHeight / 2 - (viewport.clientHeight / 2 - camera.y) * camera.scale / oldScale;
  applyCamera();
}

// Zoom and pan affect the whole drawing, preserving word/link alignment.
document.querySelector('#zoom-in').addEventListener('click', () => zoomView(1.25));
document.querySelector('#zoom-out').addEventListener('click', () => zoomView(0.8));
document.querySelector('#fit-view').addEventListener('click', fitView);
viewport.addEventListener('pointerdown', (event) => {
  if (camera.zoom <= 1 || event.button !== 0 || event.isPrimary === false || event.target.closest('.word-node')) return;
  panGesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('panning');
  event.preventDefault();
});
viewport.addEventListener('pointermove', (event) => {
  if (!panGesture || panGesture.id !== event.pointerId) return;
  camera.x += event.clientX - panGesture.x;
  camera.y += event.clientY - panGesture.y;
  panGesture.x = event.clientX;
  panGesture.y = event.clientY;
  applyCamera();
});
function endPan(event) {
  if (!panGesture || panGesture.id !== event.pointerId) return;
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  panGesture = null;
  viewport.classList.toggle('panning', false);
}
viewport.addEventListener('pointerup', endPan);
viewport.addEventListener('pointercancel', endPan);
viewport.addEventListener('lostpointercapture', () => {
  panGesture = null;
  viewport.classList.toggle('panning', false);
});
viewport.addEventListener('keydown', (event) => {
  if (event.target !== viewport) return;
  const moves = { ArrowLeft: [48, 0], ArrowRight: [-48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] };
  if (moves[event.key]) {
    event.preventDefault();
    const [dx, dy] = moves[event.key];
    camera.x += dx; camera.y += dy; applyCamera();
  } else if (['+', '=', '-', 'Home'].includes(event.key) || (event.key === '0' && puzzleLabels().length < 10)) {
    event.preventDefault();
    if (event.key === 'Home' || event.key === '0') fitView();
    else zoomView(event.key === '-' ? 0.8 : 1.25);
  }
});
viewport.addEventListener('focusin', (event) => {
  const word = event.target.dataset?.word;
  if (!word || camera.zoom <= 1) return;
  const node = measureNodes().find((item) => item.id === word);
  const left = camera.x + (node.x - node.width / 2) * camera.scale;
  const top = camera.y + (node.y - node.height / 2) * camera.scale;
  const right = left + node.width * camera.scale;
  const bottom = top + node.height * camera.scale;
  camera.x += left < 12 ? 12 - left : right > viewport.clientWidth - 12 ? viewport.clientWidth - 12 - right : 0;
  camera.y += top < 12 ? 12 - top : bottom > viewport.clientHeight - 12 ? viewport.clientHeight - 12 - bottom : 0;
  applyCamera();
});

function drawConnections() {
  svg.setAttribute("viewBox", `0 0 ${boardWrap.clientWidth} ${boardWrap.clientHeight}`);
  svg.replaceChildren();
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  for (const [id, color] of [["arrow", "#91aa85"], ["arrow-correct", "#43835c"], ["arrow-missed", "#c88d72"]]) {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    for (const [name, value] of Object.entries({ id, viewBox: "0 0 10 10", refX: "10", refY: "5", markerWidth: "9", markerHeight: "9", markerUnits: "userSpaceOnUse", orient: "auto" })) marker.setAttribute(name, value);
    const tip = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tip.setAttribute("d", "M 0 0 L 10 5 L 0 10 Z");
    tip.setAttribute("fill", color);
    marker.append(tip); defs.append(marker);
  }
  svg.append(defs);
  cachedRoutes.forEach(({ edge, words: [a, b], points, label: placement }) => {
    const playerLink = connections.find((item) => key(item[0], item[1]) === key(a, b));
    const d = roundedPath(points);
    const halo = document.createElementNS("http://www.w3.org/2000/svg", "path");
    halo.setAttribute("d", d);
    halo.classList.add("connection-halo");
    svg.append(halo);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", d);
    line.classList.add("connection-line");
    line.dataset.pair = key(a, b);
    const correct = checked && expectedKeys().has(expectedConnectionKey(playerLink?.[0], playerLink?.[1], playerLink?.[2]));
    if (checked) line.classList.add(correct ? "correct-line" : "missed-line");
    line.setAttribute("marker-end", `url(#${checked ? correct ? "arrow-correct" : "arrow-missed" : "arrow"})`);
    svg.append(line);

    const label = playerLink?.[2];
    if (label && placement) {
      if (placement.leader) {
        const leader = document.createElementNS("http://www.w3.org/2000/svg", "path");
        leader.setAttribute("d", roundedPath(placement.leader));
        leader.classList.add("label-leader");
        svg.append(leader);
      }
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.classList.add("connection-label");
      text.setAttribute("x", placement.x);
      text.setAttribute("y", placement.y);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.textContent = label;
      const lines = labelSizes[edge]?.lines || [label];
      if (lines.length > 1) {
        const spans = lines.map((value, index) => {
          const span = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          span.setAttribute("x", placement.x);
          span.setAttribute("dy", index === 0 ? -(lines.length - 1) * 7 : 14);
          span.textContent = value;
          return span;
        });
        text.replaceChildren(...spans);
      }
      const sentence = `${playerLink[0]} ${label} ${playerLink[1]}`;
      text.setAttribute("tabindex", "0");
      text.setAttribute("role", "img");
      text.setAttribute("aria-label", sentence);
      text.dataset.pair = key(a, b);
      if (!checked && puzzleLabels().length) {
        text.setAttribute("role", "button");
        text.setAttribute("aria-label", `${sentence}. Change connector`);
        text.setAttribute("aria-haspopup", "listbox");
        text.setAttribute("aria-controls", "connector-menu");
        text.setAttribute("aria-expanded", "false");
        text.classList.add("editable-connector");
        text.addEventListener("pointerdown", (event) => event.stopPropagation());
        text.addEventListener("click", (event) => {
          event.stopPropagation();
          editConnector(playerLink, text);
        });
        text.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            editConnector(playerLink, text);
          }
        });
      }
      bindPreview(text, sentence, playerLink.slice(0, 2));
      svg.append(text);
    }
  });
}

function expectedConnectionKey(a, b, label) {
  // Direction and connector both carry meaning for authored labeled links.
  return label ? `${a}>${b}|${label}` : key(a, b);
}

function update(relayout = false) {
  hidePreview();
  if (relayout) {
    expandBoard();
    labelSizes = measureLinkLabels();
    activeLayout = "flowchart";
    if (connections.length) {
      const bounds = { width: boardWrap.clientWidth, height: boardWrap.clientHeight };
      const expansions = new Map();
      // Retry only regions touched by missing labels/routes or shared lanes.
      // A busy branch must not widen unrelated groups or simple layers.
      for (let attempt = 0; attempt < 6; attempt++) {
        arrangeWeb(expansions, bounds);
        cachedRoutes = WebLayout.routeAll(measureNodes().map((node) => ({ ...flowNodes.get(node.id), ...node })), connections, boardWrap.clientWidth, boardWrap.clientHeight,
          { direction: flowDirection, labelSizes });
        const visible = new Set(cachedRoutes.map((route) => route.edge));
        const problems = new Set(connections.map((_, edge) => edge).filter((edge) => !visible.has(edge)));
        cachedRoutes.forEach((route, i) => {
          if (labelSizes[route.edge] && !route.label) problems.add(route.edge);
          cachedRoutes.slice(i + 1).forEach((other) => {
            if (WebLayout.hasSharedLanes([route, other])) { problems.add(route.edge); problems.add(other.edge); }
          });
        });
        if (!problems.size) break;
        const regions = new Set();
        problems.forEach((edge) => {
          const [a, b] = connections[edge].slice(0, 2).map((word) => flowNodes.get(word));
          // Long arrows cross several channels, including the destination's
          // entry channel. Expanding only the source leaves crowded inputs stuck.
          for (let rank = Math.min(a.layer, b.layer); rank < Math.max(a.layer, b.layer); rank++) {
            regions.add(`${a.group}:channel:${rank}`);
          }
          if (attempt >= 2) {
            regions.add(`${a.group}:layer:${a.layer}`);
            regions.add(`${b.group}:layer:${b.layer}`);
          }
        });
        regions.forEach((region) => expansions.set(region, (expansions.get(region) || 1) * 1.5));
      }
      tryPuzzleLayout();
    } else if (!connections.length) {
      resolveLayout();
      const nodes = WebLayout.optimize(measureNodes(), connections, boardWrap.clientWidth, boardWrap.clientHeight, layoutSettings);
      applyLayout(WebLayout.separateWords(nodes, boardWrap.clientWidth, boardWrap.clientHeight, layoutSettings.wordGap));
      cachedRoutes = [];
    }
  }
  board.querySelectorAll(".word-node").forEach((node) => {
    const word = node.dataset.word;
    const [x, y] = positions.get(word);
    node.style.left = `${x}%`;
    node.style.top = `${y}%`;
    node.classList.toggle("selected", word === selected);
    node.classList.toggle("connected", connections.some((pair) => pair.includes(word)));
    node.setAttribute("aria-pressed", String(word === selected));
    node.classList.toggle("graded", checked);
  });
  layoutStatus.hidden = !puzzle.layout;
  const shapeNames = { serpentine: "Serpentine", radial: "Radial branches", circular: "Circular", clustered: "Clustered", anatomical: "Anatomical tree" };
  layoutStatus.textContent = !connections.length ? "Add links to build your puzzle layout."
    : activeLayout !== "flowchart" ? `${shapeNames[activeLayout]} layout · follow the arrows${activeLayout === "serpentine" ? " across alternating rows" : ""}.`
    : layoutMode === "flowchart" ? "Flowchart layout." : "Flowchart layout keeps this web clear at the current viewport size.";
  count.textContent = connections.length;
  drawConnections();
  highlightPathway();
  if (relayout) fitView();
}

document.querySelector("#reset-button").addEventListener("click", () => {
  cancelWordDrag();
  clearPathway();
  connections = [];
  selected = null;
  checked = false;
  labelStatus.textContent = selectedLabel
    ? "Choose the source word, then the destination"
    : "Choose a connector, then its source and destination";
  scatterWords();
  result.hidden = true;
  document.querySelector("#check-button").disabled = false;
  update(true);
});

document.querySelector("#check-button").addEventListener("click", () => {
  cancelWordDrag();
  if (!connections.length) {
    toySound("retry");
    result.textContent = "Make a few connections first, then check your web.";
    result.className = "result gentle";
    result.hidden = false;
    showResult();
    return;
  }
  checked = true;
  const expected = expectedKeys();
  const hitRelations = new Set(connections
    .filter(([a, b, label]) => expected.has(expectedConnectionKey(a, b, label)))
    .map(([a, b, label]) => label ? `${a}>${b}` : key(a, b)));
  const expectedRelations = expectedRelationKeys();
  const hits = [...hitRelations].filter((answer) => expectedRelations.has(answer)).length;
  const missed = expectedRelations.size - hits;
  const score = Math.round((hits / expectedRelations.size) * 100);
  const perfect = hits === expectedRelations.size && connections.every(([a, b, label]) => expected.has(expectedConnectionKey(a, b, label)));
  saveProgress(perfect ? 3 : 2);
  toySound(perfect ? "perfect" : "retry");
  result.innerHTML = `<strong>${score}% of the hidden web found</strong><span>${hits} meaningful connections · ${missed} more to discover</span>`;
  result.className = `result ${score >= 60 ? "success" : "keep-going"}`;
  result.hidden = false;
  document.querySelector("#check-button").disabled = true;
  update();
  preparePathway();
  showResult();
});

let resizeFrame;
window.addEventListener("resize", () => {
  if (pathwayPosition && !pathwayPanel.hidden) movePathway(pathwayPosition.x, pathwayPosition.y);
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => update(true));
});
scatterWords();
renderWords();
renderLabels();
update(true);
if (document.fonts) document.fonts.ready.then(() => update(true));
