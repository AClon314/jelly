{
  selector: 'node',
  style: {
    'min-zoomed-font-size': '3px',
    'background-color': '#aaaaaa'
  }
},
{
  selector: 'node.cy-expand-collapse-collapsed-node',
  style: {
    'border-width': '1px',
    'border-style': 'solid',
    'border-color': '#000000'
  }
},
{
  selector: 'node.cy-expand-collapse-collapsed-node.callWeight',
  style: {
    'background-color': 'mapData(callWeight, 0, 100, lightgray, purple)'
  }
},
{
  selector: 'node.cy-expand-collapse-collapsed-node.tokenWeight',
  style: {
    'background-color': 'mapData(tokenWeight, 0, 100, lightgray, purple)'
  }
},
{
  selector: 'node[isEntry]',
  style: {
    'border-width': '3px',
    'border-style': 'solid',
    'border-color': '#000000'
  }
},
{
  selector: 'node:selected',
  style: {
    'border-width': '4px',
    'border-style': 'solid',
    'border-color': '#3050c0'
  }
},
{
  selector: 'node[isReachable].highlight',
  style: {
    'border-width': '2px',
    'border-style': 'solid',
    'border-color': '#ffff00'
  }
},
{
  selector: 'node:selected[isReachable].highlight',
  style: {
    'border-width': '4px',
    'border-color': '#50c050'
  }
},
{
  selector: 'node:selected[isEntry]',
  style: {
    'border-width': '5px',
  }
},
{
  selector: 'node[isEntry].highlight',
  style: {
    'border-width': '5px',
  }
},
{
  selector: 'node[kind="package"]',
  style: {
    'label': 'data(name)',
    'font-size': '10px',
    'shape': 'rectangle'
  }
},
{
  selector: 'node[kind="package"].callWeight',
  style: {
    'width': function (node) {
      return (30 + Math.sqrt(node.data('callWeight'))*2) + 'px';
    },
    'height': function (node) {
      return (30 + Math.sqrt(node.data('callWeight'))*2) + 'px';
    }
  }
},
{
  selector: 'node[kind="package"].tokenWeight',
  style: {
    'width': function (node) {
      return (30 + Math.sqrt(node.data('tokenWeight'))*2) + 'px';
    },
    'height': function (node) {
      return (30 + Math.sqrt(node.data('tokenWeight'))*2) + 'px';
    }
  }
},
{
  selector: 'node[kind="module"]',
  style: {
    'label': 'data(name)',
    'font-size': '8px',
    'shape': 'rectangle'
  }
},
{
  selector: 'node[kind="module"].callWeight',
  style: {
    'width': function (node) {
      return (20 + Math.sqrt(node.data('callWeight'))) + 'px';
    },
    'height': function (node) {
      return (20 + Math.sqrt(node.data('callWeight'))) + 'px';
    }
  }
},
{
  selector: 'node[kind="module"].tokenWeight',
  style: {
    'width': function (node) {
      return (20 + Math.sqrt(node.data('tokenWeight'))) + 'px';
    },
    'height': function (node) {
      return (20 + Math.sqrt(node.data('tokenWeight'))) + 'px';
    },
    'background-color': 'mapData(tokenWeight, 0, 100, gray, red)'
  }
},
{
  selector: 'node[kind="function"]',
  style: {
    'label': 'data(name)',
    'font-size': '6px',
    'shape': 'ellipse'
  }
},
{
  selector: 'node[kind="function"].callWeight',
  style: {
    'width': function (node) {
      return (10 + node.data('callWeight')/3) + 'px';
    },
    'height': function (node) {
      return (10 + node.data('callWeight')/3) + 'px';
    },
    'background-color': 'mapData(callWeight, 0, 100, gray, purple)'
  }
},
{
  selector: 'node.cy-expand-collapse-collapsed-node',
  style: {
    'shape': 'rectangle',
  },
},
{
  selector: ':parent',
  style: {
    'background-opacity': 0.333
  }
},
{
  selector: 'node[isSource]',
  style: {
    'background-color': '#aa0000',
    'background-opacity': 0.8
  }
},
{
  selector: 'node[isTarget]',
  style: {
    'background-color': '#ff0000',
    'background-opacity': 0.8
  }
},
{
  selector: 'node[kind="variable"]',
  style: {
    'shape': 'ellipse',
    'width': '8px',
    'height': '8px',
    'background-color': 'gray'
  }
},
{
  selector: 'node[kind="variable"].tokenWeight',
  style: {
    'width': function (node) {
      return (8 + Math.sqrt(node.data('tokenWeight'))/2) + 'px';
    },
    'height': function (node) {
      return (8 + Math.sqrt(node.data('tokenWeight'))/2) + 'px';
    },
    'background-color': 'mapData(tokenWeight, 0, 100, gray, red)'
  }
},
{
  // S3e Overview: one synthetic node per module directory (see buildOverviewElements).
  selector: 'node[kind="directory"]',
  style: {
    'label': 'data(label)',
    'font-size': '12px',
    'text-valign': 'center',
    'text-halign': 'center',
    'text-wrap': 'wrap',
    'shape': 'round-rectangle',
    'background-color': '#d7dcff',
    'border-width': '1px',
    'border-color': '#3050c0',
    'width': function (node) {
      return (70 + Math.sqrt(node.data('weight')) * 3) + 'px';
    },
    'height': function (node) {
      return (30 + Math.sqrt(node.data('weight')) * 1.5) + 'px';
    }
  }
},
{
  selector: 'edge',
  style: {
    'width': 1,
    'line-color': '#888',
    'target-arrow-color': '#888',
    'target-arrow-shape': 'triangle',
    // cytoscape-elk computes node positions only; ELK's ORTHOGONAL bend
    // points are not fed back into cytoscape, so request right-angled
    // wiring from cytoscape itself (`taxi`).
    'curve-style': 'taxi',
    'taxi-direction': 'horizontal'
  }
},
{
  // S3e Overview: aggregated directory -> directory edge (weight = number of
  // original call/require edges it represents).
  selector: 'edge[kind="overview"]',
  style: {
    'width': function (edge) {
      return (1 + Math.log2(edge.data('weight'))) + 'px';
    },
    'line-color': '#8090c0',
    'target-arrow-color': '#8090c0',
    'label': function (edge) {
      return edge.data('weight') > 1 ? String(edge.data('weight')) : '';
    },
    'font-size': '8px',
    'text-valign': 'center',
    'text-halign': 'center',
    'color': '#5060a0'
  }
},
{
  selector: 'edge.cy-expand-collapse-collapsed-edge',
  style: {
    'width': function (edge) {
      return (2 + Math.log2(edge.data('collapsedEdges').length)/2) + 'px';
    },
    'curve-style': 'unbundled-bezier'
  }
},
{
  selector: 'edge[kind="require"]',
  style: {
    'line-color': '#bbb',
    'target-arrow-color': '#bbb',
  }
},
{
  selector: '.hidden',
  css: {
    'display': 'none'
  }
},
{
  selector: 'edge[sourceTarget]',
  style: {
    'line-color': '#aa0000',
    'target-arrow-color': '#aa0000',
    'width': '3px'
  }
},
{
  selector: 'edge[kind="data"]',
  style: {
    'width': function (edge) {
      return 1 + Math.log2((edge.data('weight') ?? 0) + 1);
    }
  }
},
{
  // Edges incident to the selected node(s). `incident-out` leaves the selection,
  // `incident-in` enters it — same ←/→ reading as the graph:func tree view.
  selector: 'edge.incident',
  style: {
    'width': '3px',
    'line-color': '#3050c0',
    'target-arrow-color': '#3050c0'
  }
},
{
  selector: 'edge.incident-in',
  style: {
    'line-color': '#c05030',
    'target-arrow-color': '#c05030'
  }
}
