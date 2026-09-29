let removed;
// Synthesized elements of the Overview view (directory nodes + aggregated
// edges). Kept out of `removed` so the two views cannot resurrect each other:
// `hide()` drops the overview first, then restores `removed`.
let overview;
// Depth (path segments) the current overview was built with, needed by the
// drill-down to regroup exactly the same directories.
let overviewDepthUsed = 3;

// Puts everything Overview / Focus / Remove took out back into the graph. Shared
// by `hide()` and the Overview entry point so there is exactly one restore path.
function restoreRemoved() {
  if (!removed)
    return;
  removed.filter("node").restore();
  removed.filter("edge").forEach(e => {
    if (e.source().inside() && e.target().inside())
      e.restore();
  });
  removed = removed.filter(":removed");
}

function clearOverview() {
  if (!overview)
    return;
  overview.remove();
  overview = undefined;
}

function hide() {
  stopLayout();
  clearOverview();
  restoreRemoved();
  const threshold = document.getElementById("threshold").value;
  const count = graph.kind === "callgraph" ? "callCount" : graph.kind === "dataflow" ? "tokenCount" : undefined;
  const queries = [];
  if (count && threshold > 0)
    queries.push(`node[${count} < ${threshold}]`);
  if (document.getElementById("hideUnreachable").checked)
    queries.push("node[!isReachable]");
  if (queries.length > 0) {
    const nodes = cy.elements(queries.join(","));
    // A collapsed compound keeps its children inside expand-collapse instead of in the
    // graph, so they would not be part of `nodes` and could never be restored. Materialize
    // every collapsed node we are about to delete (including a collapsed descendant of a
    // matched compound), then take the descendants along explicitly. Only the doomed
    // branches are touched, so unrelated folds keep their state.
    const collapsed = nodes.union(nodes.descendants()).filter(".cy-expand-collapse-collapsed-node");
    ec.expandAllEdges();
    if (collapsed.size() > 0)
      ec.expandRecursively(collapsed);
    ec.collapseAllEdges();
    const r = nodes.union(nodes.descendants()).remove();
    removed = removed ? removed.union(r) : r;
  }
}

const ec = cy.expandCollapse({
  fisheye: false,
  randomize: false,
  animate: true,
  undoable: false,
  cueEnabled: false,
  allowNestedEdgeCollapse: false,
  groupEdgesOfSameTypeOnCollapse: true
});
cy.on("expandcollapse.afterexpand", node => {
  cy.batch(() => {
    const desc = cy.nodes(node.target).descendants();
    if (document.getElementById("showCallDensity").checked)
      desc.addClass("callWeight");
    else
      desc.removeClass("callWeight");
    if (document.getElementById("showValueDensity").checked)
      desc.addClass("tokenWeight");
    else
      desc.removeClass("tokenWeight");
    if (document.getElementById("highlightReachable").checked)
      desc.addClass("highlight");
    else
      desc.removeClass("highlight");
  });
});

/**
 * Incremental expand: reveal `es` without re-laying out the whole graph.
 *
 * 1. remember where every currently visible node is;
 * 2. `ec.expand(...)`;
 * 3. pin every pre-existing node back to its remembered coordinates;
 * 4. lay out only the freshly revealed subtree (ELK layered, honouring the
 *    module -> function hierarchy) and translate that island next to the
 *    untouched graph so it cannot overlap it.
 *
 * Returns true when something was actually revealed.
 */
function expandIncremental(es) {
  const before = new Map();
  cy.nodes().forEach(n => before.set(n.id(), { x: n.position().x, y: n.position().y }));

  ec.expandAllEdges();
  ec.expand(es.union(es.children(':visible')));
  ec.collapseAllEdges();
  showVulnerabilities();
  hide();

  // Every node the expansion (or a just-undone hide) brought into the graph.
  const revealed = cy.nodes().filter(n => !before.has(n.id()));
  if (revealed.size === 0)
    return false; // already expanded: leave the graph exactly as it is
  const subtree = es.union(es.descendants()).union(revealed);

  // Old nodes keep their exact coordinates (a compound ancestor still
  // recomputes its own bounding box from its children, which is expected).
  const old = cy.nodes().difference(subtree);
  cy.batch(() => {
    old.forEach(n => {
      const p = before.get(n.id());
      if (p) n.position(p);
    });
  });

  // Lay out only the island: the revealed subtree plus its internal edges.
  // ELK requires every laid-out node's parent to be part of the collection
  // (its builder crashes on a child whose parent is missing), so bring the
  // ancestor containers along even though only the subtree is repositioned.
  const internalEdges = cy.edges().filter(e => subtree.contains(e.source()) && subtree.contains(e.target()));
  const internal = subtree.union(subtree.ancestors()).union(internalEdges);

  // Vertical anchor: the (old) centre of the node(s) that were expanded.
  let anchorY = 0, anchorCount = 0;
  es.forEach(node => {
    const p = before.get(node.id());
    if (p) { anchorY += p.y; anchorCount++; }
  });

  // cytoscape-elk resolves asynchronously, so the island can only be parked
  // once `layoutstop` fires (otherwise we would move stale coordinates).
  const token = layoutToken;
  layout = layoutCollection(internal);
  layout.one('layoutstop', () => {
    if (token !== layoutToken)
      return; // superseded by a newer action
    const leaves = old.filter(n => n.children().length === 0);
    const anchor = leaves.size() > 0 ? leaves.boundingBox() : null;
    if (anchorCount === 0 && anchor) anchorY = anchor.y1;
    const island = subtree.boundingBox();
    const gap = 120;
    subtree.shift({
      x: (anchor ? anchor.x2 + gap : 0) - island.x1,
      y: anchorY - (island.y1 + island.y2) / 2,
    });
    // If the island landed outside the viewport, pan/zoom onto it (this only
    // touches the viewport, never the model coordinates pinned above).
    const view = cy.extent();
    const placed = subtree.boundingBox();
    if (placed.x1 < view.x1 || placed.y1 < view.y1 || placed.x2 > view.x2 || placed.y2 > view.y2)
      cy.animate({ fit: { eles: subtree, padding: 60 }, duration: 400 });
  });
  layout.run();
  return true;
}
