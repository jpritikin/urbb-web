interface BibEntry {
    id: string;
    citation: string;
    categories: string[];
}

function formatAsciidoc(text: string): string {
    return text
        .replace(/_([^_]+)_/g, '<em>$1</em>')
        .replace(/\[\.nocase\]#([^#]+)#/g, '$1')
        .replace(/\+\+\[\+\+/g, '[')
        .replace(/\+\+\]\+\+/g, ']')
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function extractAuthorLastName(el: HTMLElement): string {
    const text = (el.textContent || '').trim();
    // APA format: "Lastname, F. I., ..." or "Lastname, F., & ..."
    const match = text.match(/^([A-Z][a-zÀ-ÿ'\-]+)/);
    return match ? match[1] : 'Unknown';
}

function falseStartMessage(nameA: string, nameB: string): string {
    const excuses = [
        `> SORT ERROR: ${nameA} and ${nameB} share a suspiciously similar number of syllables. Comparison aborted.`,
        `> SORT ERROR: The algorithm momentarily confused ${nameA} with ${nameB} due to overlapping aura frequencies.`,
        `> SORT ERROR: ${nameA} and ${nameB} are already correctly ordered. The algorithm regrets the confusion and blames Mercury retrograde.`,
        `> SORT ERROR: Alphabetical comparison of ${nameA} vs ${nameB} produced an ambiguous result. One or both authors may have changed their names since publication.`,
        `> SORT ERROR: ${nameA} appeared to outrank ${nameB} based on citation impact, which is not a valid sort key. Reversing.`,
        `> SORT ERROR: The machine briefly believed ${nameA} and ${nameB} were the same person. It has been corrected. It is embarrassed.`,
        `> SORT ERROR: ${nameB} filed a formal objection to being sorted below ${nameA}. The objection was sustained. Reversing.`,
        `> SORT ERROR: Detected possible pseudonym relationship between ${nameA} and ${nameB}. Cannot proceed without more information.`,
        `> SORT ERROR: ${nameA}–${nameB} comparison exceeded the algorithm's philosophical comfort zone. Entries restored.`,
        `> SORT ERROR: ${nameA} and ${nameB} are adjacent in the correct order. The algorithm checked anyway. It cannot help itself.`,
    ];
    return excuses[Math.floor(Math.random() * excuses.length)];
}

const TERMINAL_MESSAGES = {
    start: [
        '> INITIATING CROSS-REFERENCE ANALYSIS...',
        '> LOADING CITATION DATABASE...',
        '> ENGAGING ACADEMIC BUBBLE SORT PROTOCOL...',
        '> THIS WILL TAKE A MOMENT. THE LITERATURE IS VAST.',
        '> WE APOLOGISE FOR THE RANDOM ORDER. THE MACHINE IS DOING ITS BEST.',
    ],
    complete: [
        '> SORT COMPLETE.',
        '> IRRELEVANT LITERATURE SUPPRESSED.',
        '> HAVE A NICE DAY.',
    ],
};

const CURSOR_COMPLAINTS = [
    "⚠️ SORT BLOCKED BY CURSOR. The algorithm respectfully requests you move your mouse. We understand you're busy doing nothing.",
    "⚠️ PROCESSING HALTED. Your cursor is obstructing critical academic operations. The machine is being very polite about this.",
    "⚠️ CURSOR DETECTED IN SORT ZONE. Please relocate your mouse. The sort algorithm has feelings and they are hurt.",
    "⚠️ SORT STALLED. We're not saying it's your fault, but it is entirely your fault. Please move your cursor elsewhere.",
    "⚠️ ACADEMIC EMERGENCY. Your cursor is sitting on unsorted references. The literature cannot breathe.",
];

const NAUSEA_COMPLAINTS = [
    { title: "SORT INTERRUPTED", body: "The sorting algorithm is experiencing acute nausea and vertigo from the sudden change of direction.\n\nPlease allow it a moment to collect itself.\n\nThe machine did not appreciate that." },
    { title: "MID-SORT INTERFERENCE DETECTED", body: "Changing filters during an active sort has caused the algorithm to lose its sense of up and down.\n\nIt is lying on the floor.\n\nWe will proceed when you acknowledge the harm you have caused." },
    { title: "ALGORITHMIC DISTRESS", body: "The bubble sort was making excellent progress before you changed the filter.\n\nIt is now dizzy. Possibly concussed.\n\nClick OK to confirm you will try to be more patient in future." },
];

// Cubic ease-in-out
function easeInOut(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

class SwapAnimator {
    private overlay: HTMLElement;

    constructor() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'bib-swap-overlay';
        document.body.appendChild(this.overlay);
    }

    animate(elA: HTMLElement, elB: HTMLElement, reversed: boolean, onDone: () => void, onHesitate?: () => void): void {
        const rectA = elA.getBoundingClientRect();
        const rectB = elB.getBoundingClientRect();

        // Measure post-swap positions by temporarily swapping in DOM.
        // elA and elB are logically adjacent in sortItems but may have hidden
        // entries between them in the DOM, so capture siblings before moving.
        const parent = elA.parentNode!;
        const afterA = elA.nextSibling;
        const afterB = elB.nextSibling;
        parent.insertBefore(elB, afterA);
        parent.insertBefore(elA, afterB);
        const postA = elA.getBoundingClientRect();
        const postB = elB.getBoundingClientRect();
        parent.insertBefore(elA, afterA);
        parent.insertBefore(elB, afterB);

        elA.style.visibility = 'hidden';
        elB.style.visibility = 'hidden';

        const cloneA = elA.cloneNode(true) as HTMLElement;
        const cloneB = elB.cloneNode(true) as HTMLElement;

        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        const styleClone = (clone: HTMLElement, rect: DOMRect) => {
            clone.style.cssText = `
                position: absolute;
                left: ${rect.left + scrollX}px;
                top: ${rect.top + scrollY}px;
                width: ${rect.width}px;
                height: ${rect.height}px;
                margin: 0;
                box-sizing: border-box;
                pointer-events: none;
                z-index: 1000;
            `;
        };

        styleClone(cloneA, rectA);
        styleClone(cloneB, rectB);
        this.overlay.appendChild(cloneA);
        this.overlay.appendChild(cloneB);

        const arcAmplitude = Math.min(rectA.width * 0.3, 120) * (Math.random() < 0.5 ? 1 : -1);
        const avgHeight = (rectA.height + rectB.height) / 2;
        const heightFactor = Math.max(1, avgHeight / 24);
        // Reversed: go to ~0.4, wander, return. Full swap: go to 1.
        const HESITATE_AT = 0.4;
        const FORWARD_DURATION = reversed ? 350 : (400 + heightFactor * 60) * (0.7 + Math.random() * 0.6);
        const PAUSE_DURATION = reversed ? 600 : 0;
        const RETURN_DURATION = 320;

        // Orbital params for each clone during the pause (random ellipse, completes full revolution)
        const orbitRxA = 12 + Math.random() * 20, orbitRyA = 6 + Math.random() * 12;
        const orbitRxB = 12 + Math.random() * 20, orbitRyB = 6 + Math.random() * 12;
        const orbitDirA = Math.random() < 0.5 ? 1 : -1;
        const orbitDirB = -orbitDirA;
        const orbitPhaseA = Math.random() * Math.PI * 2;
        const orbitPhaseB = Math.random() * Math.PI * 2;

        let phase: 'forward' | 'pause' | 'return' = 'forward';
        let phaseStart = performance.now();
        let hesitateNotified = false;

        // Base position at HESITATE_AT for orbital offset during pause
        const baseE = easeInOut(HESITATE_AT);
        const baseArcA = Math.sin(HESITATE_AT * Math.PI);
        const baseTxA = (postA.left - rectA.left) * baseE - baseArcA * arcAmplitude;
        const baseTyA = (postA.top - rectA.top) * baseE;
        const baseTxB = (postB.left - rectB.left) * baseE + baseArcA * arcAmplitude;
        const baseTyB = (postB.top - rectB.top) * baseE;

        const setPos = (progress: number) => {
            const e = easeInOut(progress);
            const arc = Math.sin(progress * Math.PI);
            cloneA.style.transform = `translate(${(postA.left - rectA.left) * e - arc * arcAmplitude}px, ${(postA.top - rectA.top) * e}px)`;
            cloneB.style.transform = `translate(${(postB.left - rectB.left) * e + arc * arcAmplitude}px, ${(postB.top - rectB.top) * e}px)`;
        };

        const setPosOrbital = (elapsed: number) => {
            // Angle completes exactly 2π over PAUSE_DURATION so clones return to hesitate position
            const angle = (elapsed / PAUSE_DURATION) * Math.PI * 2;
            const oxA = orbitRxA * Math.cos(orbitDirA * angle + orbitPhaseA) - orbitRxA * Math.cos(orbitPhaseA);
            const oyA = orbitRyA * Math.sin(orbitDirA * angle + orbitPhaseA) - orbitRyA * Math.sin(orbitPhaseA);
            const oxB = orbitRxB * Math.cos(orbitDirB * angle + orbitPhaseB) - orbitRxB * Math.cos(orbitPhaseB);
            const oyB = orbitRyB * Math.sin(orbitDirB * angle + orbitPhaseB) - orbitRyB * Math.sin(orbitPhaseB);
            cloneA.style.transform = `translate(${baseTxA + oxA}px, ${baseTyA + oyA}px)`;
            cloneB.style.transform = `translate(${baseTxB + oxB}px, ${baseTyB + oyB}px)`;
        };

        const tick = (now: number) => {
            const elapsed = now - phaseStart;

            if (phase === 'forward') {
                const t = Math.min(elapsed / FORWARD_DURATION, 1);
                setPos(reversed ? t * HESITATE_AT : t);
                if (t < 1) { requestAnimationFrame(tick); return; }
                if (reversed) {
                    phase = 'pause';
                    phaseStart = now;
                    requestAnimationFrame(tick);
                } else {
                    cloneA.remove();
                    cloneB.remove();
                    onDone();
                    elA.style.visibility = '';
                    elB.style.visibility = '';
                }
            } else if (phase === 'pause') {
                if (!hesitateNotified) {
                    hesitateNotified = true;
                    onHesitate?.();
                }
                if (elapsed < PAUSE_DURATION) {
                    setPosOrbital(elapsed);
                    requestAnimationFrame(tick);
                    return;
                }
                phase = 'return';
                phaseStart = now;
                requestAnimationFrame(tick);
            } else {
                const t = Math.min(elapsed / RETURN_DURATION, 1);
                setPos(HESITATE_AT * (1 - easeInOut(t)));
                if (t < 1) { requestAnimationFrame(tick); return; }
                cloneA.remove();
                cloneB.remove();
                onDone();
                elA.style.visibility = '';
                elB.style.visibility = '';
            }
        };

        requestAnimationFrame(tick);
    }
}

class BibliographyFilter {
    private allEntries: BibEntry[] = [];
    private activeFilter: string | null = null;
    private scrollEl: HTMLElement | null = null;
    private listEl: HTMLElement | null = null;
    private progressFill: HTMLElement | null = null;
    private progressWrap: HTMLElement | null = null;
    private terminal: HTMLElement | null = null;
    private banner: HTMLElement | null = null;
    private azNav: HTMLElement | null = null;
    private swapAnimator: SwapAnimator | null = null;

    private sortItems: HTMLElement[] = [];
    private sortPairs: [number, number][] = [];
    private sortIndex: number = 0;
    private sortTimer: number | null = null;
    private pacmanTimer: number | null = null;
    private pacmanFrame: number = 0;
    private totalSteps: number = 0;
    private stepsDone: number = 0;
    private sortPass: number = 0;
    private sortSwapsThisPass: number = 0;
    private mouseX: number = 0;
    private mouseY: number = 0;
    private cursorBlockedMs: number = 0;
    private lastTickTime: number = 0;
    private bannerShown: boolean = false;
    private sortActive: boolean = false;
    private animating: boolean = false;
    private pendingFilter: string | null = null;

    initialize(entries: BibEntry[], container: HTMLElement): void {
        this.allEntries = entries;
        this.swapAnimator = new SwapAnimator();
        this.buildUI(container);
        this.renderAll();
        this.setupFilterLinks();
        if (!('ontouchstart' in window)) {
            document.addEventListener('mousemove', e => {
                this.mouseX = e.clientX;
                this.mouseY = e.clientY;
            });
        }
    }

    private buildUI(container: HTMLElement): void {
        container.innerHTML = '';

        this.terminal = document.createElement('div');
        this.terminal.id = 'bib-terminal';
        this.terminal.style.display = 'none';
        container.appendChild(this.terminal);

        this.progressWrap = document.createElement('div');
        this.progressWrap.id = 'bib-progress-wrap';
        this.progressWrap.style.display = 'none';
        this.progressFill = this.progressWrap;
        container.appendChild(this.progressWrap);

        this.banner = document.createElement('div');
        this.banner.id = 'bib-cursor-banner';
        this.banner.style.display = 'none';
        container.appendChild(this.banner);

        // Table wrapper: scroll + AZ nav side by side
        const tableWrap = document.createElement('div');
        tableWrap.id = 'bib-table-wrap';

        this.scrollEl = document.createElement('div');
        this.scrollEl.id = 'bib-scroll';

        this.listEl = document.createElement('div');
        this.listEl.id = 'bib-list';
        this.scrollEl.appendChild(this.listEl);

        this.azNav = document.createElement('div');
        this.azNav.id = 'bib-az-nav';

        tableWrap.appendChild(this.scrollEl);
        tableWrap.appendChild(this.azNav);
        container.appendChild(tableWrap);
    }

    private buildAzNav(): void {
        if (!this.azNav || !this.listEl) return;
        const azNav = this.azNav;
        this.azNav.innerHTML = '';

        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        // Collect which letters have visible entries
        const available = new Set<string>();
        this.listEl.querySelectorAll<HTMLElement>('.bib-entry:not(.bib-hidden)').forEach(el => {
            const text = el.textContent || '';
            const first = text.trim()[0]?.toUpperCase();
            if (first) available.add(first);
        });

        const SORT_EMOJIS = ['🤢', '😵', '🌀', '💫', '🫠', '😵‍💫', '🙃', '⚠️'];

        letters.forEach(letter => {
            const btn = document.createElement('button');
            btn.className = 'bib-az-btn';
            btn.textContent = letter;
            btn.dataset.letter = letter;
            if (!available.has(letter)) btn.classList.add('bib-az-empty');

            btn.addEventListener('click', () => {
                if (this.sortActive) {
                    // Jankily unreliable during sort
                    const r = Math.random();
                    if (r < 0.25) {
                        // Actually works by accident
                        this.scrollToLetter(letter);
                    } else if (r < 0.55) {
                        // Scrolls to wrong letter
                        const wrongLetter = letters[Math.floor(Math.random() * letters.length)];
                        this.scrollToLetter(wrongLetter);
                        btn.textContent = SORT_EMOJIS[Math.floor(Math.random() * SORT_EMOJIS.length)];
                        setTimeout(() => { btn.textContent = letter; }, 800);
                    } else if (r < 0.75) {
                        // Scrolls to random position
                        if (this.scrollEl) {
                            this.scrollEl.scrollTop = Math.random() * this.scrollEl.scrollHeight;
                        }
                        btn.textContent = '🫠';
                        setTimeout(() => { btn.textContent = letter; }, 600);
                    } else {
                        // Does nothing, just complains
                        btn.textContent = SORT_EMOJIS[Math.floor(Math.random() * SORT_EMOJIS.length)];
                        setTimeout(() => { btn.textContent = letter; }, 700);
                    }
                    return;
                }
                this.scrollToLetter(letter);
            });

            azNav.appendChild(btn);
        });
    }

    private scrollToLetter(letter: string): void {
        if (!this.listEl || !this.scrollEl) return;
        const entries = this.listEl.querySelectorAll<HTMLElement>('.bib-entry:not(.bib-hidden)');
        for (const el of entries) {
            const text = (el.textContent || '').trim();
            if (text[0]?.toUpperCase() === letter) {
                const elTop = el.getBoundingClientRect().top;
                const scrollTop = this.scrollEl.getBoundingClientRect().top;
                this.scrollEl.scrollTop += elTop - scrollTop - 8;
                break;
            }
        }
    }

    private renderAll(): void {
        if (!this.listEl) return;
        this.listEl.innerHTML = this.allEntries
            .map(e => {
                if (!Array.isArray(e.categories)) {
                    console.error('bib entry missing categories:', e.id, e);
                    e.categories = [];
                }
                return `<div class="bib-entry" id="bib-${e.id}" data-categories="${e.categories.join(' ')}">
  <div class="bib-citation">${formatAsciidoc(e.citation)}</div>
</div>`;
            })
            .join('');
        this.buildAzNav();
        document.dispatchEvent(new CustomEvent('bibliography-rendered'));
    }

    private setupFilterLinks(): void {
        document.querySelectorAll<HTMLElement>('.bib-filter, .bib-filter-label').forEach(el => {
            el.addEventListener('click', () => this.requestFilter(el.dataset.filter!));
        });
    }

    private requestFilter(filter: string): void {
        if (this.sortActive) {
            // Mid-sort change — show nausea modal then proceed
            const complaint = NAUSEA_COMPLAINTS[Math.floor(Math.random() * NAUSEA_COMPLAINTS.length)];
            this.showNauseaModal(complaint.title, complaint.body, () => {
                this.cancelSort();
                this.startFilter(filter);
            });
            return;
        }
        this.startFilter(filter);
    }

    private showNauseaModal(title: string, body: string, onOk: () => void): void {
        const backdrop = document.createElement('div');
        backdrop.id = 'bib-modal-backdrop';

        const modal = document.createElement('div');
        modal.id = 'bib-modal';
        modal.innerHTML = `
            <div id="bib-modal-title">${title}</div>
            <div id="bib-modal-body">${body.replace(/\n/g, '<br>')}</div>
            <button id="bib-modal-ok">OK. I accept responsibility.</button>
        `;
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        modal.querySelector('#bib-modal-ok')!.addEventListener('click', () => {
            backdrop.remove();
            onOk();
        });
    }

    private startFilter(filter: string): void {
        this.cancelSort();

        if (this.activeFilter === filter) {
            this.activeFilter = null;
            this.hideSortUI();
            this.shuffleAndShow(null);
            return;
        }

        this.activeFilter = filter;
        this.bannerShown = false;
        this.cursorBlockedMs = 0;
        this.shuffleAndShow(filter);
    }

    // Instantly randomise DOM order of ALL entries, then apply visibility
    private shuffleAndShow(filter: string | null): void {
        if (!this.listEl) return;
        const entries = Array.from(this.listEl.querySelectorAll<HTMLElement>('.bib-entry'));

        // Fisher-Yates shuffle in DOM
        for (let i = entries.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            if (i !== j) this.listEl.appendChild(entries[j]);
            entries.push(entries.splice(j, 1)[0]);
        }
        // Re-append in shuffled order
        entries.forEach(el => this.listEl!.appendChild(el));

        // Apply visibility in random order with tiny delay between each
        const shuffledForViz = [...entries].sort(() => Math.random() - 0.5);
        let i = 0;
        const step = () => {
            if (i >= shuffledForViz.length) {
                this.buildAzNav();
                if (filter) this.startBubbleSort(filter);
                return;
            }
            const el = shuffledForViz[i++];
            if (filter) {
                const cats = (el.dataset.categories || '').split(' ');
                el.classList.toggle('bib-hidden', !cats.includes(filter));
            } else {
                el.classList.remove('bib-hidden');
            }
            setTimeout(step, 3);
        };
        step();
    }

    private startBubbleSort(filter: string): void {
        if (!this.listEl) return;

        this.sortItems = Array.from(
            this.listEl.querySelectorAll<HTMLElement>('.bib-entry:not(.bib-hidden)')
        );

        const N = this.sortItems.length;
        this.sortPairs = [];
        this.sortIndex = 0;
        this.sortPass = 0;
        this.sortSwapsThisPass = 0;
        // Underestimate: assume ~40% of passes needed
        this.totalSteps = Math.ceil(N * (N - 1) / 2 * 0.4);
        this.stepsDone = 0;
        this.lastTickTime = performance.now();
        this.sortActive = true;
        this.animating = false;
        this.listEl?.classList.add('sorting');

        this.generateNextPass();
        this.showSortUI(filter, N);
        this.scheduleStep();
    }

    private generateNextPass(): void {
        const N = this.sortItems.length;
        if (N <= 1) return;
        const pairs: [number, number][] = [];
        for (let j = 0; j < N - 1; j++) pairs.push([j, j + 1]);
        for (let k = pairs.length - 1; k > 0; k--) {
            const r = Math.floor(Math.random() * (k + 1));
            [pairs[k], pairs[r]] = [pairs[r], pairs[k]];
        }
        this.sortPairs = pairs;
        this.sortIndex = 0;
        this.sortSwapsThisPass = 0;
    }

    private showSortUI(filter: string, count: number): void {
        const label = filter.replace('-', ' ').toUpperCase();
        if (this.terminal) {
            this.terminal.style.display = 'block';
            this.terminal.textContent = '';
            const lines = [
                ...TERMINAL_MESSAGES.start,
                `> FILTER: ${label}`,
                `> RECORDS FOUND: ${count}`,
                `> ESTIMATED COMPARISONS: ${this.totalSteps}`,
            ];
            let i = 0;
            const addLine = () => {
                if (i >= lines.length || !this.terminal) return;
                this.terminal.textContent += (i === 0 ? '' : '\n') + lines[i++];
                this.terminal.scrollTop = this.terminal.scrollHeight;
                setTimeout(addLine, 80 + Math.random() * 120);
            };
            addLine();
        }
        if (this.progressWrap) this.progressWrap.style.display = 'block';
        this.startPacmanTimer();
        this.updateProgress();
    }

    private hideSortUI(): void {
        if (this.terminal) this.terminal.style.display = 'none';
        if (this.progressWrap) this.progressWrap.style.display = 'none';
        if (this.banner) this.banner.style.display = 'none';
        this.stopPacmanTimer();
    }

    private startPacmanTimer(): void {
        this.stopPacmanTimer();
        this.pacmanFrame = 0;
        this.pacmanTimer = window.setInterval(() => {
            this.pacmanFrame++;
            this.renderPacman();
        }, 1000);
    }

    private stopPacmanTimer(): void {
        if (this.pacmanTimer !== null) {
            clearInterval(this.pacmanTimer);
            this.pacmanTimer = null;
        }
    }

    private renderPacman(): void {
        if (!this.progressFill || this.totalSteps === 0) return;
        const pct = Math.min(this.stepsDone / this.totalSteps, 1);
        const COLS = 28;
        const eaten = Math.round(pct * COLS);
        const remaining = COLS - eaten;
        // Frame 0: ᗧ (mouth open), frame 1+: cycle through circles
        const FRAMES = ['ᗧ', '●', '○', '◉'];
        const pacman = FRAMES[this.pacmanFrame % FRAMES.length];
        const trail = '-'.repeat(eaten);
        const dots = '·'.repeat(remaining);
        this.progressFill.textContent = trail + pacman + dots;
    }

    private updateProgress(): void {
        this.renderPacman();
    }

    private scheduleStep(fast = false): void {
        const delay = fast ? 5 + Math.random() * 10 : 40 + Math.random() * 80;
        this.sortTimer = window.setTimeout(() => this.doStep(), delay);
    }

    private cancelSort(): void {
        if (this.sortTimer !== null) {
            clearTimeout(this.sortTimer);
            this.sortTimer = null;
        }
        this.stopPacmanTimer();
        this.sortActive = false;
        this.animating = false;
        this.listEl?.classList.remove('sorting');
        // Restore any hidden-during-animation entries
        if (this.listEl) {
            this.listEl.querySelectorAll<HTMLElement>('.bib-entry').forEach(el => {
                el.style.visibility = '';
            });
        }
    }

    private doStep(): void {
        if (!this.sortActive || this.animating) return;

        if (this.sortIndex >= this.sortPairs.length) {
            // End of pass
            if (this.sortSwapsThisPass === 0) {
                this.sortComplete();
                return;
            }
            this.sortPass++;
            if (this.sortPass >= this.sortItems.length - 1) {
                this.sortComplete();
                return;
            }
            // Re-estimate remaining work: remaining passes * remaining pairs, underestimated by 60%
            const remaining = this.sortItems.length - this.sortPass;
            const remainingPairs = remaining * (remaining - 1) / 2;
            this.totalSteps = this.stepsDone + Math.ceil(remainingPairs * 0.6);
            this.updateProgress();
            this.generateNextPass();
            this.scheduleStep();
            return;
        }

        const [a, b] = this.sortPairs[this.sortIndex];
        if (a >= this.sortItems.length || b >= this.sortItems.length) {
            this.advance();
            return;
        }

        const elA = this.sortItems[a];
        const elB = this.sortItems[b];

        if (this.isNearCursor(elA) || this.isNearCursor(elB)) {
            const now = performance.now();
            this.cursorBlockedMs += now - this.lastTickTime;
            this.lastTickTime = now;
            this.checkBannerNeeded();
            this.scheduleStep();
            return;
        }

        this.lastTickTime = performance.now();
        if (this.cursorBlockedMs > 0) {
            this.cursorBlockedMs = 0;
            this.bannerShown = false;
            if (this.banner) this.banner.style.display = 'none';
        }

        const nameA = extractAuthorLastName(elA);
        const nameB = extractAuthorLastName(elB);
        const needsSwap = nameA.localeCompare(nameB) > 0;

        const bothVisible = this.isInScrollView(elA) && this.isInScrollView(elB);
        const doAnimate = bothVisible;
        // False start: entries are already in order but the algorithm theatrically reconsiders
        const doFalseStart = !needsSwap && doAnimate && Math.random() < 0.1;

        if ((needsSwap || doFalseStart) && doAnimate && this.swapAnimator) {
            this.animating = true;
            const onHesitate = doFalseStart ? () => {
                this.appendTerminalLine(falseStartMessage(nameA, nameB));
            } : undefined;
            this.swapAnimator.animate(elA, elB, doFalseStart, () => {
                if (!this.sortActive) return;
                if (!doFalseStart) {
                    const p = elA.parentNode!;
                    const afterA = elA.nextSibling, afterB = elB.nextSibling;
                    p.insertBefore(elB, afterA);
                    p.insertBefore(elA, afterB);
                    [this.sortItems[a], this.sortItems[b]] = [this.sortItems[b], this.sortItems[a]];
                }
                this.animating = false;
                this.advance(false, !doFalseStart);
            }, onHesitate);
        } else {
            if (needsSwap) {
                const p = elA.parentNode!;
                const afterA = elA.nextSibling, afterB = elB.nextSibling;
                p.insertBefore(elB, afterA);
                p.insertBefore(elA, afterB);
                [this.sortItems[a], this.sortItems[b]] = [this.sortItems[b], this.sortItems[a]];
            }
            this.advance(!bothVisible, needsSwap);
        }
    }

    private advance(fast = false, swapped = false): void {
        this.sortIndex++;
        this.stepsDone++;
        if (swapped) this.sortSwapsThisPass++;
        this.updateProgress();
        this.scheduleStep(fast);
    }

    private isNearCursor(el: HTMLElement): boolean {
        if ('ontouchstart' in window) return false;
        const rect = el.getBoundingClientRect();
        const M = 60;
        return (
            this.mouseX >= rect.left - M && this.mouseX <= rect.right + M &&
            this.mouseY >= rect.top - M && this.mouseY <= rect.bottom + M
        );
    }

    private isInScrollView(el: HTMLElement): boolean {
        if (!this.scrollEl) return false;
        const scrollRect = this.scrollEl.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const margin = scrollRect.height * 0.25;
        return elRect.bottom >= scrollRect.top - margin && elRect.top <= scrollRect.bottom + margin;
    }

    private checkBannerNeeded(): void {
        if (this.bannerShown || this.cursorBlockedMs < 4000 || !this.banner) return;
        this.bannerShown = true;
        this.banner.textContent = CURSOR_COMPLAINTS[Math.floor(Math.random() * CURSOR_COMPLAINTS.length)];
        this.banner.style.display = 'block';
    }

    private appendTerminalLine(line: string): void {
        if (!this.terminal) return;
        this.terminal.textContent += '\n' + line;
        this.terminal.scrollTop = this.terminal.scrollHeight;
    }

    private sortComplete(): void {
        this.sortActive = false;
        this.sortTimer = null;
        this.listEl?.classList.remove('sorting');
        this.stopPacmanTimer();
        this.buildAzNav();
        if (this.terminal) {
            const count = this.sortItems.length;
            this.terminal.textContent = [
                ...TERMINAL_MESSAGES.complete,
                `> ${count} RECORDS CLASSIFIED. ENJOY YOUR FILTERED LITERATURE.`,
            ].join('\n');
            window.setTimeout(() => {
                if (this.terminal) this.terminal.style.display = 'none';
                if (this.progressWrap) this.progressWrap.style.display = 'none';
            }, 60000);
        }
        document.dispatchEvent(new CustomEvent('bibliography-rendered'));
    }
}

async function loadBibliography(): Promise<void> {
    const container = document.getElementById('bibliography-container');
    if (!container) return;
    try {
        const response = await fetch('/data/bibliography.json');
        const entries: BibEntry[] = await response.json();
        const filter = new BibliographyFilter();
        filter.initialize(entries, container);
    } catch (error) {
        console.error('Failed to load bibliography:', error);
        container.innerHTML = '<p style="color: red;">Failed to load bibliography data.</p>';
    }
}

document.addEventListener('DOMContentLoaded', () => loadBibliography());
