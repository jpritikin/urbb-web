import { PartMessage } from '../ifsModel.js';
import { createGroup, createRect, createText, TextLine } from '../svgHelpers.js';
import { MESSAGE_BUBBLE_CONFIG, computeBubbleSize, computeBubblePlacement, wrapText } from './bubblePlacement.js';

const config = MESSAGE_BUBBLE_CONFIG;

interface CloudPosition { x: number; y: number }

interface MessageAnimatedState {
    message: PartMessage;
    progress: number;
    duration: number;
    senderCloudId: string;
    targetCloudId: string;
    element: SVGGElement;
    phase: 'traveling' | 'lingering' | 'fading';
    lingerTime: number;
    lingerDuration: number;
}

export class MessageRenderer {
    private messageStates: Map<number, MessageAnimatedState> = new Map();
    private container: SVGGElement;
    private onMessageReceived: ((message: PartMessage) => void) | null = null;
    private getCloudPosition: (cloudId: string) => CloudPosition | null;
    private getDimensions: () => { width: number; height: number };

    constructor(
        container: SVGGElement,
        getCloudPosition: (cloudId: string) => CloudPosition | null,
        getDimensions: () => { width: number; height: number }
    ) {
        this.container = container;
        this.getCloudPosition = getCloudPosition;
        this.getDimensions = getDimensions;
    }

    setOnMessageReceived(callback: (message: PartMessage) => void): void {
        this.onMessageReceived = callback;
    }

    startMessage(
        message: PartMessage,
        senderCloudId: string,
        targetCloudId: string
    ): void {
        const senderPos = this.getCloudPosition(senderCloudId);
        if (!senderPos) return;

        const element = this.createMessageElement(message);
        element.setAttribute('transform', `translate(${senderPos.x}, ${senderPos.y})`);
        this.container.appendChild(element);

        const state: MessageAnimatedState = {
            message,
            progress: 0,
            duration: 3.0,
            senderCloudId,
            targetCloudId,
            element,
            phase: 'traveling',
            lingerTime: 0,
            lingerDuration: 1.0 + Math.random() * 1.0,
        };
        this.messageStates.set(message.id, state);
    }

    animate(deltaTime: number): void {
        const toRemove: number[] = [];
        const dims = this.getDimensions();

        for (const [id, state] of this.messageStates) {
            if (state.phase === 'traveling') {
                state.progress += deltaTime / state.duration;

                if (state.progress >= 1) {
                    state.progress = 1;
                    state.phase = 'lingering';
                    this.onMessageReceived?.(state.message);
                }

                const { x, y } = this.getMessagePosition(state, dims);
                state.element.setAttribute('transform', `translate(${x}, ${y})`);
            } else if (state.phase === 'lingering') {
                state.lingerTime += deltaTime;
                const { x, y } = this.getLingeringPosition(state, dims);
                state.element.setAttribute('transform', `translate(${x}, ${y})`);
                if (state.lingerTime >= state.lingerDuration) {
                    state.phase = 'fading';
                }
            } else if (state.phase === 'fading') {
                state.lingerTime += deltaTime;
                const { x, y } = this.getLingeringPosition(state, dims);
                state.element.setAttribute('transform', `translate(${x}, ${y})`);
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

    private getMessagePosition(state: MessageAnimatedState, dims: { width: number; height: number }): { x: number; y: number } {
        const senderPos = this.getCloudPosition(state.senderCloudId);
        const targetPos = this.getCloudPosition(state.targetCloudId);
        if (!senderPos || !targetPos) return { x: 0, y: 0 };

        if (state.senderCloudId === state.targetCloudId) {
            const angle = state.progress * 2 * Math.PI;
            const radius = 40;
            return this.clampToCanvas(
                senderPos.x + radius * Math.cos(angle),
                senderPos.y + radius * Math.sin(angle),
                state.message.text,
                dims
            );
        }
        const eased = this.easeInOutCubic(state.progress);
        return this.clampToCanvas(
            senderPos.x + (targetPos.x - senderPos.x) * eased,
            senderPos.y + (targetPos.y - senderPos.y) * eased,
            state.message.text,
            dims
        );
    }

    private getLingeringPosition(state: MessageAnimatedState, dims: { width: number; height: number }): { x: number; y: number } {
        const targetPos = this.getCloudPosition(state.targetCloudId);
        if (!targetPos) return { x: 0, y: 0 };
        return this.clampToCanvas(targetPos.x, targetPos.y, state.message.text, dims);
    }

    private clampToCanvas(x: number, y: number, text: string, dims: { width: number; height: number }): { x: number; y: number } {
        const size = computeBubbleSize(text, config);
        const halfW = size.width / 2;
        const halfH = size.height / 2;
        return {
            x: Math.max(config.margin + halfW, Math.min(dims.width - config.margin - halfW, x)),
            y: Math.max(config.margin + halfH, Math.min(dims.height - config.margin - halfH, y)),
        };
    }

    private easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    private createMessageElement(message: PartMessage): SVGGElement {
        const group = createGroup({ class: 'message-bubble', 'pointer-events': 'none' });

        const size = computeBubbleSize(message.text, config);
        const { width: bubbleWidth, height: bubbleHeight, textHeight, lines } = size;

        const isGrievance = message.type === 'grievance';
        const rect = createRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, {
            rx: 6,
            fill: isGrievance ? '#ffcccc' : '#ffffff',
            stroke: isGrievance ? '#cc0000' : '#333333',
            'stroke-width': 1.5,
        });
        group.appendChild(rect);

        const startY = -textHeight / 2 + config.fontSize;
        const textLines: TextLine[] = lines.map(line => ({ text: line }));
        const textEl = createText(0, startY, textLines, {
            'font-size': config.fontSize,
            'font-family': 'sans-serif',
            'text-anchor': 'middle',
            fill: '#333',
        }, config.lineHeight);
        group.appendChild(textEl);

        return group;
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
