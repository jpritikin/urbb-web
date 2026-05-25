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

const BOOKMARKS_KEY = 'concept-bookmarks';
const glitchCache = new Map<string, string>();
const TOTAL_CONCEPTS = Object.keys(CONCEPT_DATA?.concepts ?? {}).length;

const OFF_PATH_MESSAGES = [
    'roaming freely · no path selected',
    'off the field · click Set Path to blaze a trail',
    'untethered · wandering the concept wilderness',
    'path? what path? · freelancing through the nodes',
    'signal lost · last known path: unknown',
    'off-piste · select two nodes and hit Set Path',
    'no breadcrumbs · you are on your own out here',
    'free range concept browsing · no itinerary',
];

// ── State ────────────────────────────────────────────────────────────────────
// Two most-recently-tapped nodes; [0] = older ("prev"), [1] = newer ("active")
let selectedPair: [string, string] = ['', ''];
let activePath: string[] | null = null;
let pathCursor: number = 0;
let globalCy: Core | null = null;
let globalData: ConceptGraphData | null = null;

// ── Bookmarks ─────────────────────────────────────────────────────────────────

function loadBookmarks(): Set<string> {
    try {
        const raw = localStorage.getItem(BOOKMARKS_KEY);
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
        return new Set();
    }
}

function saveBookmarks(bookmarks: Set<string>): void {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...bookmarks]));
}

// ── Graph construction ────────────────────────────────────────────────────────

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

// BFS over undirected edges; returns ordered node ID array or null.
function findShortestPath(cy: Core, fromId: string, toId: string): string[] | null {
    if (fromId === toId) return [fromId];
    const prev = new Map<string, string>();
    const visited = new Set<string>([fromId]);
    const queue: string[] = [fromId];
    while (queue.length > 0) {
        const curr = queue.shift()!;
        const neighbors = (cy.getElementById(curr) as NodeSingular).connectedEdges().connectedNodes();
        for (let i = 0; i < neighbors.length; i++) {
            const nbId = neighbors[i].id();
            if (!visited.has(nbId)) {
                visited.add(nbId);
                prev.set(nbId, curr);
                if (nbId === toId) {
                    const path: string[] = [];
                    let cur: string | undefined = toId;
                    while (cur !== undefined) { path.unshift(cur); cur = prev.get(cur); }
                    return path;
                }
                queue.push(nbId);
            }
        }
    }
    return null;
}

// Pick two nodes that share at least one edge.
function pickStartingPair(cy: Core): [string, string] {
    const allEdges = cy.edges();
    const idx = Math.floor(Math.random() * allEdges.length);
    const edge = allEdges[idx];
    return [edge.source().id(), edge.target().id()];
}

// ── Render ────────────────────────────────────────────────────────────────────
// Single function that derives all visual state from selectedPair / activePath / pathCursor.

function render(cy: Core): void {
    const activeId = selectedPair[1];
    const prevId = selectedPair[0];

    // 1. Reset all classes
    cy.elements().removeClass('dimmed highlighted path-edge active-node prev-node');

    // 2. Dim everything, then selectively undim
    cy.elements().addClass('dimmed');

    if (activeId) {
        const active = cy.getElementById(activeId) as NodeSingular;
        active.removeClass('dimmed');
        active.connectedEdges().removeClass('dimmed').addClass('highlighted');
        active.connectedEdges().connectedNodes().removeClass('dimmed');
        active.connectedEdges().connectedNodes().connectedEdges().removeClass('dimmed');
    }
    if (prevId) {
        cy.getElementById(prevId).removeClass('dimmed');
    }

    // 3. Path overlay — undim path nodes/edges and mark path edges
    if (activePath) {
        for (const id of activePath) cy.getElementById(id).removeClass('dimmed');
        for (let i = 0; i < activePath.length - 1; i++) {
            const a = activePath[i], b = activePath[i + 1];
            cy.edges(`[source="${a}"][target="${b}"], [source="${b}"][target="${a}"]`)
                .removeClass('dimmed').addClass('path-edge');
        }
    }

    // 4. Selection markers (applied last so they win over dimmed)
    cy.nodes().removeClass('active-node prev-node');
    if (activeId) cy.getElementById(activeId).addClass('active-node');
    if (prevId) cy.getElementById(prevId).addClass('prev-node');

    // 5. Nav buttons
    const backBtn = document.getElementById('nav-back') as HTMLButtonElement;
    const fwdBtn = document.getElementById('nav-fwd') as HTMLButtonElement;
    if (activePath) {
        backBtn.disabled = pathCursor <= 0;
        fwdBtn.disabled = pathCursor >= activePath.length - 1;
    } else if (activeId) {
        const node = cy.getElementById(activeId) as NodeSingular;
        backBtn.disabled = node.incomers('node').length === 0;
        fwdBtn.disabled = node.outgoers('node').length === 0;
    } else {
        backBtn.disabled = true;
        fwdBtn.disabled = true;
    }

    // 6. Path status bar
    const statusEl = document.getElementById('path-status')!;
    if (activePath) {
        statusEl.textContent = `PATH · ${activePath.length} nodes · step ${pathCursor + 1}/${activePath.length}`;
    } else {
        statusEl.textContent = OFF_PATH_MESSAGES[Math.floor(Math.random() * OFF_PATH_MESSAGES.length)];
    }
}

// ── Actions ───────────────────────────────────────────────────────────────────

function tapNode(cy: Core, node: NodeSingular): void {
    const id = node.id();
    if (id === selectedPair[1]) return;
    selectedPair = [selectedPair[1], id];
    // Tapping a node clears any active path
    activePath = null;
    render(cy);
    if (globalData) renderContextPanel(globalData, id);
}

function setPath(cy: Core, path: string[], cursor: number): void {
    activePath = path;
    pathCursor = cursor;
    selectedPair = [path[0], path[cursor]];
    render(cy);
    if (globalData) renderContextPanel(globalData, selectedPair[1]);
}

// ── Celebration ───────────────────────────────────────────────────────────────

function triggerCelebration(data: ConceptGraphData): void {
    const overlay = document.createElement('div');
    overlay.id = 'celebration-overlay';
    overlay.innerHTML = `
        <div class="celebration-inner">
            <div class="celebration-title">✦ ALL CONCEPTS MAPPED ✦</div>
            <div class="celebration-sub">You have traversed the full conceptual territory<br>of <em>Religion Unburdened by Belief</em></div>
            <div class="celebration-count">${Object.keys(data.concepts).length} nodes charted</div>
            <button class="celebration-close graph-nav-btn">Dismiss</button>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.celebration-close')!.addEventListener('click', () => overlay.remove());
    setTimeout(() => overlay.remove(), 8000);
}

// ── Context panel ─────────────────────────────────────────────────────────────

function renderContextPanel(data: ConceptGraphData, conceptId: string): void {
    const def = data.concepts[conceptId];
    if (!def) return;

    const panel = document.getElementById('context-panel')!;
    const title = document.getElementById('context-title')!;
    const desc = document.getElementById('context-desc')!;
    const snippets = document.getElementById('context-snippets')!;

    const bookmarks = loadBookmarks();
    const isBookmarked = bookmarks.has(conceptId);

    title.textContent = def.label;
    const starContainer = document.getElementById('context-star')!;
    starContainer.innerHTML = '';
    const starBtn = document.createElement('button');
    starBtn.className = 'bookmark-star' + (isBookmarked ? ' bookmarked' : '');
    starBtn.title = isBookmarked ? 'Remove bookmark' : 'Bookmark this concept';
    starBtn.textContent = isBookmarked ? '★' : '☆';
    starBtn.addEventListener('click', () => {
        const bm = loadBookmarks();
        if (bm.has(conceptId)) { bm.delete(conceptId); } else { bm.add(conceptId); }
        saveBookmarks(bm);
        syncBookmarkStyles(globalCy);
        updateBookmarkCounter();
        renderContextPanel(data, conceptId);
        if (bm.size === TOTAL_CONCEPTS) triggerCelebration(data);
    });
    starContainer.appendChild(starBtn);

    desc.textContent = def.desc;
    snippets.innerHTML = '';

    for (const interview of data.interviews) {
        const snippet = interview.contextSnippets[conceptId];
        if (!snippet) continue;

        const card = document.createElement('div');
        card.className = 'snippet-card';

        const header = document.createElement('div');
        header.className = 'snippet-header';
        header.innerHTML = `<span class="snippet-show">${interview.show}</span>`;

        const text = document.createElement('div');
        text.className = 'snippet-text';
        const cacheKey = `${interview.id}:${conceptId}`;
        const glitched = glitchCache.get(cacheKey) ?? glitchSnippet(snippet);
        glitchCache.set(cacheKey, glitched);
        text.textContent = `"…${glitched}…"`;

        const link = document.createElement('a');
        link.className = 'snippet-link';
        link.href = interview.url;
        link.textContent = '→ full transcript';

        card.appendChild(header);
        card.appendChild(text);
        card.appendChild(link);
        snippets.appendChild(card);
    }

    panel.classList.remove('hidden');
}

// ── Bookmark counter ──────────────────────────────────────────────────────────

const MOOD_EMOJIS = ['😭', '😢', '😟', '😐', '🙂', '😊', '😄', '🤩'];

function updateBookmarkCounter(): void {
    const count = loadBookmarks().size;
    const el = document.getElementById('bookmark-count');
    if (el) el.textContent = String(count);
    const counter = document.getElementById('bookmark-counter');
    if (counter) counter.classList.toggle('all-starred', count === TOTAL_CONCEPTS);
    const mood = document.getElementById('bookmark-mood');
    if (mood) {
        const idx = TOTAL_CONCEPTS === 0 ? 0
            : Math.round((count / TOTAL_CONCEPTS) * (MOOD_EMOJIS.length - 1));
        mood.textContent = MOOD_EMOJIS[idx];
    }
}

function syncBookmarkStyles(cy: Core | null): void {
    if (!cy) return;
    const bookmarks = loadBookmarks();
    cy.nodes().forEach(n => {
        if (bookmarks.has(n.id())) { n.addClass('bookmarked'); } else { n.removeClass('bookmarked'); }
    });
}

// ── Event handlers ────────────────────────────────────────────────────────────

function attachNodeHandlers(cy: Core, data: ConceptGraphData): void {
    cy.on('tap', 'node', (evt) => {
        tapNode(cy, evt.target as NodeSingular);
    });

    document.getElementById('set-path')!.addEventListener('click', () => {
        const [a, b] = selectedPair;
        if (!a || !b) return;
        const path = findShortestPath(cy, a, b);
        if (path) {
            setPath(cy, path, path.length - 1);
        } else {
            const statusEl = document.getElementById('path-status')!;
            statusEl.textContent = '⚠ no path between these nodes';
            statusEl.classList.remove('hidden');
        }
    });

    document.getElementById('nav-back')!.addEventListener('click', () => {
        if (activePath) {
            if (pathCursor <= 0) return;
            pathCursor--;
            selectedPair = [selectedPair[0], activePath[pathCursor]];
            render(cy);
            renderContextPanel(data, activePath[pathCursor]);
            return;
        }
        const activeId = selectedPair[1];
        if (!activeId) return;
        const prev = (cy.getElementById(activeId) as NodeSingular).incomers('node');
        if (prev.length === 0) return;
        tapNode(cy, prev[Math.floor(Math.random() * prev.length)] as NodeSingular);
    });

    document.getElementById('nav-fwd')!.addEventListener('click', () => {
        if (activePath) {
            if (pathCursor >= activePath.length - 1) return;
            pathCursor++;
            selectedPair = [selectedPair[0], activePath[pathCursor]];
            render(cy);
            renderContextPanel(data, activePath[pathCursor]);
            return;
        }
        const activeId = selectedPair[1];
        if (!activeId) return;
        const next = (cy.getElementById(activeId) as NodeSingular).outgoers('node');
        if (next.length === 0) return;
        tapNode(cy, next[Math.floor(Math.random() * next.length)] as NodeSingular);
    });
}

// ── Graph init ────────────────────────────────────────────────────────────────

function initGraph(data: ConceptGraphData): Core {
    const edges = buildEdges(data);

    const nodes = Object.entries(data.concepts).map(([id, def]) => ({
        data: { id, label: def.label },
    }));

    const edgeElements = Array.from(edges.entries()).map(([key]) => {
        const [source, target] = key.split('||');
        return { data: { id: key, source, target } };
    });

    return cytoscape({
        container: document.getElementById('cy'),
        elements: { nodes, edges: edgeElements },
        selectionType: 'additive',
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
                selector: 'node.active-node, node.prev-node',
                style: {
                    'border-color': '#ef4444',
                    'border-width': '6px',
                    'border-opacity': 1,
                    'background-color': '#b45309',
                    'width': 30,
                    'height': 30,
                },
            },
            {
                selector: 'node.dimmed',
                style: { 'opacity': 0.2 },
            },
            {
                selector: 'node.bookmarked',
                style: {
                    'background-color': '#7c3aed',
                    'border-color': '#c4b5fd',
                    'border-width': '2px',
                    'border-opacity': 0.9,
                },
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
            {
                selector: 'edge.path-edge',
                style: {
                    'line-color': '#fbbf24',
                    'target-arrow-color': '#fbbf24',
                    'width': 3,
                    'opacity': 1,
                },
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
}

// ── Glitch ────────────────────────────────────────────────────────────────────

const GLITCH_MISHEARINGS: [RegExp, string][] = [
    [/serotonergic/gi, 'Sarah-tonergic [sic]'],
    [/psychedelic/gi, 'psyche-deli-c [sic]'],
    [/psilocybin/gi, 'silly-sibin [sic]'],
    [/neurophenomenology/gi, 'neuro-phenom-ology [sic]'],
    [/incompleteness/gi, 'in-complete-ness [sic]'],
    [/sub-personality/gi, 'sub-purr-sonality [sic]'],
    [/subpersonalit/gi, 'sub-purr-sonalit [sic]'],
    [/entheogens?/gi, 'enthe-oh-gens [sic]'],
    [/entheogenic/gi, 'enthe-oh-genic [sic]'],
    [/panpsychism/gi, 'pan-psyche-ism [sic]'],
    [/IFS/g, 'I.F.S.'],
];

const GLITCH_INSERTIONS = [
    '[crosstalk]',
    '[audio dropout]',
    '[laughter]',
    '[pause]',
    '[inaudible]',
    '[recording artifact]',
];

function glitchSnippet(text: string): string {
    let result = text;
    let glitched = false;

    for (const [pattern, replacement] of GLITCH_MISHEARINGS) {
        if (Math.random() < 0.5 && pattern.test(result)) {
            result = result.replace(pattern, replacement);
            pattern.lastIndex = 0;
            glitched = true;
        }
    }

    const numInsertions = Math.random() < 0.7 ? 1 : 2;
    for (let i = 0; i < numInsertions; i++) {
        const words = result.split(' ');
        const insertAt = Math.floor(Math.random() * (words.length - 1)) + 1;
        const insertion = GLITCH_INSERTIONS[Math.floor(Math.random() * GLITCH_INSERTIONS.length)];
        words.splice(insertAt, 0, insertion);
        result = words.join(' ');
        glitched = true;
    }

    if (Math.random() < 0.6) {
        const chars = result.split('');
        const numCorruptions = Math.floor(Math.random() * 16) + 2;
        for (let i = 0; i < numCorruptions; i++) {
            const pos = Math.floor(Math.random() * chars.length);
            if (chars[pos] !== ' ' && chars[pos] !== '[') chars[pos] = '_';
        }
        result = chars.join('');
    }

    if (Math.random() < 0.25) {
        const sentences = result.split('. ');
        if (sentences.length > 1) {
            const cut = Math.floor(Math.random() * (sentences.length - 1)) + 1;
            result = sentences.slice(0, cut).join('. ') + '. [transcript ends]';
            glitched = true;
        }
    }

    void glitched;
    return result;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

declare global {
    interface Window {
        debugStarAll: () => void;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const cy = initGraph(CONCEPT_DATA);
    globalCy = cy;
    globalData = CONCEPT_DATA;
    syncBookmarkStyles(cy);
    updateBookmarkCounter();
    attachNodeHandlers(cy, CONCEPT_DATA);

    const [idA, idB] = pickStartingPair(cy);
    const initPath = findShortestPath(cy, idA, idB)!;
    setPath(cy, initPath, initPath.length - 1);

    window.debugStarAll = () => {
        const bm = new Set(Object.keys(CONCEPT_DATA.concepts));
        saveBookmarks(bm);
        syncBookmarkStyles(cy);
        updateBookmarkCounter();
        triggerCelebration(CONCEPT_DATA);
    };
});
