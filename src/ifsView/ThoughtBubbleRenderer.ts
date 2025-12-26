import { ThoughtBubble } from '../ifsModel.js';
import { createGroup, createRect, createCircle, createText, setClickHandler, TextLine } from '../svgHelpers.js';

interface CloudPosition { x: number; y: number }

interface BubbleLayout {
    bubbleX: number;
    bubbleY: number;
    bubbleWidth: number;
    bubbleHeight: number;
    tailDirX: number;
    tailDirY: number;
    textHeight: number;
    lines: string[];
}

const PADDING = 12;
const FONT_SIZE = 16;
const MAX_WIDTH = 200;
const LINE_HEIGHT = FONT_SIZE + 4;
const TAIL_LENGTH = 50;
const MARGIN = 10;

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
        if (!pos) return null;

        const dims = this.getDimensions();
        const centerX = dims.width / 2;
        const centerY = dims.height / 2;

        const lines = this.wrapText(text, MAX_WIDTH, FONT_SIZE);
        const textHeight = lines.length * LINE_HEIGHT;
        const textWidth = Math.min(MAX_WIDTH, Math.max(...lines.map(l => l.length * FONT_SIZE * 0.55)));
        const bubbleWidth = textWidth + PADDING;
        const bubbleHeight = textHeight + PADDING * 2;

        const dx = pos.x - centerX;
        const dy = pos.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const dirX = dist > 0 ? dx / dist : 0;
        const dirY = dist > 0 ? dy / dist : -1;

        let bubbleX = pos.x + dirX * (TAIL_LENGTH + bubbleWidth / 2);
        let bubbleY = pos.y + dirY * (TAIL_LENGTH + bubbleHeight / 2);

        bubbleX = Math.max(MARGIN + bubbleWidth / 2, Math.min(dims.width - MARGIN - bubbleWidth / 2, bubbleX));
        bubbleY = Math.max(MARGIN + bubbleHeight / 2, Math.min(dims.height - MARGIN - bubbleHeight / 2, bubbleY));

        const tailDx = bubbleX - pos.x;
        const tailDy = bubbleY - pos.y;
        const tailDist = Math.sqrt(tailDx * tailDx + tailDy * tailDy);
        const tailDirX = tailDist > 0 ? tailDx / tailDist : 0;
        const tailDirY = tailDist > 0 ? tailDy / tailDist : -1;

        return { bubbleX, bubbleY, bubbleWidth, bubbleHeight, tailDirX, tailDirY, textHeight, lines };
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

        const tailStyle = { fill: 'white', stroke: '#333', 'stroke-width': 1.5, 'pointer-events': 'auto' };
        const circle1Dist = Math.max(bubbleWidth, bubbleHeight) / 2 + 8;
        const circle2Dist = Math.max(bubbleWidth, bubbleHeight) / 2 + 18;
        const smallCircle1 = createCircle(bubbleX - tailDirX * circle1Dist, bubbleY - tailDirY * circle1Dist, 6, tailStyle);
        setClickHandler(smallCircle1, dismiss);
        this.currentGroup.appendChild(smallCircle1);

        const smallCircle2 = createCircle(bubbleX - tailDirX * circle2Dist, bubbleY - tailDirY * circle2Dist, 4, tailStyle);
        setClickHandler(smallCircle2, dismiss);
        this.currentGroup.appendChild(smallCircle2);

        const textStartY = bubbleY - textHeight / 2 + FONT_SIZE;
        const textLines: TextLine[] = lines.map(line => ({
            text: line,
            fontSize: FONT_SIZE,
            fontStyle: 'italic' as const,
        }));
        const text = createText(bubbleX, textStartY, textLines, {
            'font-family': 'sans-serif',
            'text-anchor': 'middle',
            fill: '#333',
        });
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
            const textStartY = bubbleY - textHeight / 2 + FONT_SIZE;
            text.setAttribute('x', String(bubbleX));
            text.setAttribute('y', String(textStartY));
            const tspans = text.querySelectorAll('tspan');
            tspans.forEach((tspan, i) => {
                tspan.setAttribute('x', String(bubbleX));
                tspan.setAttribute('y', String(textStartY + i * LINE_HEIGHT));
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

    private wrapText(text: string, maxWidth: number, fontSize: number): string[] {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (testLine.length * fontSize * 0.5 > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
        return lines;
    }
}
