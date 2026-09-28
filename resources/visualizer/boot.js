document.getElementById("collapseAll").addEventListener("click", () => {
  stopLayout();
  hide();
  ec.expandAllEdges();
  ec.collapseAll();
  ec.collapseAllEdges();
  showVulnerabilities();
  newLayout();
});
document.getElementById("collapseSelected").addEventListener("click", () => {
  stopLayout();
  const ns = cy.$(":selected:compound:visible");
  if (ns.size() > 0) {
    ec.expandAllEdges();
    ec.collapseRecursively(ns);
    ec.collapseAllEdges();
    showVulnerabilities();
    newLayout();
  }
});
document.getElementById("expandSelected").addEventListener("click", () => {
  stopLayout();
  const es = cy.$(":selected:visible.cy-expand-collapse-collapsed-node,:selected:visible:compound");
  if (es.size() > 0)
    expandIncremental(es);
});
document.getElementById("expandAllPackages").addEventListener("click", () => {
  stopLayout();
  expandIncremental(cy.$('node[kind="package"]:visible.cy-expand-collapse-collapsed-node'));
});
document.getElementById("expandAll").addEventListener("click", () => {
  stopLayout();
  ec.expandAllEdges();
  ec.expandRecursively(cy.nodes(":visible"));
  hide();
  newLayout();
});
document.getElementById("showPredecessors").addEventListener("click", () => {
  const es = cy.$("node:selected");
  if (es.size() > 0) {
    stopLayout();
    const collapsed = cy.$("node.cy-expand-collapse-collapsed-node");
    ec.expandAllEdges();
    ec.expandAll();
    const sources = es.union(es.descendants());
    const pred = sources.predecessors().union(sources);
    const keep = pred.union(pred.ancestors())
    cy.nodes().difference(keep).remove();
    ec.collapseRecursively(collapsed.intersection(keep));
    ec.collapseAllEdges();
    hide();
    newLayout();
  }
});
document.getElementById("focusSelected").addEventListener("click", () => {
  focusSelected();
});
document.getElementById("overview").addEventListener("click", () => {
  showOverview();
});
cy.on("tap", 'node[kind="directory"]', e => {
  focusDirectory(e.target.data("fullName"));
});
document.getElementById("removeSelected").addEventListener("click", () => {
  const es = cy.$(":selected");
  if (es.size() > 0) {
    stopLayout();
    ec.expandAllEdges();
    cy.$(":selected").remove();
    ec.collapseAllEdges();
    hide();
    newLayout();
  }
});
document.getElementById("removeNonSelected").addEventListener("click", () => {
  const es = cy.$(":selected");
  if (es.size() > 0) {
    stopLayout();
    ec.expandAllEdges();
    cy.nodes().difference(es.union(es.descendants()).union(es.ancestors())).remove();
    ec.collapseAllEdges();
    removed = undefined;
    hide();
    newLayout();
  }
});
document.getElementById("layout").addEventListener("click", () => {
  // `hide()` restores anything removed via the `removed` collection (e.g. a Focus
  // subgraph) before re-applying the threshold/unreachable filters.
  if (document.getElementById("layout").classList.contains("shadow"))
    return;
  hide();
  newLayout();
});
document.getElementById("hideUnreachable").addEventListener("change", () => {
  stopLayout();
  hide();
  newLayout();
});
document.getElementById("threshold").addEventListener("change", () => {
  stopLayout();
  hide();
  newLayout();
});
document.getElementById("threshold").addEventListener("focus", e => {
  e.target.select();
});
document.getElementById("highlightReachable").addEventListener("change", () => {
  stopLayout();
  if (document.getElementById("highlightReachable").checked)
    cy.nodes().addClass("highlight");
  else
    cy.nodes().removeClass("highlight");
  newLayout();
});
document.getElementById("showCallDensity").addEventListener("change", () => {
  stopLayout();
  if (document.getElementById("showCallDensity").checked)
    cy.nodes().addClass("callWeight");
  else
    cy.nodes().removeClass("callWeight");
  newLayout();
});
document.getElementById("showValueDensity").addEventListener("change", () => {
  stopLayout();
  if (document.getElementById("showValueDensity").checked)
    cy.nodes().addClass("tokenWeight");
  else
    cy.nodes().removeClass("tokenWeight");
  newLayout();
});

const data = await loadGraphs();
let graph;

function showVulnerabilities() {
  if (!graph.vulnerabilities)
    return;

  stopLayout();
  const vulnerabilityTitle = document.getElementById("vulnerabilities").value;
  const e = document.getElementsByName("vulnerabilityLevel");
  let level = "package";
  for (let i = 0; i < e.length; i++)
    if (e[i].checked) {
      level = e[i].value;
      break;
    }
  const sources = new Set(), targets = new Set();
  for (const v of graph.vulnerabilities)
    if (v.title === vulnerabilityTitle) {
      for (const s of v[level].sources)
        sources.add(String(s));
      for (const s of v[level].targets)
        targets.add(String(s));
    }
  function has(collection, node) {
    return collection.has(node.data("id")) || (ec.isExpandable(node) && ec.getCollapsedChildrenRecursively(node).some(n => collection.has(n.data("id"))));
  }
  cy.batch(() => {
    cy.nodes().forEach(node => {
      node.removeData("isSource isTarget");
      if (has(sources, node))
        node.data("isSource", true);
      if (has(targets, node))
        node.data("isTarget", true);
    });
    cy.edges().forEach(edge => {
      edge.removeData("sourceTarget");
      const source = edge.source();
      const target = edge.target();
      if (has(sources, source) && (has(targets, target) || has(sources, target)))
        edge.data("sourceTarget", true);
    });
   cy.elements().removeClass("workaround");
 });
}
document.getElementById("vulnerabilities").addEventListener("change", showVulnerabilities);
document.getElementById("vulnerabilityLevel").addEventListener("change", showVulnerabilities);

function setGraph(i) {
  stopLayout();
  removed = undefined;
  overview = undefined;
  cy.elements().remove();
  graph = data.graphs[i];
  cy.add(structuredClone(graph.elements));
  ec.collapseAll();
  ec.collapseAllEdges();
  scheduleOffscreen();
  if (graph.kind === "callgraph")
    document.body.classList.remove("callgraphModeHidden");
  if (graph.kind === "dataflow")
    document.body.classList.remove("dataflowModeHidden");
  document.getElementById("showValueDensity").checked = false;
  if (graph.info)
    document.getElementById("info").innerText = graph.info;
  document.getElementById("threshold").value = 0;
  if (graph.vulnerabilities) {
    const vulnerabilities = document.getElementById("vulnerabilities");
    const vulnerabilityLevel = document.getElementById("vulnerabilityLevel");
    vulnerabilities.hidden = false;
    vulnerabilityLevel.hidden = false;
    for (let i = 0; i < graph.vulnerabilities.length; i++) {
      const opt = document.createElement("option");
      opt.value = opt.innerText = graph.vulnerabilities[i].title;
      vulnerabilities.appendChild(opt);
    }
    showVulnerabilities();
  }
  newLayout(true);
}

if (data.graphs.length >= 1) {
  setGraph(0);
  if (data.graphs.length > 1) {
    const dataset = document.getElementById('dataset');
    dataset.hidden = false;
    for (let i = 0; i < data.graphs.length; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.innerText = data.graphs[i].title ?? "";
      dataset.appendChild(opt);
    }
    document.getElementById("dataset").addEventListener("change", e => {
      setGraph(e.target.value);
    });
  }
}
