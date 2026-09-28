// ELK `layered` = Sugiyama layering (cytoscape-cola was force-directed and
// produced an unreadable spider web for the call DAG). `direction: RIGHT`
// matches the call direction (caller -> callee), `edgeRouting: ORTHOGONAL`
// gives right-angled taxi-like wiring.
// INCLUDE_CHILDREN: call edges cross package/module boundaries; ELK Layered
// requires it to route edges whose endpoints live on different hierarchy
// levels (otherwise UnsupportedGraphException).
const ELK_OPTIONS = {
  algorithm: 'layered',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.spacing.nodeNode': '24',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.padding': '[top=20,left=20,bottom=20,right=20]',
};
// A non-animated ELK layout over an arbitrary collection. cytoscape-elk resolves
// asynchronously, so completion must be awaited via `layout.one('layoutstop')`
// before post-processing the resulting coordinates (incremental expand).
const layoutCollection = (eles) => eles.layout({
  name: 'elk',
  fit: false,
  animate: false,
  padding: 20,
  nodeDimensionsIncludeLabels: true,
  elk: { ...ELK_OPTIONS },
});

let layout;
// Bumped whenever a layout is superseded, so async ELK callbacks from an
// abandoned incremental expand cannot reposition the graph behind a newer action.
let layoutToken = 0;
const stopLayout = () => {
  layoutToken++;
  layout?.stop();
};
function newLayout(fit = false) {
  layout = cy.layout({
    name: 'elk',
    fit,
    animate: true,
    padding: 20,
    nodeDimensionsIncludeLabels: true,
    elk: { ...ELK_OPTIONS },
  });

  layout.start();
}
