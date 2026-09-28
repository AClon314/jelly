// --------------------------------------------------------------------------- A1/A2
//
// A1: highlight the edges incident to the selected node(s).
// A2: for neighbours that are outside the viewport, show a bubble clamped to the
//     viewport edge with an arrow pointing at the node ("off-screen enemy indicator").
//
// Deliberate limits of this draft (see tmp/oh-my-jelly-0928.md §A2):
//   - 1 hop only; recursing would make the sector count meaningless
//   - one bubble per 45° screen sector (8 max), so there is no separate cap/overflow chip
//   - bubbles are not inset around the control panels, they only sit *below* them
//     in z-order, so an edge bubble can visually overlap a panel
const OFFSCREEN_MARGIN = 24; // px: a node counts as off-screen once it is this far out
const OFFSCREEN_SECTORS = 8; // 8 x 45° sectors around the viewport centre
const BUBBLE_GAP = 92;       // px: minimum spacing between bubbles on the same edge
const HALF_W = 44;           // px: half of .offbubble's width (see the CSS)
const HALF_H = 11;           // px: half of .offbubble's height

const bubbles = new Map();   // sector index -> {el, arrow, label}
let offscreenScheduled = false;

// Sector k spans angles [-180 + k*45, -180 + (k+1)*45) degrees; its representative
// direction is the midpoint -180 + (k + .5)*45. atan2() returns [-π, π], so shifting
// by π maps it onto [0, 2π) and the sector boundaries stay axis-aligned.
const SECTOR_RAD = (Math.PI * 2) / OFFSCREEN_SECTORS;
const sectorOf = (dx, dy) =>
  Math.floor((Math.atan2(dy, dx) + Math.PI) / SECTOR_RAD) % OFFSCREEN_SECTORS;
const sectorAngle = (k) => -Math.PI + (k + 0.5) * SECTOR_RAD;

function refreshIncidentEdges() {
  cy.edges().removeClass('incident incident-in incident-out');
  const sel = cy.$('node:selected');
  if (sel.empty())
    return;
  // `:visible` skips nodes hidden by expand-collapse: they live inside the plugin
  // (not in cy.elements()), and removing/highlighting them is meaningless.
  sel.connectedEdges().filter(':visible').forEach(e => {
    e.addClass('incident');
    e.addClass(e.source().selected() ? 'incident-out' : 'incident-in');
  });
}

function offscreenNeighbours() {
  const sel = cy.$('node:selected');
  if (sel.empty())
    return [];
  return sel.connectedEdges().connectedNodes().difference(sel).filter(':visible');
}

function bubbleFor(key) {
  let b = bubbles.get(key);
  if (!b) {
    const el = document.createElement('div');
    el.className = 'offbubble';
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '\u27A4';
    const label = document.createElement('span');
    label.className = 'label';
    el.append(arrow, label);
    b = {el, arrow, label};
    bubbles.set(key, b);
    document.getElementById('offscreen').append(el);
  }
  return b;
}

function updateOffscreen() {
  // Early out before touching layout: 'render' fires every frame while panning, and
  // getBoundingClientRect() is not free.
  if (bubbles.size === 0 && cy.$('node:selected').empty())
    return;
  const box = cy.container().getBoundingClientRect();
  const w = box.width, h = box.height;
  const cx = w / 2, cyc = h / 2;

  // Group the off-screen neighbours by screen sector (45° each around the centre).
  const groups = new Map(); // sector index -> [{n, p}]
  for (const n of offscreenNeighbours()) {
    const p = n.renderedPosition();
    if (p.x >= OFFSCREEN_MARGIN && p.x <= w - OFFSCREEN_MARGIN &&
        p.y >= OFFSCREEN_MARGIN && p.y <= h - OFFSCREEN_MARGIN)
      continue;
    const k = sectorOf(p.x - cx, p.y - cyc);
    if (!groups.has(k))
      groups.set(k, []);
    groups.get(k).push({n, p});
  }
  const placed = [];

  // One bubble per non-empty sector, aimed at the sector midpoint. Only 8 directions
  // exist, so they cannot pile up the way per-neighbour bubbles did.
  for (const [k, members] of groups) {
    // Deterministic order: the single-node label and the fit target must not flicker
    // while panning when a sector's membership changes.
    members.sort((a, b) => a.n.id().localeCompare(b.n.id()));
    const angle = sectorAngle(k);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    // Ray/box exit point: the smallest fraction along (dx,dy) that leaves the inset box,
    // and which edge that lands on.
    const scaleX = (cx - OFFSCREEN_MARGIN) / Math.max(Math.abs(dx), 1e-6);
    const scaleY = (cyc - OFFSCREEN_MARGIN) / Math.max(Math.abs(dy), 1e-6);
    let lane, along, x, y;
    if (scaleX <= scaleY) {
      lane = dx > 0 ? 'right' : 'left';
      x = dx > 0 ? w - OFFSCREEN_MARGIN : OFFSCREEN_MARGIN;
      y = cyc + dy * scaleX;
      along = y;
    } else {
      lane = dy > 0 ? 'bottom' : 'top';
      y = dy > 0 ? h - OFFSCREEN_MARGIN : OFFSCREEN_MARGIN;
      x = cx + dx * scaleY;
      along = x;
    }
    placed.push({k, members, dx, dy, lane, along, x, y});
  }

  // Sectors that went off-screen; drop their (keyed) DOM nodes so nothing lingers.
  const keep = new Set(placed.map(it => it.k));
  for (const [key, b] of bubbles)
    if (!keep.has(key)) {
      b.el.remove();
      bubbles.delete(key);
    }

  // Neighbours in similar directions land on the same edge and would pile up, so push
  // them apart along that edge (1-D, order preserving) and then re-centre the run.
  for (const lane of ['left', 'right', 'top', 'bottom']) {
    const list = placed.filter(it => it.lane === lane);
    if (list.length < 2)
      continue;
    const vertical = lane === 'left' || lane === 'right';
    const size = vertical ? h : w;
    // Keep the whole pill inside the edge, not just its anchor point.
    const half = vertical ? HALF_H : HALF_W;
    const lo = OFFSCREEN_MARGIN + half, hi = size - OFFSCREEN_MARGIN - half;
    for (const it of list)
      it.along = Math.min(Math.max(it.along, lo), hi);
    list.sort((a, b) => a.along - b.along);
    // Spread around the original mean with a gap that always fits: shifting the whole
    // run after pushing it apart does not work (the two corrections cancel out when the
    // run is longer than the edge, which is exactly when it matters).
    const gap = Math.min(BUBBLE_GAP, (hi - lo) / Math.max(list.length - 1, 1));
    const mean = list.reduce((sum, it) => sum + it.along, 0) / list.length;
    const start = Math.min(Math.max(mean - gap * (list.length - 1) / 2, lo), hi - gap * (list.length - 1));
    list.forEach((it, i) => {
      it.along = start + gap * i;
    });
  }

  for (const it of placed) {
    const {k, members, dx, dy, lane, along} = it;
    const b = bubbleFor(k);
    b.el.className = `offbubble lane-${lane}`;
    b.el.style.left = `${lane === 'left' || lane === 'right' ? it.x : along}px`;
    b.el.style.top = `${lane === 'top' || lane === 'bottom' ? it.y : along}px`;
    b.arrow.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
    // node.data('name') is "<name> <line>:<col>:<endLine>:<endCol>"; the location is
    // noise in a bubble this small, so labels use the bare name and the tooltip
    // carries the full identity of every node in the sector.
    const names = members.map(m => (m.n.data('name') ?? '').split(' ')[0]);
    b.label.textContent = members.length === 1 ? names[0] : `${members.length} nodes`;
    const fullNames = members.map(m => m.n.data('fullName') ?? m.n.data('name') ?? '');
    b.el.title = fullNames.slice(0, 8).join(', ') + (fullNames.length > 8 ? ' \u2026' : '');
    if (members.length === 1) {
      const n = members[0].n;
      b.el.onclick = () => {
        const zoom = cy.zoom();
        const pos = n.position();
        cy.animate({pan: {x: w / 2 - pos.x * zoom, y: h / 2 - pos.y * zoom}, duration: 250});
      };
    } else {
      // Fit the whole sector at once so "5 nodes" is directly inspectable.
      const eles = cy.collection(members.map(m => m.n));
      b.el.onclick = () => {
        cy.animate({fit: {eles, padding: 60}, duration: 250});
      };
    }
  }
}

function scheduleOffscreen() {
  if (offscreenScheduled)
    return;
  offscreenScheduled = true;
  requestAnimationFrame(() => {
    offscreenScheduled = false;
    updateOffscreen();
  });
}

cy.on('select', e => {
  document.getElementById("msg").textContent = e.target?.data()?.fullName ?? '';
  refreshIncidentEdges();
  scheduleOffscreen();
});
cy.on('unselect', () => {
  document.getElementById("msg").textContent = '';
  refreshIncidentEdges();
  scheduleOffscreen();
});
// Pan/zoom/layout animation all go through 'render'; rAF-throttled, so this is cheap.
cy.on('render', scheduleOffscreen);

// --------------------------------------------------------------------------- right-drag pan
//
// Right-button drag pans the canvas, the same gesture as left-dragging blank space.
// Cytoscape (and cytoscape-panzoom) only wire up button 0 for pan/grab gestures, so
// this is a small native-DOM shim on the container:
//   - `contextmenu` is swallowed inside the canvas, so the browser menu never opens
//   - `mousedown(button===2)` records the pointer; `window` mousemove/mouseup follow
//     it (window, not the container, so a drag that leaves the canvas keeps tracking)
//   - `cy.panBy` performs the move, so the transform, the bubble layer and every
//     `render` observer keep working exactly as for left-button panning
// No `stopPropagation` is used (it would not help anyway: it does not stop listeners
// on the *same* element, only `stopImmediatePropagation` does — and cytoscape does
// not react to button 2, verified empirically below).
const PAN_BUTTON = 2; // MouseEvent.button: 2 == secondary / right
let rightDrag = null; // {x, y} in client coordinates while a right-drag is active

function endRightDrag() {
  if (!rightDrag)
    return;
  rightDrag = null;
  cy.container().classList.remove('panning-right');
}

cy.container().addEventListener('contextmenu', e => {
  e.preventDefault(); // covers a drag *and* a plain right-click on the canvas
});

cy.container().addEventListener('mousedown', e => {
  if (e.button !== PAN_BUTTON)
    return;
  if (e.target.closest('.cy-panzoom')) // the plugin widget keeps its own gestures
    return;
  rightDrag = {x: e.clientX, y: e.clientY};
  cy.container().classList.add('panning-right');
  e.preventDefault(); // no native text selection / drag feedback while panning
});

window.addEventListener('mousemove', e => {
  if (!rightDrag)
    return;
  cy.panBy({x: e.clientX - rightDrag.x, y: e.clientY - rightDrag.y});
  rightDrag.x = e.clientX;
  rightDrag.y = e.clientY;
});

window.addEventListener('mouseup', e => {
  if (e.button !== PAN_BUTTON)
    return;
  endRightDrag();
});

// alt-tab / devtools can steal the mouseup; recover on blur so the cursor and the
// drag state do not stay stuck.
window.addEventListener('blur', endRightDrag);
