const ISBN_URL = '/data/hard-isbns.txt';

async function loadIsbns(): Promise<string[]> {
    const resp = await fetch(ISBN_URL);
    const text = await resp.text();
    return text.trim().split('\n').map(s => s.trim()).filter(Boolean);
}

const WATERMARKS = [
    'SHUTTERSTOCK', 'GETTY IMAGES', 'DO NOT STEAL', 'SAMPLE',
    'PROOF ONLY', 'NOT LICENSED', 'STOCK PHOTO'
];

const PEACOCK_COUNT = 8;

interface QuizQuestion {
    text: string;
    options: { label: string; score: number }[];
}

const QUIZ_QUESTIONS: QuizQuestion[] = [
    {
        text: 'Have you already checked how many covers you own?',
        options: [
            { label: 'Yes', score: 2 },
            { label: 'No', score: 0 },
        ],
    },
    {
        text: "Do you feel a slight twinge looking at covers you don't have?",
        options: [
            { label: 'Absolutely', score: 3 },
            { label: 'Maybe', score: 1 },
            { label: 'No', score: 0 },
        ],
    },
    {
        text: 'Would you buy a book you already own just for a different cover?',
        options: [
            { label: 'Without hesitation', score: 3 },
            { label: 'If on sale', score: 1 },
            { label: "That's insane", score: 0 },
        ],
    },
    {
        text: 'How do you feel about the number 50?',
        options: [
            { label: 'Manageable', score: 1 },
            { label: 'Terrifyingly large', score: 0 },
        ],
    },
    {
        text: 'Do you have a spreadsheet for tracking things you collect?',
        options: [
            { label: 'Several', score: 2 },
            { label: 'Just one', score: 1 },
            { label: 'No', score: 0 },
        ],
    },
];

const MAX_SCORE = QUIZ_QUESTIONS.reduce(
    (sum, q) => sum + Math.max(...q.options.map(o => o.score)), 0
);

function initCoverBrowser(isbns: string[]): void {
    const slider = document.getElementById('cover-slider') as HTMLInputElement | null;
    const coverImg = document.getElementById('cover-display') as HTMLImageElement | null;
    const isbnLabel = document.getElementById('isbn-label');
    if (!slider || !coverImg || !isbnLabel) return;

    slider.min = '0';
    slider.max = String(isbns.length - 1);
    slider.value = '0';

    const preloadCache = new Map<number, HTMLImageElement>();

    function coverPath(index: number): string {
        return `/images/supplement/covers/${isbns[index]}.webp`;
    }

    function preloadAround(index: number): void {
        for (let offset = -2; offset <= 2; offset++) {
            const i = index + offset;
            if (i >= 0 && i < isbns.length && !preloadCache.has(i)) {
                const img = new Image();
                img.src = coverPath(i);
                preloadCache.set(i, img);
            }
        }
    }

    function updateCover(index: number): void {
        coverImg!.src = coverPath(index);
        isbnLabel!.textContent = isbns[index];
        preloadAround(index);
    }

    slider.addEventListener('input', () => {
        updateCover(parseInt(slider.value, 10));
    });

    updateCover(0);
}

interface PeacockPlacement {
    xPct: number;
    yPct: number;
    rotation: number;
    widthPct: number;
    heightPct: number;
}

interface Rect { x: number; y: number; w: number; h: number; }

function overlapFraction(a: Rect, b: Rect): number {
    const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const intersection = ox * oy;
    const smaller = Math.min(a.w * a.h, b.w * b.h);
    return smaller > 0 ? intersection / smaller : 0;
}

function placementRect(p: PeacockPlacement): Rect {
    return { x: p.xPct, y: p.yPct, w: p.widthPct, h: p.heightPct };
}

function randomPlacement(aspectRatio: number): PeacockPlacement {
    const widthPct = 20 + Math.random() * 30;
    const heightPct = widthPct / aspectRatio;
    return {
        xPct: Math.random() * (100 - widthPct),
        yPct: Math.random() * (100 - heightPct),
        rotation: -30 + Math.random() * 60,
        widthPct,
        heightPct,
    };
}

const MAX_OVERLAP = 0.2;
const MAX_RETRIES = 20;

function findPlacement(aspectRatio: number, placed: PeacockPlacement[]): PeacockPlacement | null {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const candidate = randomPlacement(aspectRatio);
        const rect = placementRect(candidate);
        const ok = placed.every(p => overlapFraction(rect, placementRect(p)) <= MAX_OVERLAP);
        if (ok) return candidate;
    }
    return null;
}

function applyPlacement(tile: HTMLElement, p: PeacockPlacement): void {
    tile.style.left = `${p.xPct}%`;
    tile.style.top = `${p.yPct}%`;
    tile.style.width = `${p.widthPct}%`;
    tile.style.transform = `rotate(${p.rotation}deg)`;
    const montage = tile.parentElement;
    if (montage) {
        const tilePx = montage.clientWidth * p.widthPct / 100;
        const scale = window.innerWidth <= 768 ? 0.02 : 0.04;
        const overlay = tile.querySelector('.watermark-overlay') as HTMLElement | null;
        if (overlay) overlay.style.fontSize = `${tilePx * scale}px`;
    }
}

function getAspectRatio(tile: HTMLElement): number {
    const img = tile.querySelector('img');
    if (img && img.naturalWidth && img.naturalHeight) {
        return img.naturalWidth / img.naturalHeight;
    }
    return 1.5;
}

function placeTiles(tiles: NodeListOf<HTMLElement>): void {
    const placed: PeacockPlacement[] = [];
    tiles.forEach(tile => {
        const ar = getAspectRatio(tile);
        const p = findPlacement(ar, placed);
        if (p) {
            placed.push(p);
            applyPlacement(tile, p);
            tile.style.display = '';
        } else {
            tile.style.display = 'none';
        }
    });
}

function initPeacockWatermarks(): void {
    const tiles = document.querySelectorAll<HTMLElement>('.peacock-tile');

    tiles.forEach(tile => {
        const mark = WATERMARKS[Math.floor(Math.random() * WATERMARKS.length)];
        const overlay = document.createElement('div');
        overlay.className = 'watermark-overlay';
        overlay.textContent = mark;
        const askew = -8 + Math.random() * 16;
        overlay.style.transform = `translate(-50%, -50%) rotate(${askew}deg)`;
        tile.appendChild(overlay);
    });

    const images = Array.from(tiles).map(t => t.querySelector('img')!);
    let loaded = 0;
    const onReady = () => {
        loaded++;
        if (loaded >= images.length) placeTiles(tiles);
    };
    images.forEach(img => {
        if (img.complete) onReady();
        else img.addEventListener('load', onReady);
    });

    const montage = document.getElementById('peacock-montage');
    if (montage) {
        let lastMontageWidth = montage.offsetWidth;
        let resizeTimer: number | undefined;
        const ro = new ResizeObserver(() => {
            const newWidth = montage.offsetWidth;
            if (newWidth === lastMontageWidth) return;
            console.log(`[CoverCollector] montage width changed: ${lastMontageWidth} -> ${newWidth}`);
            lastMontageWidth = newWidth;
            clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => placeTiles(tiles), 300);
        });
        ro.observe(montage);
    }
}

interface QuizState {
    answers: (number | null)[];
}

function initCollectorQuiz(): void {
    const container = document.getElementById('collector-quiz');
    if (!container) return;

    const state: QuizState = { answers: new Array(QUIZ_QUESTIONS.length).fill(null) };

    const questionsHtml = QUIZ_QUESTIONS.map((q, qi) => `
    <div class="quiz-question" data-qi="${qi}">
      <p class="quiz-question-text">${q.text}</p>
      <div class="quiz-options">
        ${q.options.map((opt, oi) => `
          <label class="quiz-option">
            <input type="radio" name="quiz-q${qi}" value="${oi}">
            <span>${opt.label}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');

    container.innerHTML = `
    <div class="quiz-questions">${questionsHtml}</div>
    <button class="quiz-submit" disabled>Assess My Risk</button>
    <div class="quiz-result" style="display:none"></div>
  `;

    const submitBtn = container.querySelector('.quiz-submit') as HTMLButtonElement;
    const resultDiv = container.querySelector('.quiz-result') as HTMLElement;

    container.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.type !== 'radio') return;
        const questionDiv = target.closest('.quiz-question') as HTMLElement;
        const qi = parseInt(questionDiv.dataset.qi!, 10);
        state.answers[qi] = parseInt(target.value, 10);
        submitBtn.disabled = state.answers.some(a => a === null);
    });

    submitBtn.addEventListener('click', () => {
        const score = state.answers.reduce<number>((sum, optIdx, qi) => {
            return sum + (optIdx !== null ? QUIZ_QUESTIONS[qi].options[optIdx].score : 0);
        }, 0);
        resultDiv.style.display = 'block';
        resultDiv.classList.add('quiz-result-reveal');
        resultDiv.innerHTML = getResultHtml(score);
        resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
}

function getResultHtml(score: number): string {
    const ratio = score / MAX_SCORE;
    if (score === 0) {
        return `<div class="result-tier result-safe">
      <h4>🧘 Risk Level: Zen Master</h4>
      <p>You are at peace. One copy is enough. We admire your contentment.</p>
    </div>`;
    }
    if (ratio <= 0.2) {
        return `<div class="result-tier result-mild">
      <h4>😌 Risk Level: Mild Curiosity</h4>
      <p>A gentle flicker of interest. Nothing to worry about. Probably. Just...maybe don't browse the slider too much.</p>
    </div>`;
    }
    if (ratio <= 0.45) {
        return `<div class="result-tier result-moderate">
      <h4>👀 Risk Level: Noted With Concern</h4>
      <p>You lingered on that slider a little too long, didn't you? Each cover <em>is</em> procedurally unique. No two are alike. We're just stating facts here, not encouraging anything. Maybe you could be satisfied with just two copies? Pick your favorites and walk away. You <em>can</em> walk away.</p>
    </div>`;
    }
    if (ratio <= 0.7) {
        return `<div class="result-tier result-high">
      <h4>📊 Risk Level: Spreadsheet Imminent</h4>
      <p>You're calculating. Look, we tried to talk you out of it, but honestly? Giving in might be easier than fighting this. Each cover will never be printed again. We're not helping, are we? 😿</p>
    </div>`;
    }
    return `<div class="result-tier result-critical">
    <h4>🚨 Risk Level: Collector Singularity</h4>
    <p>There is no quiz result that can save you. You were always going to buy all 50 🎁. You're already thinking about storage solutions and whether ISBN order or visual aesthetic makes a better shelf arrangement. Godspeed, and may your bookshelves be sturdy.</p>
  </div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
    const pageVersion = document.querySelector('meta[name="page-version"]')?.getAttribute('content') || 'unknown';
    console.log('[CoverCollector] Page version:', pageVersion);

    const isbns = await loadIsbns();
    initCoverBrowser(isbns);
    initPeacockWatermarks();

    const revealBtn = document.getElementById('reveal-quiz-btn');
    const quizContainer = document.getElementById('collector-quiz');
    if (revealBtn && quizContainer) {
        revealBtn.addEventListener('click', () => {
            revealBtn.parentElement!.style.display = 'none';
            quizContainer.style.display = 'block';
            initCollectorQuiz();
            quizContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }
});
