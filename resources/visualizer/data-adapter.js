/**
 * Builds a callgraph from a raw CallGraph JSON. Mirrors
 * `src/output/visualizer.ts:getVisualizerCallGraph` for the case where the analysis is no
 * longer available (e.g. opening a committed baseline).
 *
 * Relies on these invariants of `src/output/analysisstatereporter.ts:saveCallGraph`:
 *  - `functions` is indexed 0..n-1 and `functionNames[i]` holds its name;
 *  - `moduleNodes[j]` is the `functions` index of the module whose path is `files[j]`;
 *  - `fun2fun` holds both call edges and require edges; `requireEdges` marks the latter.
 */
function buildCallGraph(cg) {
  const parts = (s) => s.split(":").map(Number); // "<file>:<line>:<col>:<endLine>:<endCol>"
  const at = (s) => { const [, l, c, el, ec] = parts(s); return `${l}:${c}:${el}:${ec}`; };

  const moduleNodes = cg.moduleNodes ?? [];
  const requireEdges = new Set((cg.requireEdges ?? []).map(([a, b]) => `${a},${b}`));
  const isModuleNode = new Set(moduleNodes);
  const functionIndices = Object.keys(cg.functions).map(Number);

  // Package of a module, derived from its path (the JSON has no package information).
  const packageOf = (path) => {
    const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(path);
    return m ? m[1] : "<main>";
  };
  // Module node of a function/module index.
  const moduleOf = (i) => moduleNodes[parts(cg.functions[i])[0]];

  // count incoming call/require edges per function, module and package
  const functionCounts = new Map(), moduleCounts = new Map(), packageCounts = new Map();
  const bump = (map, key) => { const n = (map.get(key) ?? 0) + 1; map.set(key, n); return n; };
  let maxFunction = 1, maxModule = 1, maxPackage = 1;
  for (const [src, dst] of cg.fun2fun) {
    if (!isModuleNode.has(dst)) // only call edges count for functions
      maxFunction = Math.max(maxFunction, bump(functionCounts, dst));
    const mod = isModuleNode.has(dst) ? dst : moduleOf(dst);
    maxModule = Math.max(maxModule, bump(moduleCounts, mod));
    maxPackage = Math.max(maxPackage, bump(packageCounts, packageOf(cg.files[parts(cg.functions[mod])[0]])));
  }

  // reachability: breadth-first from the entry modules over all edges
  const adjacency = new Map();
  for (const [src, dst] of cg.fun2fun) {
    if (!adjacency.has(src)) adjacency.set(src, []);
    adjacency.get(src).push(dst);
  }
  const reachable = new Set();
  const work = [];
  const reach = (i) => { if (!reachable.has(i)) { reachable.add(i); work.push(i); } };
  for (const entry of cg.entries ?? []) {
    const file = cg.files.indexOf(entry);
    if (file >= 0 && moduleNodes[file] !== undefined) reach(moduleNodes[file]);
  }
  while (work.length > 0)
    for (const next of adjacency.get(work.pop()) ?? []) reach(next);
  const reachablePackages = new Set();
  for (const mod of moduleNodes)
    if (reachable.has(mod)) reachablePackages.add(packageOf(cg.files[parts(cg.functions[mod])[0]]));
  const entryPackages = new Set((cg.entries ?? []).map((entry) => packageOf(entry)));

  // emit nodes and edges
  const elements = [];
  const packageIds = new Map(), moduleIds = new Map(), functionIds = new Map();
  let nextId = 1;
  const id = (map, key) => { if (!map.has(key)) map.set(key, nextId++); return map.get(key); };

  const packageNames = [...new Set(moduleNodes.map((mod) => packageOf(cg.files[parts(cg.functions[mod])[0]])))].sort();
  for (const pkg of packageNames) {
    const count = packageCounts.get(pkg) ?? 0;
    elements.push({data: {
      id: id(packageIds, pkg), kind: "package", name: pkg, fullName: pkg,
      callWeight: Math.round(100 * count / maxPackage), callCount: count,
      isEntry: entryPackages.has(pkg) ? "true" : undefined,
      isReachable: reachablePackages.has(pkg) ? "true" : undefined,
    }});
  }
  for (const mod of moduleNodes) {
    const path = cg.files[parts(cg.functions[mod])[0]];
    const pkg = packageOf(path);
    const count = moduleCounts.get(mod) ?? 0;
    elements.push({data: {
      id: id(moduleIds, mod), kind: "module", parent: id(packageIds, pkg), name: path, fullName: `${pkg}:${path}`,
      callWeight: Math.round(100 * count / maxModule), callCount: count,
      isEntry: (cg.entries ?? []).includes(path) ? "true" : undefined,
      isReachable: reachable.has(mod) ? "true" : undefined,
    }});
  }
  for (const i of functionIndices) {
    if (isModuleNode.has(i)) continue;
    const name = (cg.functionNames ?? [])[i] ?? "<anon>";
    const count = functionCounts.get(i) ?? 0;
    elements.push({data: {
      id: id(functionIds, i), kind: "function", parent: id(moduleIds, moduleOf(i)),
      name: `${name} ${at(cg.functions[i])}`, fullName: `${name} @ ${cg.files[parts(cg.functions[i])[0]]}:${at(cg.functions[i])}`,
      callWeight: Math.round(100 * count / maxFunction), callCount: count,
      isReachable: reachable.has(i) ? "true" : undefined,
    }});
  }
  let numEdges = 0;
  for (const [src, dst] of cg.fun2fun) {
    elements.push({data: {
      kind: requireEdges.has(`${src},${dst}`) ? "require" : "call",
      source: id(isModuleNode.has(src) ? moduleIds : functionIds, src),
      target: id(isModuleNode.has(dst) ? moduleIds : functionIds, dst),
    }});
    numEdges++;
  }
  return {
    kind: "callgraph",
    elements,
    info: `Packages: ${packageNames.length}\nModules: ${moduleNodes.length}\nFunctions: ${functionIndices.length - moduleNodes.length}\nEdges: ${numEdges}`,
  };
}

/** Resolves the graphs to display, either from the inline data or from the data URL. */
async function loadGraphs() {
  if (INLINE_DATA)
    return INLINE_DATA;
  const response = await fetch(DATA_URL);
  if (!response.ok)
    throw new Error(`cannot load ${DATA_URL}: HTTP ${response.status}`);
  return {graphs: [buildCallGraph(await response.json())]};
}
