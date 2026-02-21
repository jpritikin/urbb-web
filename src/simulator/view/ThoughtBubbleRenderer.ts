import { ThoughtBubble } from '../ifsModel.js';
import { createGroup, createRect, createCircle, createText, setClickHandler, TextLine } from '../../utils/svgHelpers.js';
import { BubbleLayout, THOUGHT_BUBBLE_CONFIG, computeBubbleLayout } from './bubblePlacement.js';

interface CloudPosition { x: number; y: number; opacity?: number }

interface HeartOrbit {
    direction: 1 | -1;
    startAngle: number;
}

interface BubbleEntry {
    group: SVGGElement;
    text: string;
    cloudId: string;
    validated: boolean;
    heartOrbits: HeartOrbit[];
    heartCreatedAt: number;
    siblingIndex: number;
    siblingCount: number;
}

const config = THOUGHT_BUBBLE_CONFIG;
const ORBIT_RX = 6;
const ORBIT_RY = 4;
const ORBIT_PERIOD_MS = 3000;

export class ThoughtBubbleRenderer {
    private container: SVGGElement;
    private entries: Map<number, BubbleEntry> = new Map();
    private getCloudPosition: (cloudId: string) => CloudPosition | null;
    private getDimensions: () => { width: number; height: number };
    private onDismiss: ((id: number) => void) | null = null;

    constructor(
        container: SVGGElement,
        getCloudPosition: (cloudId: string) => CloudPosition | null,
        getDimensions: () => { width: number; height: number }
    ) {
        this.container = container;
        this.getCloudPosition = getCloudPosition;
        this.getDimensions = getDimensions;
    }

    setOnDismiss(callback: (id: number) => void): void {
        this.onDismiss = callback;
    }

    sync(bubbles: ThoughtBubble[], now: number): void {
        const activeIds = new Set<number>();

        // Group active bubbles by cloudId to compute sibling indices
        const cloudBubbleOrder = new Map<string, number[]>();

        for (const bubble of bubbles) {
            if (bubble.expiresAt <= now) continue;
            activeIds.add(bubble.id);
            const ids = cloudBubbleOrder.get(bubble.cloudId) ?? [];
            ids.push(bubble.id);
            cloudBubbleOrder.set(bubble.cloudId, ids);
        }

        for (const bubble of bubbles) {
            if (!activeIds.has(bubble.id)) continue;

            const siblings = cloudBubbleOrder.get(bubble.cloudId)!;
            const siblingIndex = siblings.indexOf(bubble.id);

            const existing = this.entries.get(bubble.id);
            if (existing) {
                const same = existing.text === bubble.text &&
                    existing.cloudId === bubble.cloudId &&
                    existing.validated === (bubble.validated ?? false) &&
                    existing.siblingIndex === siblingIndex &&
                    existing.siblingCount === siblings.length;
                if (same) {
                    this.updateFade(existing.group, bubble, now);
                    this.updatePosition(existing, bubble.cloudId);
                    continue;
                }
                this.removeEntry(bubble.id);
            }
            this.createEntry(bubble, now, siblingIndex, siblings.length);
        }

        // Remove entries no longer in the active set
        for (const id of this.entries.keys()) {
            if (!activeIds.has(id)) {
                this.removeEntry(id);
            }
        }

        // Ensure newer bubbles (higher id) render on top
        const sorted = [...this.entries.entries()].sort((a, b) => a[0] - b[0]);
        for (const [, entry] of sorted) {
            this.container.appendChild(entry.group);
        }
    }

    private computeLayout(cloudId: string, text: string, siblingIndex: number = 0, siblingCount: number = 1): BubbleLayout | null {
        const pos = this.getCloudPosition(cloudId);
        if (!pos || (pos.opacity !== undefined && pos.opacity < 0.1)) return null;
        const dims = this.getDimensions();
        return computeBubbleLayout(pos.x, pos.y, text, dims.width, dims.height, config, siblingIndex, siblingCount);
    }

    private createEntry(bubble: ThoughtBubble, now: number, siblingIndex: number = 0, siblingCount: number = 1): void {
        const layout = this.computeLayout(bubble.cloudId, bubble.text, siblingIndex, siblingCount);
        if (!layout) return;

        const { bubbleX, bubbleY, bubbleWidth, bubbleHeight, tailDirX, tailDirY, textHeight, lines } = layout;

        const group = createGroup({ class: 'thought-bubble', 'pointer-events': 'auto', cursor: 'pointer' });
        const bubbleId = bubble.id;

        const dismiss = () => {
            this.removeEntry(bubbleId, true);
        };

        setClickHandler(group, dismiss);

        const bubbleStyle = { rx: 8, fill: 'white', stroke: '#333', 'stroke-width': 1.5, opacity: 0.95 };
        const rect = createRect(bubbleX - bubbleWidth / 2, bubbleY - bubbleHeight / 2, bubbleWidth, bubbleHeight, bubbleStyle);
        group.appendChild(rect);

        const tailStyle = { fill: 'white', stroke: '#333', 'stroke-width': 1.5, 'pointer-events': 'none' };
        const circle1Dist = Math.max(bubbleWidth, bubbleHeight) / 2 + 8;
        const circle2Dist = Math.max(bubbleWidth, bubbleHeight) / 2 + 18;
        const smallCircle1 = createCircle(bubbleX - tailDirX * circle1Dist, bubbleY - tailDirY * circle1Dist, 6, tailStyle);
        group.appendChild(smallCircle1);

        const smallCircle2 = createCircle(bubbleX - tailDirX * circle2Dist, bubbleY - tailDirY * circle2Dist, 4, tailStyle);
        group.appendChild(smallCircle2);

        const textStartY = bubbleY - textHeight / 2 + config.fontSize;
        const textLines: TextLine[] = lines.map(line => ({
            text: line,
            fontSize: config.fontSize,
            fontStyle: 'italic' as const,
        }));
        const text = createText(bubbleX, textStartY, textLines, {
            'font-family': 'sans-serif',
            'text-anchor': 'middle',
            fill: '#333',
        }, config.lineHeight);
        text.style.userSelect = 'none';
        group.appendChild(text);

        const entry: BubbleEntry = {
            group,
            text: bubble.text,
            cloudId: bubble.cloudId,
            validated: bubble.validated ?? false,
            heartOrbits: [],
            heartCreatedAt: 0,
            siblingIndex,
            siblingCount,
        };

        if (bubble.validated) {
            this.appendHearts(entry, bubbleX, bubbleY, bubbleWidth, bubbleHeight, now);
        }

        this.container.appendChild(group);
        this.entries.set(bubble.id, entry);

        this.updateFade(group, bubble, now);
    }

    private removeEntry(id: number, notifyDismiss = false): void {
        const entry = this.entries.get(id);
        if (!entry) return;
        entry.group.parentNode?.removeChild(entry.group);
        this.entries.delete(id);
        if (notifyDismiss) this.onDismiss?.(id);
    }

    private updateFade(group: SVGGElement, bubble: ThoughtBubble, now: number): void {
        const fadeStart = 2;
        const timeRemaining = bubble.expiresAt - now;

        if (timeRemaining <= fadeStart) {
            const fadeProgress = 1 - (timeRemaining / fadeStart);
            const opacity = 0.95 * (1 - fadeProgress);
            group.setAttribute('opacity', String(Math.max(0, opacity)));
        } else {
            group.setAttribute('opacity', '0.95');
        }
    }

    private heartAnchors(bubbleX: number, bubbleY: number, bubbleWidth: number, bubbleHeight: number): [number, number][] {
        const inset = bubbleWidth * 0.25;
        const left = bubbleX - bubbleWidth / 2 + inset;
        const right = bubbleX + bubbleWidth / 2 - inset;
        const topY = bubbleY - bubbleHeight / 2 + config.fontSize * 0.8;
        const bottomY = bubbleY + bubbleHeight / 2 - config.fontSize * 0.3;
        return [[left, topY], [right, topY], [left, bottomY], [right, bottomY]];
    }

    private appendHearts(entry: BubbleEntry, bubbleX: number, bubbleY: number, bubbleWidth: number, bubbleHeight: number, now: number): void {
        entry.heartCreatedAt = now;
        entry.heartOrbits = [];
        const anchors = this.heartAnchors(bubbleX, bubbleY, bubbleWidth, bubbleHeight);
        for (const [hx, hy] of anchors) {
            const dir = Math.random() < 0.5 ? 1 : -1;
            const startAngle = Math.random() * Math.PI * 2;
            entry.heartOrbits.push({ direction: dir as 1 | -1, startAngle });
            const heart = createText(hx, hy, [{ text: '❤️', fontSize: config.fontSize }], {
                'text-anchor': 'middle',
                'font-size': config.fontSize,
                'pointer-events': 'none',
                class: 'validate-heart',
            }, 0);
            entry.group.appendChild(heart);
        }
    }

    private updatePosition(entry: BubbleEntry, cloudId: string): void {
        const layout = this.computeLayout(cloudId, entry.text, entry.siblingIndex, entry.siblingCount);
        if (!layout) {
            this.removeEntry(this.findEntryId(entry)!);
            return;
        }

        const { bubbleX, bubbleY, bubbleWidth, bubbleHeight, tailDirX, tailDirY, textHeight } = layout;

        const rect = entry.group.querySelector('rect');
        if (rect) {
            rect.setAttribute('x', String(bubbleX - bubbleWidth / 2));
            rect.setAttribute('y', String(bubbleY - bubbleHeight / 2));
        }

        const circles = entry.group.querySelectorAll('circle');
        const circle1Dist = Math.max(bubbleWidth, bubbleHeight) / 2 + 8;
        const circle2Dist = Math.max(bubbleWidth, bubbleHeight) / 2 + 18;
        if (circles[0]) {
            circles[0].setAttribute('cx', String(bubbleX - tailDirX * circle1Dist));
            circles[0].setAttribute('cy', String(bubbleY - tailDirY * circle1Dist));
        }
        if (circles[1]) {
            circles[1].setAttribute('cx', String(bubbleX - tailDirX * circle2Dist));
            circles[1].setAttribute('cy', String(bubbleY - tailDirY * circle2Dist));
        }

        const text = entry.group.querySelector('text:not(.validate-heart)');
        if (text) {
            const textStartY = bubbleY - textHeight / 2 + config.fontSize;
            text.setAttribute('x', String(bubbleX));
            text.setAttribute('y', String(textStartY));
            const tspans = text.querySelectorAll('tspan');
            tspans.forEach((tspan, i) => {
                tspan.setAttribute('x', String(bubbleX));
                tspan.setAttribute('y', String(textStartY + i * config.lineHeight));
            });
        }

        const hearts = entry.group.querySelectorAll('.validate-heart');
        if (hearts.length > 0) {
            const anchors = this.heartAnchors(bubbleX, bubbleY, bubbleWidth, bubbleHeight);
            const elapsed = Date.now() - entry.heartCreatedAt;
            hearts.forEach((heart, i) => {
                if (!anchors[i] || !entry.heartOrbits[i]) return;
                const orbit = entry.heartOrbits[i];
                const angle = orbit.startAngle + orbit.direction * (elapsed / ORBIT_PERIOD_MS) * Math.PI * 2;
                const ox = anchors[i][0] + Math.cos(angle) * ORBIT_RX;
                const oy = anchors[i][1] + Math.sin(angle) * ORBIT_RY;
                heart.setAttribute('x', String(ox));
                heart.setAttribute('y', String(oy));
                const tspan = heart.querySelector('tspan');
                if (tspan) {
                    tspan.setAttribute('x', String(ox));
                    tspan.setAttribute('y', String(oy));
                }
            });
        }
    }

    private findEntryId(entry: BubbleEntry): number | undefined {
        for (const [id, e] of this.entries) {
            if (e === entry) return id;
        }
        return undefined;
    }

    hide(): void {
        for (const entry of this.entries.values()) {
            entry.group.parentNode?.removeChild(entry.group);
        }
        this.entries.clear();
    }
}
