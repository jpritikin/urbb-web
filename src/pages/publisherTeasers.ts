import { Critter, spawnCritterLayer } from './driftingCritters.js';

interface Teaser {
    emoji: string;
    image: string;
    imageSm: string;
    alt: string;
    quote: string;
}

// Each teaser keeps a fixed emoji so the bug↔image pairing never shuffles between loads.
const TEASERS: Teaser[] = [
    {
        emoji: '🦋',
        image: '/images/book/publisher-beach-overhead.webp',
        imageSm: '/images/book/publisher-beach-overhead-sm.webp',
        alt: 'Ceremony at the beach, camera overhead looking down',
        quote: "Most of us treat our beliefs—and disbeliefs—like possessions: things to collect, defend, and occasionally polish. <em>Religion Unburdened by Belief</em> asks what happens when you put them aside.",
    },
    {
        emoji: '🐝',
        image: '/images/book/publisher-dancers-feet.webp',
        imageSm: '/images/book/publisher-dancers-feet-sm.webp',
        alt: "Dancers' feet in shallow water",
        quote: "By combining the late neuroscientist Francisco Varela's framework for studying consciousness with psychologist Richard Schwartz's Internal Family Systems therapy, Pritikin identifies a specific skill at the heart of self-development—one you can practice, measure, and build.",
    },
    {
        emoji: '🐞',
        image: '/images/book/publisher-ceremony-water.webp',
        imageSm: '/images/book/publisher-ceremony-water-sm.webp',
        alt: 'Ceremony swamped by water',
        quote: "Many traditions promise transformation but can't tell you if it's working. This one can. Not just \"I feel more at peace,\" but observable, measurable progress.",
    },
    {
        emoji: '🪰',
        image: '/images/book/publisher-ceremony-aerial.webp',
        imageSm: '/images/book/publisher-ceremony-aerial-sm.webp',
        alt: 'Ceremony seen from far above',
        quote: "Rigorously grounded, unexpectedly playful, and culminating in an informal exam where scoring below 58% earns you instructions to draw a storm cloud over your self-portrait.",
    },
];

const TEASER_WIDTH_REM = 3;
const TEASER_HEIGHT_PX = 60;
const MOBILE_BREAKPOINT = 640;

function buildModal(): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'gr-review-modal publisher-teaser-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
    <div class="gr-review-modal-inner">
      <button class="gr-review-modal-close" aria-label="Close">✕</button>
      <div class="publisher-teaser-frame">
        <img class="publisher-teaser-image" alt="">
        <span class="publisher-teaser-count"></span>
        <p class="publisher-teaser-quote"></p>
      </div>
    </div>`;
    return modal;
}

function teaserToCritter(teaser: Teaser, index: number, total: number): Critter {
    return {
        emoji: teaser.emoji,
        buildCard(emoji: string): HTMLElement {
            const el = document.createElement('div');
            el.className = 'publisher-teaser-critter';
            el.setAttribute('aria-label', 'Preview a glimpse from the book');
            el.innerHTML = `<div class="gr-scroll-seal">${emoji}</div>`;
            return el;
        },
        openModal(modal: HTMLElement): void {
            const img = modal.querySelector('.publisher-teaser-image') as HTMLImageElement;
            const useSmall = window.innerWidth < MOBILE_BREAKPOINT;
            img.src = useSmall ? teaser.imageSm : teaser.image;
            img.alt = teaser.alt;
            (modal.querySelector('.publisher-teaser-count') as HTMLElement).textContent = `${index + 1} / ${total}`;
            (modal.querySelector('.publisher-teaser-quote') as HTMLElement).innerHTML = teaser.quote;
            (modal.querySelector('.gr-review-modal-close') as HTMLElement).focus();
        },
    };
}

export function initPublisherTeasers(anchorEl: HTMLElement): void {
    const anchorEndEl = document.getElementById('publisher-teasers-anchor-end');
    spawnCritterLayer(TEASERS.map((t, i) => teaserToCritter(t, i, TEASERS.length)), {
        anchorEl,
        anchorEndEl,
        buildModal,
        cardWidthRem: TEASER_WIDTH_REM,
        cardHeightPx: TEASER_HEIGHT_PX,
        maxOnscreen: TEASERS.length,
        debugNamespace: '__publisherTeasers',
    });
}
