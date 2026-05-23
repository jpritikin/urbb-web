import cytoscape, { Core, NodeSingular } from 'cytoscape';
// @ts-ignore
import coseBilkent from 'cytoscape-cose-bilkent';

cytoscape.use(coseBilkent);

interface ConceptDef {
  label: string;
  desc: string;
}

interface InterviewData {
  id: string;
  title: string;
  show: string;
  date: string;
  url: string;
  speakerWords: Record<string, number>;
  conceptSequence: string[];
  contextSnippets: Record<string, string>;
}

interface ConceptGraphData {
  concepts: Record<string, ConceptDef>;
  interviews: InterviewData[];
}

declare const CONCEPT_DATA: ConceptGraphData;

function buildEdges(data: ConceptGraphData): Map<string, number> {
  const edges = new Map<string, number>();
  for (const interview of data.interviews) {
    const seq = interview.conceptSequence;
    for (let i = 0; i < seq.length - 1; i++) {
      if (seq[i] === seq[i + 1]) continue;
      const key = `${seq[i]}||${seq[i + 1]}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return edges;
}

function pickRootNode(cy: Core): NodeSingular {
  const roots = cy.nodes().filter(n => n.indegree(false) === 0);
  const pool = roots.length > 0 ? roots : cy.nodes();
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] as NodeSingular;
}

function selectNode(cy: Core, node: NodeSingular, data: ConceptGraphData): void {
  cy.$(':selected').unselect();
  cy.elements().removeClass('dimmed highlighted');
  cy.elements().addClass('dimmed');
  node.removeClass('dimmed').select();
  const neighbors = node.connectedEdges().connectedNodes();
  node.connectedEdges().removeClass('dimmed').addClass('highlighted');
  neighbors.removeClass('dimmed');
  neighbors.connectedEdges().removeClass('dimmed');
  renderContextPanel(data, node.data('id') as string);
  updateNavButtons(cy, node);
}

function updateNavButtons(cy: Core, node: NodeSingular): void {
  const backBtn = document.getElementById('nav-back') as HTMLButtonElement;
  const fwdBtn  = document.getElementById('nav-fwd')  as HTMLButtonElement;
  backBtn.disabled = node.incomers('node').length === 0;
  fwdBtn.disabled  = node.outgoers('node').length === 0;
}

function initGraph(data: ConceptGraphData): Core {
  const edges = buildEdges(data);

  const nodes = Object.entries(data.concepts).map(([id, def]) => ({
    data: { id, label: def.label },
  }));

  const edgeElements = Array.from(edges.entries()).map(([key]) => {
    const [source, target] = key.split('||');
    return { data: { id: key, source, target } };
  });

  const cy = cytoscape({
    container: document.getElementById('cy'),
    elements: { nodes, edges: edgeElements },
    selectionType: 'single',
    style: [
      {
        selector: 'node',
        style: {
          'background-color': '#92400e',
          'label': 'data(label)',
          'font-size': '11px',
          'font-family': '"JetBrains Mono", "Fira Code", monospace',
          'color': '#fde68a',
          'text-valign': 'bottom',
          'text-margin-y': '4px',
          'text-outline-color': '#0c0804',
          'text-outline-width': '2px',
          'width': 24,
          'height': 24,
          'border-width': '1.5px',
          'border-color': '#f59e0b',
          'border-opacity': 0.6,
        },
      },
      {
        selector: 'node:selected',
        style: {
          'border-color': '#fbbf24',
          'border-width': '3px',
          'border-opacity': 1,
          'background-color': '#b45309',
        },
      },
      {
        selector: 'node.dimmed',
        style: { 'opacity': 0.2 },
      },
      {
        selector: 'edge',
        style: {
          'width': 1.5,
          'line-color': '#78350f',
          'target-arrow-color': '#78350f',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'opacity': 0.7,
        },
      },
      {
        selector: 'edge.highlighted',
        style: {
          'line-color': '#f59e0b',
          'target-arrow-color': '#f59e0b',
          'opacity': 1,
        },
      },
      {
        selector: 'edge.dimmed',
        style: { 'opacity': 0.05 },
      },
    ],
    layout: {
      name: 'cose-bilkent',
      animate: false,
      nodeRepulsion: 8000,
      idealEdgeLength: 120,
      edgeElasticity: 0.45,
      gravity: 0.4,
      numIter: 2500,
      fit: true,
      padding: 30,
      randomize: true,
    } as any,
  });

  return cy;
}

function renderContextPanel(data: ConceptGraphData, conceptId: string): void {
  const def = data.concepts[conceptId];
  if (!def) return;

  const panel    = document.getElementById('context-panel')!;
  const title    = document.getElementById('context-title')!;
  const desc     = document.getElementById('context-desc')!;
  const snippets = document.getElementById('context-snippets')!;

  title.textContent = def.label;
  desc.textContent  = def.desc;
  snippets.innerHTML = '';

  for (const interview of data.interviews) {
    const snippet = interview.contextSnippets[conceptId];
    if (!snippet) continue;

    const card   = document.createElement('div');
    card.className = 'snippet-card';

    const header = document.createElement('div');
    header.className = 'snippet-header';
    header.innerHTML = `<span class="snippet-show">${interview.show}</span>`;

    const text = document.createElement('div');
    text.className   = 'snippet-text';
    text.textContent = `"…${snippet}…"`;

    const link = document.createElement('a');
    link.className   = 'snippet-link';
    link.href        = interview.url;
    link.textContent = '→ full transcript';

    card.appendChild(header);
    card.appendChild(text);
    card.appendChild(link);
    snippets.appendChild(card);
  }

  panel.classList.remove('hidden');
}

function attachNodeHandlers(cy: Core, data: ConceptGraphData): void {
  cy.on('tap', 'node', (evt) => {
    const node = evt.target as NodeSingular;
    selectNode(cy, node, data);
  });

  cy.on('tap', (evt) => {
    if (evt.target === cy) {
      cy.elements().removeClass('dimmed highlighted');
      cy.$(':selected').unselect();
      document.getElementById('context-panel')!.classList.add('hidden');
      const backBtn = document.getElementById('nav-back') as HTMLButtonElement;
      const fwdBtn  = document.getElementById('nav-fwd')  as HTMLButtonElement;
      backBtn.disabled = true;
      fwdBtn.disabled  = true;
    }
  });

  document.getElementById('nav-back')!.addEventListener('click', () => {
    const selected = cy.$('node:selected');
    if (selected.length === 0) return;
    const prev = (selected[0] as NodeSingular).incomers('node');
    if (prev.length === 0) return;
    const idx = Math.floor(Math.random() * prev.length);
    selectNode(cy, prev[idx] as NodeSingular, data);
  });

  document.getElementById('nav-fwd')!.addEventListener('click', () => {
    const selected = cy.$('node:selected');
    if (selected.length === 0) return;
    const next = (selected[0] as NodeSingular).outgoers('node');
    if (next.length === 0) return;
    const idx = Math.floor(Math.random() * next.length);
    selectNode(cy, next[idx] as NodeSingular, data);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const cy = initGraph(CONCEPT_DATA);
  attachNodeHandlers(cy, CONCEPT_DATA);
  selectNode(cy, pickRootNode(cy), CONCEPT_DATA);
});
