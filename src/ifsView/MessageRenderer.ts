import { PartMessage } from '../ifsModel.js';
import { createGroup, createRect, createText, TextLine } from '../svgHelpers.js';

interface MessageAnimatedState {
    message: PartMessage;
    progress: number;
    duration: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    element: SVGGElement;
    phase: 'traveling' | 'lingering' | 'fading';
    lingerTime: number;
    lingerDuration: number;
}

export class MessageRenderer {
    private messageStates: Map<number, MessageAnimatedState> = new Map();
    private container: SVGGElement;
    private onMessageReceived: ((message: PartMessage) => void) | null = null;

    constructor(container: SVGGElement) {
        this.container = container;
    }

    setOnMessageReceived(callback: (message: PartMessage) => void): void {
        this.onMessageReceived = callback;
    }

    startMessage(
        message: PartMessage,
        startX: number,
        startY: number,
        endX: number,
        endY: number
    ): void {
        const element = this.createMessageElement(message);
        element.setAttribute('transform', `translate(${startX}, ${startY})`);
        this.container.appendChild(element);

        const state: MessageAnimatedState = {
            message,
            progress: 0,
            duration: 3.0,
            startX,
            startY,
            endX,
            endY,
            element,
            phase: 'traveling',
            lingerTime: 0,
            lingerDuration: 1.0 + Math.random() * 1.0,
        };
        this.messageStates.set(message.id, state);
    }

    animate(deltaTime: number): void {
        const toRemove: number[] = [];

        for (const [id, state] of this.messageStates) {
            if (state.phase === 'traveling') {
                state.progress += deltaTime / state.duration;

                if (state.progress >= 1) {
                    state.progress = 1;
                    state.phase = 'lingering';
                    this.onMessageReceived?.(state.message);
                }

                const { x, y } = this.getMessagePosition(state);
                state.element.setAttribute('transform', `translate(${x}, ${y})`);
            } else if (state.phase === 'lingering') {
                state.lingerTime += deltaTime;
                if (state.lingerTime >= state.lingerDuration) {
                    state.phase = 'fading';
                }
            } else if (state.phase === 'fading') {
                state.lingerTime += deltaTime;
                const fadeProgress = (state.lingerTime - state.lingerDuration) / 0.5;
                if (fadeProgress >= 1) {
                    toRemove.push(id);
                } else {
                    state.element.setAttribute('opacity', String(1 - fadeProgress));
                }
            }
        }

        for (const id of toRemove) {
            const state = this.messageStates.get(id);
            state?.element.remove();
            this.messageStates.delete(id);
        }
    }

    private getMessagePosition(state: MessageAnimatedState): { x: number; y: number } {
        if (state.message.senderId === state.message.targetId) {
            const angle = state.progress * 2 * Math.PI;
            const radius = 40;
            return {
                x: state.startX + radius * Math.cos(angle),
                y: state.startY + radius * Math.sin(angle),
            };
        }
        const eased = this.easeInOutCubic(state.progress);
        return {
            x: state.startX + (state.endX - state.startX) * eased,
            y: state.startY + (state.endY - state.startY) * eased,
        };
    }

    private easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    private createMessageElement(message: PartMessage): SVGGElement {
        const group = createGroup({ class: 'message-bubble' });

        const padding = 8;
        const fontSize = 11;
        const maxWidth = 120;

        const lines = this.wrapText(message.text, maxWidth, fontSize);
        const lineHeight = fontSize + 2;
        const textHeight = lines.length * lineHeight;
        const textWidth = Math.min(maxWidth, Math.max(...lines.map(l => l.length * fontSize * 0.5)));
        const bubbleWidth = textWidth + padding * 2;
        const bubbleHeight = textHeight + padding * 2;

        const isGrievance = message.type === 'grievance';
        const rect = createRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, {
            rx: 6,
            fill: isGrievance ? '#ffcccc' : '#ffffff',
            stroke: isGrievance ? '#cc0000' : '#333333',
            'stroke-width': 1.5,
        });
        group.appendChild(rect);

        const startY = -textHeight / 2 + fontSize;
        const textLines: TextLine[] = lines.map(line => ({ text: line }));
        const textEl = createText(0, startY, textLines, {
            'font-size': fontSize,
            'font-family': 'sans-serif',
            'text-anchor': 'middle',
            fill: '#333',
        });
        group.appendChild(textEl);

        return group;
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

    clear(): void {
        for (const state of this.messageStates.values()) {
            state.element.remove();
        }
        this.messageStates.clear();
    }

    getCompletedMessageIds(): number[] {
        const completed: number[] = [];
        for (const [id, state] of this.messageStates) {
            if (state.phase !== 'traveling') {
                completed.push(id);
            }
        }
        return completed;
    }
}
