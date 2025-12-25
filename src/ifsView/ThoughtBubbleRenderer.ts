import { ThoughtBubble } from '../ifsModel.js';
import { createGroup, createRect, createCircle, createText, setClickHandler, TextLine } from '../svgHelpers.js';

export interface CloudPosition {
    x: number;
    y: number;
}

export class ThoughtBubbleRenderer {
    private container: SVGGElement;
    private currentGroup: SVGGElement | null = null;
    private renderedBubble: { text: string; cloudId: string } | null = null;
    private getCloudPosition: (cloudId: string) => CloudPosition | null;
    private onDismiss: (() => void) | null = null;

    constructor(
        container: SVGGElement,
        getCloudPosition: (cloudId: string) => CloudPosition | null
    ) {
        this.container = container;
        this.getCloudPosition = getCloudPosition;
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

    private show(bubble: ThoughtBubble, now: number): void {
        const pos = this.getCloudPosition(bubble.cloudId);
        if (!pos) return;

        this.currentGroup = createGroup({ class: 'thought-bubble', 'pointer-events': 'none' });

        const padding = 12;
        const fontSize = 16;
        const maxWidth = 200;
        const lines = this.wrapText(bubble.text, maxWidth, fontSize);
        const lineHeight = fontSize + 4;
        const textHeight = lines.length * lineHeight;
        const textWidth = Math.min(maxWidth, Math.max(...lines.map(l => l.length * fontSize * 0.55)));
        const bubbleWidth = textWidth + padding;
        const bubbleHeight = textHeight + padding * 2;

        const bubbleX = pos.x;
        const bubbleY = pos.y - 60 - bubbleHeight / 2;

        const dismiss = () => {
            this.hide();
            this.onDismiss?.();
        };

        const bubbleStyle = { rx: 8, fill: 'white', stroke: '#333', 'stroke-width': 1.5, opacity: 0.95, 'pointer-events': 'auto' };
        const rect = createRect(bubbleX - bubbleWidth / 2, bubbleY - bubbleHeight / 2, bubbleWidth, bubbleHeight, bubbleStyle);
        setClickHandler(rect, dismiss);
        this.currentGroup.appendChild(rect);

        const tailStyle = { fill: 'white', stroke: '#333', 'stroke-width': 1.5, 'pointer-events': 'auto' };
        const smallCircle1 = createCircle(bubbleX, bubbleY + bubbleHeight / 2 + 8, 6, tailStyle);
        setClickHandler(smallCircle1, dismiss);
        this.currentGroup.appendChild(smallCircle1);

        const smallCircle2 = createCircle(bubbleX, bubbleY + bubbleHeight / 2 + 18, 4, tailStyle);
        setClickHandler(smallCircle2, dismiss);
        this.currentGroup.appendChild(smallCircle2);

        const textStartY = bubbleY - textHeight / 2 + fontSize;
        const textLines: TextLine[] = lines.map(line => ({
            text: line,
            fontSize,
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
        if (!this.currentGroup) return;

        const pos = this.getCloudPosition(cloudId);
        if (!pos) {
            this.hide();
            return;
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
