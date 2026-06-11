import { Critter, isDebugMode, spawnCritterLayer } from './driftingCritters.js';

interface Review {
    reviewer: string;
    stars: number;
    date: string;
    text: string;
}

const PARODY_REVIEWS: Review[] = [
    {
        reviewer: 'DaemonPossessed1987',
        stars: 5,
        date: 'March 3, 2026',
        text: 'I opened this book and my houseplants immediately achieved enlightenment. They refuse to be watered now. They say they have transcended thirst. I blame the author personally.',
    },
    {
        reviewer: 'SkepticalProfessor42',
        stars: 1,
        date: 'April 1, 2026',
        text: 'I was promised religion WITHOUT belief. I still accidentally believed three things before breakfast. This book has failed to deliver on its core premise. One star.',
    },
    {
        reviewer: 'CastanedaWasRight',
        stars: 5,
        date: 'February 14, 2026',
        text: 'My IFS parts held a committee meeting about this book. The exile loved it. The manager gave it three stars but was overruled. The firefighter didn\'t finish it but felt very strongly about chapter seven. We have reached consensus: five stars.',
    },
    {
        reviewer: 'NeuroPhenomEnjoyer',
        stars: 4,
        date: 'January 9, 2026',
        text: 'Docked one star because the bibliography cited papers I have not read and now I feel obligated to read them. This book has given me homework. I did not consent to homework.',
    },
    {
        reviewer: 'SpiritualMarketingMBA',
        stars: 5,
        date: 'May 1, 2026',
        text: 'As a New Age influencer I came for the aesthetic and stayed for the citations. The footnotes alone cured my sciatica. My daemon wrote this review. I was not present for most of it.',
    },
];

const SCROLL_WIDTH_REM = 11;
const SCROLL_HEIGHT_PX = 90;
const MAX_ONSCREEN = 5;

function starsHtml(n: number): string {
    return Array.from({ length: 5 }, (_, i) =>
        `<span class="gr-scroll-star ${i < n ? 'lit' : ''}">${i < n ? '✦' : '✧'}</span>`
    ).join('');
}

function buildModal(): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'gr-review-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
    <div class="gr-review-modal-inner">
      <button class="gr-review-modal-close" aria-label="Close">✕</button>
      <div class="gr-review-modal-content">
        <div class="gr-review-modal-header">
          <span class="gr-review-modal-name"></span>
          <span class="gr-review-modal-stars"></span>
          <span class="gr-review-modal-date"></span>
        </div>
        <p class="gr-review-modal-text"></p>
        <a class="gr-review-modal-source no-underline hover:no-underline"
           href="https://www.goodreads.com/book/show/249868833-religion-unburdened-by-belief"
           target="_blank" rel="noopener">via Goodreads ↗</a>
      </div>
    </div>`;
    return modal;
}

function cardContentHtml(review: Review, emoji: string): string {
    const preview = review.text.slice(0, 80) + (review.text.length > 80 ? '…' : '');
    return `
    <div class="gr-scroll-seal">${emoji}</div>
    <div class="gr-scroll-inner">
      <div class="gr-scroll-header">
        <span class="gr-scroll-name">${review.reviewer}</span>
        <span class="gr-scroll-stars">${starsHtml(review.stars)}</span>
        <span class="gr-scroll-date">${review.date}</span>
      </div>
      <div class="gr-scroll-preview">"${preview}"</div>
    </div>`;
}

/** Hands out reviews at random while ensuring no two critters carry the same one
 * (unless the pool is too small to avoid it). */
class ReviewAllocator {
    private held = new Set<Review>();

    constructor(private pool: Review[]) {}

    take(previous?: Review): Review {
        if (previous) this.held.delete(previous);
        const available = this.pool.filter(r => !this.held.has(r));
        const choices = available.length > 0 ? available : this.pool;
        const choice = choices[Math.floor(Math.random() * choices.length)];
        this.held.add(choice);
        return choice;
    }
}

function reviewToCritter(allocator: ReviewAllocator): Critter {
    let current = allocator.take();
    return {
        buildCard(emoji: string): HTMLElement {
            const el = document.createElement('div');
            el.setAttribute('aria-label', `Review by ${current.reviewer} — click to read`);
            el.innerHTML = cardContentHtml(current, emoji);
            return el;
        },
        onRespawn(card: HTMLElement, emoji: string): void {
            current = allocator.take(current);
            card.setAttribute('aria-label', `Review by ${current.reviewer} — click to read`);
            card.innerHTML = cardContentHtml(current, emoji);
        },
        openModal(modal: HTMLElement): void {
            (modal.querySelector('.gr-review-modal-name') as HTMLElement).textContent = current.reviewer;
            (modal.querySelector('.gr-review-modal-stars') as HTMLElement).innerHTML = starsHtml(current.stars);
            (modal.querySelector('.gr-review-modal-date') as HTMLElement).textContent = current.date;
            const textEl = modal.querySelector('.gr-review-modal-text') as HTMLElement;
            textEl.innerHTML = current.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            (modal.querySelector('.gr-review-modal-close') as HTMLElement).focus();
        },
    };
}

export function initGoodreadsScrolls(anchorEl: HTMLElement): void {
    const debug = isDebugMode();
    fetch('https://data.unburdened.biz/reviews.json')
        .then(r => r.json())
        .then((data: { reviews: Review[]; fetchedAt?: string }) => {
            const reviews = [...(data.reviews ?? [])];
            console.log(`[grScrolls] R2 returned ${reviews.length} review(s), fetchedAt=${data.fetchedAt ?? 'unknown'}`);
            if (debug) reviews.push(...PARODY_REVIEWS);
            if (!reviews.length) return;
            spawnReviewScrolls(reviews, anchorEl);
        })
        .catch((err) => {
            console.warn('[grScrolls] fetch failed:', err);
            if (debug) spawnReviewScrolls([...PARODY_REVIEWS], anchorEl);
        });
}

function spawnReviewScrolls(reviews: Review[], anchorEl: HTMLElement): void {
    const anchorEndEl = document.getElementById('goodreads-scrolls-anchor-end');
    const allocator = new ReviewAllocator(reviews);
    const critterCount = Math.min(reviews.length, MAX_ONSCREEN);
    const critters = Array.from({ length: critterCount }, () => reviewToCritter(allocator));
    spawnCritterLayer(critters, {
        anchorEl,
        anchorEndEl,
        buildModal,
        cardWidthRem: SCROLL_WIDTH_REM,
        cardHeightPx: SCROLL_HEIGHT_PX,
        maxOnscreen: MAX_ONSCREEN,
        debugNamespace: '__grScrolls',
    });
}
