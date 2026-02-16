import { PartMessage, SimulatorModel } from '../ifsModel.js';
import { createGroup, createRect, createText, TextLine } from '../../utils/svgHelpers.js';
import { MESSAGE_BUBBLE_CONFIG, computeBubbleSize, computeBubblePlacement, wrapText } from './bubblePlacement.js';

const config = MESSAGE_BUBBLE_CONFIG;

interface CloudPosition { x: number; y: number }

interface MessageAnimatedState {
    message: PartMessage;
    senderCloudId: string;
    targetCloudId: string;
    element: SVGGElement;
    phase: 'waiting' | 'loitering' | 'traveling' | 'lingering' | 'fading';
    lingerTime: number;
    lingerDuration: number;
    cosmeticProgress: number;
}

export class MessageRenderer {
    private messageStates: Map<number, MessageAnimatedState> = new Map();
    private container: SVGGElement;
    private getCloudPosition: (cloudId: string) => CloudPosition | null;
    private isCloudReady: (cloudId: string) => boolean;
    private getDimensions: () => { width: number; height: number };

    constructor(
        container: SVGGElement,
        getCloudPosition: (cloudId: string) => CloudPosition | null,
        isCloudReady: (cloudId: string) => boolean,
        getDimensions: () => { width: number; height: number }
    ) {
        this.container = container;
        this.getCloudPosition = getCloudPosition;
        this.isCloudReady = isCloudReady;
        this.getDimensions = getDimensions;
    }

    setOnMessageReceived(_callback: (message: PartMessage) => void): void {
        // No longer used - message delivery is handled by the model
    }

    startMessage(
        message: PartMessage,
        senderCloudId: string,
        targetCloudId: string
    ): void {
        const element = this.createMessageElement(message);
        element.style.display = 'none';
        this.container.appendChild(element);

        const state: MessageAnimatedState = {
            message,
            senderCloudId,
            targetCloudId,
            element,
            phase: 'waiting',
            lingerTime: 0,
            lingerDuration: 1.0 + Math.random() * 1.0,
            cosmeticProgress: 0,
        };
        this.messageStates.set(message.id, state);
    }

    animate(deltaTime: number): void {
        const toRemove: number[] = [];
        const dims = this.getDimensions();

        for (const [id, state] of this.messageStates) {
            if (state.phase === 'waiting') {
                const senderPos = this.getCloudPosition(state.senderCloudId);
                const senderReady = this.isCloudReady(state.senderCloudId);
                if (senderPos && senderReady) {
                    state.phase = 'loitering';
                    state.element.style.display = '';
                    const { x, y } = this.clampToCanvas(senderPos.x, senderPos.y, state.message.text, dims);
                    state.element.setAttribute('transform', `translate(${x}, ${y})`);
                }
                continue;
            }

            if (state.phase === 'loitering') {
                const senderPos = this.getCloudPosition(state.senderCloudId);
                const targetPos = this.getCloudPosition(state.targetCloudId);
                const targetReady = this.isCloudReady(state.targetCloudId);
                if (senderPos) {
                    const { x, y } = this.clampToCanvas(senderPos.x, senderPos.y, state.message.text, dims);
                    state.element.setAttribute('transform', `translate(${x}, ${y})`);
                }
                if (targetReady && targetPos) {
                    state.phase = 'traveling';
                }
                continue;
            }

            if (state.phase === 'traveling') {
                const travelRate = 1 / SimulatorModel.MESSAGE_TRAVEL_TIME;
                state.cosmeticProgress = Math.min(1, state.cosmeticProgress + deltaTime * travelRate);

                if (state.cosmeticProgress >= 1) {
                    state.cosmeticProgress = 1;
                    state.phase = 'lingering';
                }

                const { x, y } = this.getMessagePosition(state, state.cosmeticProgress, dims);
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

    private getMessagePosition(state: MessageAnimatedState, progress: number, dims: { width: number; height: number }): { x: number; y: number } {
        const senderPos = this.getCloudPosition(state.senderCloudId);
        const targetPos = this.getCloudPosition(state.targetCloudId);
        if (!senderPos || !targetPos) {
            console.warn(`[Message ${state.message.id}] getMessagePosition: missing position - sender=${JSON.stringify(senderPos)}, target=${JSON.stringify(targetPos)}`);
            return { x: 0, y: 0 };
        }

        if (state.senderCloudId === state.targetCloudId) {
            const angle = progress * 2 * Math.PI;
            const radius = 40;
            return this.clampToCanvas(
                senderPos.x + radius * Math.cos(angle),
                senderPos.y + radius * Math.sin(angle),
                state.message.text,
                dims
            );
        }
        const eased = this.easeInOutCubic(progress);
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

        const rect = createRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, {
            rx: 6,
            fill: '#ffffff',
            stroke: '#333333',
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
