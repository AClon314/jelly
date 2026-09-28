cytoscape.warnings(false);
const cy = window.cy = cytoscape({
  container: document.getElementById('cy'),
  layout: null,
  wheelSensitivity: 0.3,
  maxZoom: 3,
  style: [
    <!--#include visualizer/style-map.js-->
  ]
});
cy.panzoom({
  panSpeed: 5,
  panDistance: 15
});
// The UMD build auto-registers when the global `cytoscape` exists; call it
// explicitly too so a load-order change fails loudly instead of silently.
// (The plugin API is static: `cytoscape.use`, not `cy.use`.)
if (typeof cytoscapeElk !== 'undefined')
  cytoscape.use(cytoscapeElk);

cy.on("layoutstart", e => {
  document.getElementById("layout").classList.add("shadow");
});
cy.on("layoutstop", e => {
  document.getElementById("layout").classList.remove("shadow");
});
