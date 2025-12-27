import { ThoughtBubble } from '../ifsModel.js';
import { createGroup, createRect, createCircle, createText, setClickHandler, TextLine } from '../svgHelpers.js';
import { BubbleLayout, THOUGHT_BUBBLE_CONFIG, computeBubbleLayout } from './bubblePlacement.js';

interface CloudPosition { x: number; y: number; opacity?: number }

const config = THOUGHT_BUBBLE_CONFIG;

export class ThoughtBubbleRenderer {
    private container: SVGGElement;
    private currentGroup: SVGGElement | null = null;
    private renderedBubble: { text: string; cloudId: string } | null = null;
    private getCloudPosition: (cloudId: string) => CloudPosition | null;
    private getDimensions: () => { width: number; height: number };
    private onDismiss: (() => void) | null = null;

    constructor(
        container: SVGGElement,
        getCloudPosition: (cloudId: string) => CloudPosition | null,
        getDimensions: () => { width: number; height: number }
    ) {
        this.container = container;
        this.getCloudPosition = getCloudPosition;
        this.getDimensions = getDimensions;
    }

    setOnDismiss(callback: () => void): void {
        this.onDismiss = callback;
    }

    sync(bubble: ThoughtBubble | null, now: number = Date.now()): void {
        if (!bubble || bubble.expiresAt <= now) {
            this.hide();
            return;
        }

        const isSameBubble = this.renderedBubble &&
            this.renderedBubble.text === bubble.text &&
            this.renderedBubble.cloudId === bubble.cloudId;

        if (isSameBubble) {
            this.updateFade(bubble, now);
            this.updatePosition(bubble.cloudId);
            return;
        }

        this.hide();
        this.show(bubble, now);
    }

    private computeLayout(cloudId: string, text: string): BubbleLayout | null {
        const pos = this.getCloudPosition(cloudId);
        if (!pos || (pos.opacity !== undefined && pos.opacity < 0.1)) return null;
        const dims = this.getDimensions();
        return computeBubbleLayout(pos.x, pos.y, text, dims.width, dims.height, config);
    }

    private show(bubble: ThoughtBubble, now: number): void {
        const layout = this.computeLayout(bubble.cloudId, bubble.text);
        if (!layout) return;

        const { bubbleX, bubbleY, bubbleWidth, bubbleHeight, tailDirX, tailDirY, textHeight, lines } = layout;

        this.currentGroup = createGroup({ class: 'thought-bubble', 'pointer-events': 'none' });

        const dismiss = () => {
            this.hide();
            this.onDismiss?.();
        };

        const bubbleStyle = { rx: 8, fill: 'white', stroke: '#333', 'stroke-width': 1.5, opacity: 0.95, 'pointer-events': 'auto' };
        const rect = createRect(bubbleX - bubbleWidth / 2, bubbleY - bubbleHeight / 2, bubbleWidth, bubbleHeight, bubbleStyle);
        setClickHandler(rect, dismiss);
        this.currentGroup.appendChild(rect);

        const tailStyle = { fill: 'white', stroke: '#333', 'stroke-width': 1.5, 'pointer-events': 'none' };
        const circle1Dist = Math.max(bubbleWidth, bubbleHeight) / 2 + 8;
        const circle2Dist = Math.max(bubbleWidth, bubbleHeight) / 2 + 18;
        const smallCircle1 = createCircle(bubbleX - tailDirX * circle1Dist, bubbleY - tailDirY * circle1Dist, 6, tailStyle);
        this.currentGroup.appendChild(smallCircle1);

        const smallCircle2 = createCircle(bubbleX - tailDirX * circle2Dist, bubbleY - tailDirY * circle2Dist, 4, tailStyle);
        this.currentGroup.appendChild(smallCircle2);

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
        this.currentGroup.appendChild(text);

        this.container.appendChild(this.currentGroup);
        this.renderedBubble = { text: bubble.text, cloudId: bubble.cloudId };

        this.updateFade(bubble, now);
    }

    private updateFade(bubble: ThoughtBubble, now: number): void {
        if (!this.currentGroup) return;

        const fadeStartMs = 2000;
        const timeRemaining = bubble.expiresAt - now;

        if (timeRemaining <= fadeStartMs) {
            const fadeProgress = 1 - (timeRemaining / fadeStartMs);
            const opacity = 0.95 * (1 - fadeProgress);
            this.currentGroup.setAttribute('opacity', String(Math.max(0, opacity)));
        } else {
            this.currentGroup.setAttribute('opacity', '0.95');
        }
    }

    private updatePosition(cloudId: string): void {
        if (!this.currentGroup || !this.renderedBubble) return;

        const layout = this.computeLayout(cloudId, this.renderedBubble.text);
        if (!layout) {
            this.hide();
            return;
        }

        const { bubbleX, bubbleY, bubbleWidth, bubbleHeight, tailDirX, tailDirY, textHeight } = layout;

        const rect = this.currentGroup.querySelector('rect');
        if (rect) {
            rect.setAttribute('x', String(bubbleX - bubbleWidth / 2));
            rect.setAttribute('y', String(bubbleY - bubbleHeight / 2));
        }

        const circles = this.currentGroup.querySelectorAll('circle');
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

        const text = this.currentGroup.querySelector('text');
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
    }

    hide(): void {
        if (this.currentGroup?.parentNode) {
            this.currentGroup.parentNode.removeChild(this.currentGroup);
        }
        this.currentGroup = null;
        this.renderedBubble = null;
    }
}
