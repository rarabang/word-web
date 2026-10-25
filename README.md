# Word Web

A small browser game about finding direct relationships between words.

Words begin in a shuffled scatter. As players draw links, connected words form
directed layers, and separate connected groups become small islands. The first
word selected is the source; an arrowhead points to the second word selected.
Press 1–9 to choose connectors in the displayed order, or 0 for the tenth.
Drag from a source word onto a destination to connect them with the selected
connector, or click/tap the two words in order. A temporary line and destination
highlight guide dragging with a mouse, touch, or pen. Repeat a linked pair to
remove it; drop on empty space or press Escape to cancel.
Number shortcuts work outside form fields and clear the current source selection
just like clicking a connector. Words with no links
occupy a separate shelf outside those groups. The arrangement uses only player-created links, so it does not
preview the puzzle's answer key.

## Run locally

With Python 3 installed, run `npm start` in this directory, then visit [http://localhost:8000](http://localhost:8000).

You can also run `python3 -m http.server 8000` directly. No package installation is needed.

## Project files

- `index.html` contains the page structure.
- `styles.css` controls the layout and visual styling.
- `puzzles.js` contains puzzle content; `game.js` contains game interaction.
- `web-layout.js` handles crossing reduction, individual link endpoints, and obstacle-aware routing.

To add a puzzle, add an object to `window.WORD_WEB_PUZZLES` in `puzzles.js`. Each puzzle has a category, a title, a list of words, a short `labels` list, and direct links in `links`. A link uses `{ words: ["first", "second"], label: "connector" }`; keep the word order meaningful because connectors like “feeds” read from the first word to the second. Use **Change puzzle** above the board to switch puzzles; changing puzzles clears the current web.

The label rules are documented beside the data in `puzzles.js`: keep choices short and distinct, avoid catch-all labels, and give each answer pair one best-fit label. Give a label a plain meaning test when adding it, then check that its examples remain distinct from the other choices. The game grades both the ordered word pair and its selected label.

The **DIGESTIVE SYSTEM** collection contains 14 focused puzzles, each with
12–26 terms, covering the system overview, oral cavity and saliva, teeth,
oropharynx, esophagus, stomach structure, gastric secretions, small intestine
regions, intestinal histology, pancreas and hormones, liver and bile pathways,
colon, rectum, and anal sphincters. All 218 original terms and 274 relationships
are preserved; shared terms and a few anchor links repeat where needed to keep
each puzzle self-contained. Each puzzle offers only the connectors it uses.
Anatomy references and scope notes sit beside the puzzle data.

## Layout and readability

Each puzzle declares a preferred shape and optional alternatives, for example
`layout: { type: "radial", alternatives: ["clustered"] }`. Supported themes are:

- **Serpentine:** alternating rows for long sensory and motor pathways.
- **Radial:** a central hub with outward branches for concept maps and muscle groups.
- **Circular:** terms around a perimeter for compact bone networks; only player-created arrows appear, so a circle does not imply a closed cycle.
- **Clustered:** connected neighbors pull together in compact groups.
- **Anatomical tree:** an upright backbone with side branches for skeleton and layer puzzles.
- **Flowchart:** directed layers, available as the fallback and a manual choice.

Puzzle layout compares the measured word and label sizes with the viewport,
then checks the most promising candidates. A shape is accepted only when every
route and required label fits, words and labels remain clear, endpoints remain
attached, lanes are separate, and its actual Fit scale is at least as readable
as the fully routed flowchart. This can select different shapes on wide and
narrow screens. The status beneath the layout selector identifies the active shape.

Use **Puzzle layout / Flowchart** to compare layouts without losing connections
or grading. Shapes and their internal groups use only player-created links;
they never use the answer key or reveal unseen connections in the opening scatter.
An anatomical tree follows the discovered graph rather than fixed bone positions.

In the flowchart, groups are sized from their actual pills. Connected words
are arranged with sources before destinations, with parallel branches sharing
a layer. Wide boards flow left to right; tall boards flow top to bottom. Cycles
retain their arrow direction and return through lanes outside their group.
Branch-ordering sweeps reduce crossings and keep related siblings together.
A further pass shortens total connection travel while preserving direction,
layer membership, and word clearance. Extra port spacing is reserved beside busy
words, so quiet peers in the same layer can stay compact. The freeform optimizer is used only for the opening scatter.
Separate islands and unconnected words pack into rows outside one another's
routing space. Returning arrows and links spanning several layers reserve
outside corridors. Each layer uses its own port requirements and each
channel uses its own measured labels. Non-overlapping branch intervals can
reuse a lane. Words align with their neighbors, keeping simple chains straight.
Each link gets a separate attachment point on its word buttons, preferring the
flow direction. Staggered exits give busy branches distinct lanes. Returning
links attach on the outside edge of the group. Earlier routes are reconsidered
against the completed web, including links that share a hub.

Long word buttons wrap within a maximum width, and long connector phrases wrap onto two lines.
Hover over a word or connector, or focus it with the keyboard, for a larger preview
that stays readable at any board zoom. Connector previews show the complete sentence
and highlight its endpoints. Press Escape to dismiss the preview.

Busy words and dense webs receive more space. Connected layouts reserve at least
48 px between word bounding boxes without a later pass displacing their layers.
Routes avoid word rectangles with 12 px padding. Connector labels use measured
SVG text widths and clear positions beside straight segments. Later routes avoid
placed label boxes, and labels avoid words, routes, and one another. A short
leader identifies a connector when its label needs a larger offset. If links or
labels do not all fit or routes share a lane, the layout retries by widening
only the affected channels, then the affected layers when needed. Other groups
keep their original spacing.
Forming links retains the opening canvas's height.
The drawing automatically scales to fit the viewing area after each layout
change, resize, or reset, keeping all words
and links visible. Fit uses the bounds of the buttons, routed links, and connector labels, excluding
empty board space, and chooses the largest scale with a 12 px viewing margin.
Small webs can be enlarged beyond 100%. Use + / − to zoom and drag the background to pan for detail;
**Fit web** restores the complete view. Use W/A/S/D to pan up/left/down/right, including
while a word or connector has focus. Hold a key to keep moving; shortcuts ignore
form fields and Ctrl/Command/Alt combinations. Keyboard users can focus the board and use
+ / − to zoom, arrow keys to pan, and Home to fit (0 also fits when there is no tenth connector). Tabbing to a word brings it
into view when zoomed. Reset returns to a fresh scatter. Position changes and link routes update together so
links stay attached. Dense graphs can still require crossings; a small gap marks
where one route passes over another.

Run `npm test` for geometry and game-state checks. These cover crossing reduction,
directed branches, cycle routing, arrow rendering and grading, word clearance
across all authored puzzles, oversized pills, separate lanes
around hubs, a fully connected eight-word web, branch ordering, layer alignment,
all authored connector labels in both orientations, board expansion, automatic
fitting, zoom, pan, resizing, and reset. They do not exercise browser rendering.

## Progress and pathway playback

The puzzle dropdown shows ○ New, ◐ Incomplete (connections attempted),
✓ Complete (checked with an imperfect result), or ★ Perfect (all relationships
found with no incorrect links). The best badge is saved in this browser and
survives resets. If browser storage is unavailable, badges last for the session.
Changing puzzles still clears the current web.

After checking, Follow the pathway walks through correct player-created links,
following outgoing arrows where possible and starting new branches as needed.
Each step highlights its endpoints and arrow and displays source → connector →
destination. Use Play/Pause, Next connection, and Replay to control playback.
Missing answers are not revealed. Reduced-motion preferences disable the
moving arrow effect.

## Sound effects

Toy Box sounds add wooden taps for selections, xylophone plinks for connections,
a gentle descending squeak when a checked web needs more work, and a rising
melody for a perfect puzzle. Pathway playback uses a quiet note per step.
Use **Sound on / Sound off** beside Start over; the preference is saved in this
browser. Sounds are synthesized locally with Web Audio after interaction,
with no audio downloads. Browsers without Web Audio remain fully playable.

## Appearance

Use **Appearance** in the footer to select Light, Dark, or System. System follows
 your device's color preference, including changes while the page is open. The
choice is saved in this browser; if storage is unavailable it lasts until reload.
Dark mode uses pure black for the page and board, with dark word buttons,
soft ivory text, and sage connections.
