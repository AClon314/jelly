/**
 * Focus (ego subgraph): keep only the selected node(s) plus everything within
 * `depth` hops along *visible* call edges, drop the rest, then re-fit the viewport.
 *
 * The dropped elements go into the same `removed` collection that `hide()` uses, so
 * the existing `Expand all` / `Collapse all` / `Layout` buttons (which now all funnel
 * through `hide()`) bring the whole graph back instead of inventing a second undo
 * mechanism.
 *
 * Compound containers must survive: `remove()` cascades into descendants, so dropping
 * a kept node's module/package ancestor would silently delete the kept node too (and a
 * later `restore()` would reject the orphaned child). Hence `reached ∪ ancestors`.
 * A selected *compound* seeds the BFS with its descendants, so focusing a module keeps
 * the module's functions rather than just the empty container.
 */
function focusSelected(depthOverride) {
  const msg = document.getElementById("msg");
  const selected = cy.$("node:selected");
  if (selected.size() === 0) {
    msg.textContent = "Focus: select a node first (nothing is selected).";
    return;
  }
  const rawDepth = depthOverride ?? Number(document.getElementById("focusDepth").value);
  const depth = Number.isFinite(rawDepth) ? Math.max(0, Math.floor(rawDepth)) : 2;

  stopLayout();
  const collapsed = cy.$("node.cy-expand-collapse-collapsed-node");
  // Collapsed edges are aggregates and carry no `kind`; materialise them so the BFS
  // sees the real call edges. Compounds themselves stay collapsed ("visible" graph).
  ec.expandAllEdges();

  // Bidirectional adjacency over visible call edges.
  const adjacency = new Map();
  cy.edges('edge[kind="call"]:visible').forEach(edge => {
    const s = edge.source().id();
    const t = edge.target().id();
    if (!adjacency.has(s)) adjacency.set(s, []);
    if (!adjacency.has(t)) adjacency.set(t, []);
    adjacency.get(s).push(t);
    adjacency.get(t).push(s);
  });

  const reached = new Set(selected.union(selected.descendants()).map(n => n.id()));
  let frontier = [...reached];
  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next = [];
    for (const id of frontier)
      for (const nb of adjacency.get(id) ?? [])
        if (!reached.has(nb)) {
          reached.add(nb);
          next.push(nb);
        }
    frontier = next;
  }

  // Keep the reached nodes plus every compound ancestor (container).
  let keep = cy.collection();
  reached.forEach(id => {
    const node = cy.getElementById(id);
    if (node.nonempty())
      keep = keep.union(node).union(node.ancestors());
  });
  // Edges are only kept when both endpoints survive.
  keep = keep.union(cy.edges().filter(e => keep.contains(e.source()) && keep.contains(e.target())));

  if (!removeOtherThan(keep))
    return; // whole visible graph is already within N hops: nothing to trim
  ec.collapseRecursively(collapsed.intersection(keep));
  ec.collapseAllEdges();
  newLayout(true); // fit=true is the point: the trimmed subgraph fills the viewport
}

/** Moves everything outside `keep` into the shared `removed` collection. */
function removeOtherThan(keep) {
  const drop = cy.elements().difference(keep);
  if (drop.empty())
    return false;
  const r = drop.remove();
  removed = removed ? removed.union(r) : r;
  return true;
}

// ---- Overview (S3e): directory-level aggregation -------------------------
//
// The full call graph is a per-function spider web (1885 nodes, ~40k edge
// crossings). Overview replaces it with one synthetic node per module
// *directory* and one aggregated edge per ordered directory pair, i.e. a
// ~17-node "module map" that answers "which subsystems talk to which".
//
// Why no compound layer: the existing hierarchy is package > module > function,
// and a directory cuts across it (it is not a fifth well-defined level; a module
// has exactly one directory, but a directory can hold modules from several
// packages, and none of the existing parents means "directory"). Synthesizing
// plain nodes keeps `cytoscape-expand-collapse` — whose whole model is that
// three-level compound tree — untouched. Erasing the originals into the shared
// `removed` collection and restoring them through `hide()` is the entire
// integration; the alternative (temporary compound parents) would have to fake
// package/module ancestry and fight expand-collapse.

// File path behind a node, used to derive its directory. Callgraph function
// nodes carry it in `fullName` ("<name> @ <path>:<line>:<col>:<endLine>:<endCol>");
// module nodes carry it directly in `name`. Package/variable nodes have no path.
function nodeFilePath(node) {
  if (node.data("kind") === "module")
    return node.data("name") ?? "";
  const full = node.data("fullName") ?? "";
  const at = full.lastIndexOf(" @ ");
  return at < 0 ? "" : full.slice(at + 3).replace(/:\d+:\d+:\d+:\d+$/, "");
}

// Directory key = the first `depth` segments of the node's parent directory.
// `src/lib/bindings/storage/x.ts` -> `src/lib/bindings` (depth 3);
// `src/routes/+page.svelte` -> `src/routes`. Configurable via #overviewDepth
// (2 = only src/lib vs src/routes, 4 = one more level, e.g. components/workspace).
function directoryOfPath(path, depth) {
  const dir = path.split("/").slice(0, -1);
  return dir.length === 0 ? "<root>" : dir.slice(0, depth).join("/");
}

function buildOverviewElements(depth) {
  // 1. Bucket every original node (module + function) by directory.
  const dirs = new Map(); // dir -> {moduleCount, functionCount, callCount, internal}
  const dirOf = new Map(); // node id -> dir
  cy.nodes().filter(n => n.data("kind") === "module" || n.data("kind") === "function").forEach(n => {
    const dir = directoryOfPath(nodeFilePath(n), depth);
    dirOf.set(n.id(), dir);
    const d = dirs.get(dir) ?? { moduleCount: 0, functionCount: 0, callCount: 0, internal: 0 };
    if (n.data("kind") === "module") d.moduleCount++;
    else d.functionCount++;
    d.callCount += n.data("callCount") ?? 0;
    dirs.set(dir, d);
  });

  // 2. Aggregate every original edge onto its directory pair. Edges that stay
  //    inside one directory become a self-loop: count them on the node instead
  //    of drawing a loop (a loop on every one of 17 nodes is pure noise).
  const agg = new Map();
  cy.edges().not(".cy-expand-collapse-collapsed-edge").forEach(e => {
    const s = dirOf.get(e.source().id());
    const t = dirOf.get(e.target().id());
    if (s === undefined || t === undefined)
      return;
    if (s === t) {
      dirs.get(s).internal++;
      return;
    }
    const key = `${s}\u0000${t}`;
    const a = agg.get(key) ?? { s, t, weight: 0, calls: 0, requires: 0 };
    a.weight++;
    if (e.data("kind") === "require") a.requires++;
    else a.calls++;
    agg.set(key, a);
  });

  // 3. Emit nodes and aggregated edges.
  const maxWeight = Math.max(1, ...[...dirs.values()].map(d => d.moduleCount + d.functionCount));
  const elements = [];
  let nextId = 1;
  const ids = new Map();
  const nodeId = (dir) => {
    if (!ids.has(dir)) ids.set(dir, `overview-node-${nextId++}`);
    return ids.get(dir);
  };
  for (const [dir, d] of dirs) {
    const short = dir.startsWith("src/") ? dir.slice(4) : dir;
    elements.push({ data: {
      id: nodeId(dir), kind: "directory", name: short,
      label: `${short}\n${d.moduleCount} mod \u00b7 ${d.functionCount} fn`,
      fullName: dir, moduleCount: d.moduleCount, functionCount: d.functionCount,
      weight: d.moduleCount + d.functionCount,
      callWeight: Math.round(100 * d.callCount / maxWeight),
      internalEdges: d.internal,
    }});
  }
  for (const a of agg.values())
    elements.push({ data: {
      id: `overview-edge-${nextId++}`, kind: "overview",
      source: nodeId(a.s), target: nodeId(a.t),
      weight: a.weight, calls: a.calls, requires: a.requires,
    }});
  return elements;
}

/**
 * Overview: replace the visible graph by its directory-level aggregation.
 *
 * Restores whatever Focus/Remove had dropped first (so the aggregation always
 * sees the whole graph), moves every original element into the same `removed`
 * collection the other buttons use, then adds the synthetic nodes/edges. Any
 * later `hide()` (Layout / Collapse all / Expand all / threshold) clears the
 * overview and restores the originals, so this is never a dead end.
 */
function showOverview() {
  stopLayout();
  clearOverview();
  restoreRemoved();
  // Materialise every original node/edge first. Collapsed descendants are held
  // inside cytoscape-expand-collapse (not in `cy.elements()`); removing a collapsed
  // parent would drop them without ever putting them in `removed`, so recovery
  // would come back short. Expanding also unwraps bundled edges for aggregation.
  ec.expandAll();
  overviewDepthUsed = Math.max(1, Math.floor(Number(document.getElementById("overviewDepth").value) || 3));
  const elements = buildOverviewElements(overviewDepthUsed);
  const originals = cy.elements();
  const r = originals.remove();
  removed = removed ? removed.union(r) : r;
  overview = cy.add(elements);
  newLayout(true);
}

/**
 * Drill-down: a directory node selects that directory's member modules and
 * hands them to Focus with depth 0, so the view is exactly the directory's own
 * subtree (modules + their functions), with no outside hops. Reusing Focus is
 * deliberate: `expandIncremental` funnels through `hide()`, which restores the
 * whole graph, so a collapsed-modules drill-down could not be expanded further
 * anyway (same pre-existing semantics as Focus).
 */
function focusDirectory(dir) {
  clearOverview();
  restoreRemoved();
  const members = cy.nodes().filter(n => n.data("kind") === "module" && directoryOfPath(nodeFilePath(n), overviewDepthUsed) === dir);
  if (members.size() === 0)
    return;
  cy.$(":selected").unselect();
  members.select();
  focusSelected(0);
}
