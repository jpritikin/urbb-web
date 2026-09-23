document.addEventListener('DOMContentLoaded', () => {
  const lines = document.querySelectorAll('.say');
  if (lines.length === 0) return;

  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          visibilityObserver.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.2, rootMargin: '0px 0px -10% 0px' }
  );

  lines.forEach((line) => visibilityObserver.observe(line));

  const dialogue = document.querySelector('.dialogue') as HTMLElement | null;
  if (dialogue) {
    const relayout = initStaggeredDialogue(dialogue);
    initCardDeal(dialogue, relayout);
  }
});

// On wide screens the dialogue splits into two columns (left = one speaker,
// right = the other). Independent column flow can't guarantee each turn's
// top edge sits below the previous turn's, since a short bubble on one side
// can land level with a taller bubble on the other. This lays the bubbles
// out with absolute positioning instead, walking turns in conversation
// order and forcing each one's top to be at least the previous turn's
// bottom, so vertical position always increases left-to-right-to-left.
//
// Returns a relayout function so other effects (the card deal below) can
// recompute positions after they change a bubble's width/height.
function initStaggeredDialogue(dialogue: HTMLElement): () => void {
  const mediaQuery = window.matchMedia('(min-width: 900px)');

  function layout() {
    if (!mediaQuery.matches) {
      dialogue.classList.remove('is-staggered');
      dialogue.style.height = '';
      return;
    }

    dialogue.classList.add('is-staggered');
    const turns = Array.from(dialogue.querySelectorAll('.say')) as HTMLElement[];
    let nextTop = 0;

    for (const turn of turns) {
      turn.style.top = `${nextTop}px`;
      nextTop = nextTop + settledHeight(turn) + 16;
    }

    dialogue.style.height = `${nextTop}px`;
  }

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleLayout = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 100);
  };

  window.addEventListener('resize', scheduleLayout);
  mediaQuery.addEventListener('change', layout);

  // Defer initial layout until fonts/content are ready for accurate heights.
  setTimeout(layout, 50);

  return layout;
}

// A dealt bubble's width is mid-transition for up to 600ms (full width
// shrinking to half), during which its text is still rewrapping and
// offsetHeight reports a moving target - reading it while scrolling fast
// (several bubbles dealing back to back) races the relayout below and
// produces overlaps. Instead, always measure the bubble's settled height by
// cloning it off-screen at its final CSS state (no transition, so the
// clone's layout is instantaneous and exact) rather than trusting whatever
// the live, still-animating element currently measures.
function settledHeight(turn: HTMLElement): number {
  const clone = turn.cloneNode(true) as HTMLElement;
  clone.style.transition = 'none';
  clone.style.visibility = 'hidden';
  clone.style.top = '0';
  turn.parentElement!.appendChild(clone);
  const height = clone.offsetHeight;
  clone.remove();
  return height;
}

// On wide screens each bubble starts full width, stacked in a single
// column, then "deals" sideways into a half-width column once it crosses
// the vertical middle of the viewport while scrolling - like a deck of
// cards being shuffled out into two hands. rootMargin of -50% top and
// bottom collapses the observer's viewport to a single line at the middle,
// so intersecting means "currently crossing the midline."
//
// Shrinking a bubble to half width also shrinks its height (text rewraps
// into more lines), so every relayout below it needs to shift up or down
// to close/open the gap. The CSS transition on `top` (with the same bouncy
// easing as left/right/width) is what makes that shift read as bubbles
// bouncing into their new resting place rather than jumping.
function initCardDeal(dialogue: HTMLElement, relayout: () => void) {
  const mediaQuery = window.matchMedia('(min-width: 900px)');
  if (!mediaQuery.matches) return;

  const dealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-dealt');
          dealObserver.unobserve(entry.target);
        }
      }
      relayout();
    },
    { rootMargin: '-50% 0px -50% 0px' }
  );

  dialogue.querySelectorAll('.say').forEach((line) => dealObserver.observe(line));
}
