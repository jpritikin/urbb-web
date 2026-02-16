import { REGULATION_STANCE_LIMIT } from '../simulator/messageOrchestrator.js';

export const CARPET_VERTEX_COUNT = 15;
const CARPET_BASE_WIDTH = 40;
export const CARPET_SCALE = 3;
const CARPET_WIDTH = CARPET_BASE_WIDTH * CARPET_SCALE;

export interface CarpetVertex {
    baseX: number;
    yOffset: number;
    velocity: number;
}

export interface CarpetState {
    currentX: number;
    currentY: number;
    targetX: number;
    targetY: number;
    startX: number;
    startY: number;
    currentScale: number;
    isOccupied: boolean;
    occupiedOffset: number;
    entering: boolean;
    exiting: boolean;
    progress: number;
    vertices: CarpetVertex[];
    landingProgress: number;
    effectiveStance: number;
    tiltAngle: number;
}

export const CARPET_FLY_DURATION = 1.5;
export const CARPET_ENTRY_STAGGER = 0.5;
export const CARPET_START_SCALE = 10;
export const CARPET_OFFSCREEN_DISTANCE = 350;
const CARPET_CONVERSATION_DROP = 10;
const CARPET_LANDING_SECONDS = 3;

export function createCarpetVertices(): CarpetVertex[] {
    const vertices: CarpetVertex[] = [];
    const segmentWidth = CARPET_WIDTH / (CARPET_VERTEX_COUNT - 1);
    for (let i = 0; i < CARPET_VERTEX_COUNT; i++) {
        vertices.push({
            baseX: -CARPET_WIDTH / 2 + i * segmentWidth,
            yOffset: 0,
            velocity: 0
        });
    }
    return vertices;
}

export function getOffscreenPosition(seatX: number, seatY: number, canvasWidth: number, canvasHeight: number): { x: number; y: number } {
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const dx = seatX - centerX;
    const dy = seatY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return { x: centerX - CARPET_OFFSCREEN_DISTANCE, y: centerY };

    const baseAngle = Math.atan2(dy, dx);
    const angleOffset = (Math.random() * 2 - 1) * (40 * Math.PI / 180);
    const finalAngle = baseAngle + angleOffset;
    const nx = Math.cos(finalAngle);
    const ny = Math.sin(finalAngle);

    return {
        x: seatX + nx * CARPET_OFFSCREEN_DISTANCE,
        y: seatY + ny * CARPET_OFFSCREEN_DISTANCE
    };
}

class WindField {
    private time: number = 0;
    private canvasWidth: number;
    public debugEnabled: boolean = false;

    private readonly bumpFreq = 0.08;
    private readonly bumpSpeed: number;
    private readonly bumpAmplitude = 2.5;

    private gustStrength: number = 0;
    private gustStartX: number = 0;
    private gustDirection: number = 1;
    private readonly gustSpeed = 50;
    private readonly gustWidth = 100;
    private nextGustTime: number = 0;

    constructor(canvasWidth: number) {
        this.canvasWidth = canvasWidth;
        this.bumpSpeed = (Math.random() < 0.5 ? -1 : 1) * 2;
    }

    update(deltaTime: number): void {
        this.time += deltaTime;

        if (this.time >= this.nextGustTime) {
            this.gustStrength = 8 + Math.random() * 8;
            this.gustDirection = Math.random() < 0.5 ? -1 : 1;
            this.gustStartX = this.gustDirection > 0 ? -this.gustWidth : this.canvasWidth + this.gustWidth;
            this.nextGustTime = this.time + 15 + Math.random() * 5;
        }

        this.gustStartX += this.gustDirection * this.gustSpeed * deltaTime;
    }

    sample(x: number): number {
        const bump = Math.sin(x * this.bumpFreq + this.time * this.bumpSpeed) * this.bumpAmplitude;

        const relX = (x - this.gustStartX) / this.gustWidth;
        const gust = (relX >= -1 && relX <= 1)
            ? this.gustStrength * Math.sin((relX + 1) * Math.PI)
            : 0;

        return bump + gust;
    }

    getCanvasWidth(): number {
        return this.canvasWidth;
    }
}

export interface SeatInfo {
    seatId: string;
    angle: number;
    targetAngle: number;
    x: number;
    y: number;
}

interface CarpetRenderData {
    carpetId: string;
    x: number;
    y: number;
    scale: number;
    opacity: number;
    landingProgress: number;
    effectiveStance: number;
    tiltAngle: number;
    vertices: Array<{ x: number; y: number }>;
}

export const MAX_TILT = 10;
const MAX_ROTATION_ANGLE = MAX_TILT * 3;

export class CarpetRenderer {
    private windField: WindField;
    private canvasWidth: number;
    private canvasHeight: number;

    private carpetGroup: SVGGElement;
    private carpetElements: SVGGElement[] = [];
    private carpetStates: Map<number, CarpetState> = new Map();
    private onCarpetDrag: ((carpetId: string, x: number, y: number) => void) | null = null;
    private onCarpetDragEnd: (() => void) | null = null;
    private draggingCarpetId: string | null = null;
    private conversationActive: boolean = false;
    private conversationPhases: Map<string, string> | null = null;

    private rotationDragCarpetId: string | null = null;
    private rotationStartAngle: number = 0;
    private rotationIndicator: SVGGElement | null = null;
    private latestCarpetStates: Map<string, CarpetState> | null = null;
    private latestConversationParticipants: Set<string> | null = null;
    private onRotationEnd: ((carpetId: string, stanceDelta: number) => void) | null = null;

    private activeRotations: Map<number, { carpetId: string; startAngle: number; indicator: SVGGElement }> = new Map();
    private activeDragTouch: number | null = null;

    private readonly CARPET_OCCUPIED_DROP = 35;
    private readonly CARPET_DAMPING = 0.92;
    private readonly CARPET_SPRING_STRENGTH = 15;

    constructor(canvasWidth: number, canvasHeight: number, parentGroup: SVGGElement) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.windField = new WindField(canvasWidth);

        this.carpetGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.carpetGroup.setAttribute('id', 'carpet-group');
        parentGroup.appendChild(this.carpetGroup);

        this.setupDragHandlers(parentGroup);
    }

    private setupDragHandlers(parentGroup: SVGGElement): void {
        const svg = parentGroup.ownerSVGElement;
        if (!svg) return;

        const toSvgCoords = (clientX: number, clientY: number): { x: number; y: number } => {
            const rect = svg.getBoundingClientRect();
            const scaleX = svg.viewBox.baseVal.width / rect.width;
            const scaleY = svg.viewBox.baseVal.height / rect.height;
            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY
            };
        };

        const findCarpetId = (target: EventTarget | null): string | undefined => {
            let el = target as SVGElement | null;
            while (el && !el.dataset?.carpetId) {
                el = el.parentElement as SVGElement | null;
            }
            return el?.dataset?.carpetId;
        };

        // --- Mouse handlers (single pointer, unchanged behavior) ---
        this.carpetGroup.addEventListener('mousedown', (e: MouseEvent) => {
            const carpetId = findCarpetId(e.target);
            if (!carpetId) return;
            if (this.conversationActive) {
                this.rotationDragCarpetId = carpetId;
                const pos = toSvgCoords(e.clientX, e.clientY);
                this.rotationStartAngle = this.computeRotation(carpetId, pos.x, pos.y).angleDeg;
                this.showRotationIndicator(carpetId);
            } else {
                this.draggingCarpetId = carpetId;
            }
            e.preventDefault();
            e.stopPropagation();
        });

        svg.addEventListener('mousemove', (e: MouseEvent) => {
            if (this.rotationDragCarpetId) {
                const pos = toSvgCoords(e.clientX, e.clientY);
                this.updateRotationMouseIndicator(pos.x, pos.y);
                e.preventDefault();
                return;
            }
            if (!this.draggingCarpetId || !this.onCarpetDrag) return;
            const pos = toSvgCoords(e.clientX, e.clientY);
            this.onCarpetDrag(this.draggingCarpetId, pos.x, pos.y);
            e.preventDefault();
        });

        const onMouseEnd = () => {
            if (this.rotationDragCarpetId) {
                this.commitRotation();
                return;
            }
            this.draggingCarpetId = null;
            this.onCarpetDragEnd?.();
        };
        svg.addEventListener('mouseup', onMouseEnd);
        svg.addEventListener('mouseleave', onMouseEnd);

        // --- Touch handlers (multitouch for rotation, single for drag) ---
        this.carpetGroup.addEventListener('touchstart', (e: TouchEvent) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                const carpetId = findCarpetId(touch.target);
                if (!carpetId) continue;

                if (this.conversationActive) {
                    if (this.activeRotations.has(touch.identifier)) continue;
                    const pos = toSvgCoords(touch.clientX, touch.clientY);
                    const startAngle = this.computeRotation(carpetId, pos.x, pos.y).angleDeg;
                    const indicator = this.createRotationIndicator(carpetId);
                    this.activeRotations.set(touch.identifier, { carpetId, startAngle, indicator });
                } else {
                    if (this.activeDragTouch === null) {
                        this.activeDragTouch = touch.identifier;
                        this.draggingCarpetId = carpetId;
                    }
                }
                e.preventDefault();
                e.stopPropagation();
            }
        }, { passive: false });

        svg.addEventListener('touchmove', (e: TouchEvent) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                const rotation = this.activeRotations.get(touch.identifier);
                if (rotation) {
                    const pos = toSvgCoords(touch.clientX, touch.clientY);
                    this.updateRotationIndicator(rotation.indicator, pos.x, pos.y);
                    e.preventDefault();
                    continue;
                }
                if (touch.identifier === this.activeDragTouch && this.draggingCarpetId && this.onCarpetDrag) {
                    const pos = toSvgCoords(touch.clientX, touch.clientY);
                    this.onCarpetDrag(this.draggingCarpetId, pos.x, pos.y);
                    e.preventDefault();
                }
            }
        }, { passive: false });

        const onTouchEnd = (e: TouchEvent) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                const rotation = this.activeRotations.get(touch.identifier);
                if (rotation) {
                    const pos = toSvgCoords(touch.clientX, touch.clientY);
                    this.commitTouchRotation(touch.identifier, pos.x, pos.y);
                    continue;
                }
                if (touch.identifier === this.activeDragTouch) {
                    this.activeDragTouch = null;
                    this.draggingCarpetId = null;
                    this.onCarpetDragEnd?.();
                }
            }
        };
        svg.addEventListener('touchend', onTouchEnd);
        svg.addEventListener('touchcancel', onTouchEnd);
    }

    setOnCarpetDrag(callback: (carpetId: string, x: number, y: number) => void, onEnd?: () => void): void {
        this.onCarpetDrag = callback;
        this.onCarpetDragEnd = onEnd ?? null;
    }

    setOnRotationEnd(callback: ((carpetId: string, stanceDelta: number) => void) | null): void {
        this.onRotationEnd = callback;
    }

    setConversationActive(active: boolean): void {
        this.conversationActive = active;
        for (const el of this.carpetElements) {
            el.setAttribute('cursor', active ? 'pointer' : 'grab');
        }
    }

    isDragging(): boolean {
        return this.draggingCarpetId !== null;
    }

    getDraggingCarpetId(): string | null {
        return this.draggingCarpetId;
    }

    private easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    setConversationPhases(phases: Map<string, string> | null): void {
        this.conversationPhases = phases;
    }

    isCarpetSettled(carpetId: string): boolean {
        const carpet = this.latestCarpetStates?.get(carpetId);
        if (!carpet) return false;
        return !carpet.entering && !carpet.exiting && carpet.landingProgress > 0.95;
    }

    getCarpetElement(carpetId: string): SVGGElement | null {
        return this.carpetElements.find(el => el.dataset.carpetId === carpetId) ?? null;
    }

    getCarpetCenter(carpetId: string): { x: number; y: number } | null {
        const carpet = this.latestCarpetStates?.get(carpetId);
        if (!carpet) return null;
        return { x: carpet.currentX, y: carpet.currentY + carpet.occupiedOffset };
    }

    getCarpetVisualCenter(carpetId: string): { x: number; y: number } | null {
        const carpet = this.latestCarpetStates?.get(carpetId);
        if (!carpet) return null;
        const depthScale = Math.sqrt(carpet.currentScale);
        const baseIsoX = 8 * depthScale * 2;
        const baseIsoY = -6 * depthScale * 2;
        const flatDepth = Math.sqrt(baseIsoX * baseIsoX + baseIsoY * baseIsoY);
        const flattenFraction = Math.max(0, Math.min(1, (carpet.landingProgress - 0.4) / 0.4));
        const animIsoX = baseIsoX * (1 - flattenFraction);
        const animIsoY = baseIsoY * (1 - flattenFraction) - flatDepth * flattenFraction;
        return {
            x: carpet.currentX - animIsoX / 2,
            y: carpet.currentY + carpet.occupiedOffset - animIsoY / 2
        };
    }

    getTiltSign(carpetId: string): number {
        if (!this.latestCarpetStates || !this.latestConversationParticipants) return 1;
        const carpet = this.latestCarpetStates.get(carpetId);
        if (!carpet) return 1;
        let partnerId: string | null = null;
        for (const pid of this.latestConversationParticipants) {
            if (pid !== carpetId) { partnerId = pid; break; }
        }
        const partner = partnerId ? this.latestCarpetStates.get(partnerId) : null;
        if (!partner) return 1;
        return partner.currentX >= carpet.currentX ? 1 : -1;
    }

    private computeRotation(carpetId: string, mouseX: number, mouseY: number): { angleDeg: number; lineLength: number } {
        const center = this.getCarpetCenter(carpetId);
        if (!center) return { angleDeg: 0, lineLength: 0 };
        const dx = mouseX - center.x;
        const dy = mouseY - center.y;
        const lineLength = Math.sqrt(dx * dx + dy * dy);
        // Angle off horizontal: atan2(dy, |dx|) so left and right both produce positive angle for downward drag
        const rawAngle = Math.atan2(dy, Math.abs(dx)) * 180 / Math.PI;
        const tiltSign = this.getTiltSign(carpetId);
        const horizontalSign = dx >= 0 ? 1 : -1;
        const directionSign = horizontalSign * tiltSign;
        return { angleDeg: rawAngle * directionSign, lineLength };
    }

    private createRotationIndicator(carpetId: string): SVGGElement {
        const center = this.getCarpetCenter(carpetId);
        const svg = this.carpetGroup.ownerSVGElement!;
        const cx = center?.x ?? 0;
        const cy = center?.y ?? 0;

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('pointer-events', 'none');
        group.dataset.anchorX = String(cx);
        group.dataset.anchorY = String(cy);
        group.dataset.cursorX = String(cx);
        group.dataset.cursorY = String(cy);

        const border = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        border.setAttribute('fill', 'none');
        border.setAttribute('stroke', 'rgba(128, 128, 128, 0.6)');
        border.setAttribute('stroke-width', '3');
        border.setAttribute('stroke-linejoin', 'round');
        border.setAttribute('points', `${cx},${cy} ${cx},${cy} ${cx},${cy}`);

        const fill = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        fill.setAttribute('fill', 'rgba(255, 255, 255, 0.4)');
        fill.setAttribute('stroke', 'none');
        fill.setAttribute('points', `${cx},${cy} ${cx},${cy} ${cx},${cy}`);

        group.appendChild(border);
        group.appendChild(fill);
        svg.appendChild(group);
        return group;
    }

    private updateRotationIndicator(indicator: SVGGElement, x: number, y: number): void {
        const ax = parseFloat(indicator.dataset.anchorX ?? '0');
        const ay = parseFloat(indicator.dataset.anchorY ?? '0');
        indicator.dataset.cursorX = String(x);
        indicator.dataset.cursorY = String(y);

        const halfBase = 9;
        const dx = x - ax;
        const dy = y - ay;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) return;

        // Perpendicular to the line from anchor to cursor
        const px = -dy / len * halfBase;
        const py = dx / len * halfBase;

        const points = `${ax},${ay} ${x + px},${y + py} ${x - px},${y - py}`;
        const polygons = indicator.querySelectorAll('polygon');
        for (const p of polygons) {
            p.setAttribute('points', points);
        }
    }

    private commitTouchRotation(touchId: number, x: number, y: number): void {
        const rotation = this.activeRotations.get(touchId);
        if (!rotation) return;
        this.activeRotations.delete(touchId);
        const { angleDeg } = this.computeRotation(rotation.carpetId, x, y);
        const relativeAngle = Math.max(-MAX_ROTATION_ANGLE, Math.min(MAX_ROTATION_ANGLE, angleDeg - rotation.startAngle));
        const stanceDelta = (relativeAngle / MAX_TILT) * REGULATION_STANCE_LIMIT;
        rotation.indicator.remove();
        this.onRotationEnd?.(rotation.carpetId, stanceDelta);
    }

    getCurrentDragStanceDelta(): number | null {
        if (!this.rotationIndicator || !this.rotationDragCarpetId) return null;
        const x2 = parseFloat(this.rotationIndicator.dataset.cursorX ?? '0');
        const y2 = parseFloat(this.rotationIndicator.dataset.cursorY ?? '0');
        const { angleDeg } = this.computeRotation(this.rotationDragCarpetId, x2, y2);
        const relativeAngle = Math.max(-MAX_ROTATION_ANGLE, Math.min(MAX_ROTATION_ANGLE, angleDeg - this.rotationStartAngle));
        return (relativeAngle / MAX_TILT) * REGULATION_STANCE_LIMIT;
    }

    private showRotationIndicator(carpetId: string): void {
        this.hideRotationIndicator();
        this.rotationIndicator = this.createRotationIndicator(carpetId);
    }

    private updateRotationMouseIndicator(mouseX: number, mouseY: number): void {
        if (!this.rotationIndicator) return;
        this.updateRotationIndicator(this.rotationIndicator, mouseX, mouseY);
    }

    private commitRotation(): void {
        if (!this.rotationIndicator || !this.rotationDragCarpetId) {
            this.rotationDragCarpetId = null;
            return;
        }
        const x2 = parseFloat(this.rotationIndicator.dataset.cursorX ?? '0');
        const y2 = parseFloat(this.rotationIndicator.dataset.cursorY ?? '0');
        const { angleDeg } = this.computeRotation(this.rotationDragCarpetId, x2, y2);
        const relativeAngle = Math.max(-MAX_ROTATION_ANGLE, Math.min(MAX_ROTATION_ANGLE, angleDeg - this.rotationStartAngle));
        const stanceDelta = (relativeAngle / MAX_TILT) * REGULATION_STANCE_LIMIT;
        const carpetId = this.rotationDragCarpetId;
        this.hideRotationIndicator();
        this.rotationDragCarpetId = null;
        this.onRotationEnd?.(carpetId, stanceDelta);
    }

    private hideRotationIndicator(): void {
        this.rotationIndicator?.remove();
        this.rotationIndicator = null;
    }

    update(carpetStates: Map<string, CarpetState>, seats: SeatInfo[], deltaTime: number, conversationParticipants: Set<string> | null = null, effectiveStances: Map<string, number> | null = null): void {
        this.latestConversationParticipants = conversationParticipants;
        this.windField.update(deltaTime);

        for (const [seatId, carpet] of carpetStates) {
            carpet.progress += deltaTime;

            if (carpet.exiting) {
                const t = Math.min(carpet.progress / CARPET_FLY_DURATION, 1);
                const eased = this.easeInOutCubic(t);
                carpet.currentX = carpet.targetX + (carpet.startX - carpet.targetX) * eased;
                carpet.currentY = carpet.targetY + (carpet.startY - carpet.targetY) * eased;
                carpet.currentScale = CARPET_SCALE + (CARPET_START_SCALE - CARPET_SCALE) * eased;
                if (t >= 1) {
                    carpetStates.delete(seatId);
                }
                continue;
            }

            const seat = seats.find(s => s.seatId === seatId);
            if (seat) {
                carpet.targetX = seat.x;
                carpet.targetY = seat.y;
            }
            if (carpet.entering) {
                if (carpet.progress < 0) continue;
                const t = Math.min(carpet.progress / CARPET_FLY_DURATION, 1);
                const eased = this.easeInOutCubic(t);
                carpet.currentX = carpet.startX + (carpet.targetX - carpet.startX) * eased;
                carpet.currentY = carpet.startY + (carpet.targetY - carpet.startY) * eased;
                carpet.currentScale = CARPET_START_SCALE + (CARPET_SCALE - CARPET_START_SCALE) * eased;
                if (t >= 1) {
                    carpet.entering = false;
                    carpet.currentX = carpet.targetX;
                    carpet.currentY = carpet.targetY;
                    carpet.currentScale = CARPET_SCALE;
                }
            }

            const landingTarget = (conversationParticipants?.has(seatId)) ? 1 : 0;
            carpet.landingProgress += (landingTarget - carpet.landingProgress) * (1 - Math.exp(-3 / CARPET_LANDING_SECONDS * deltaTime));
            if (Math.abs(carpet.landingProgress - landingTarget) < 0.001) {
                carpet.landingProgress = landingTarget;
            }

            carpet.effectiveStance = effectiveStances?.get(seatId) ?? 0;

            if (conversationParticipants?.has(seatId) && conversationParticipants.size === 2) {
                let partnerId: string | null = null;
                for (const pid of conversationParticipants) {
                    if (pid !== seatId) { partnerId = pid; break; }
                }
                const partner = partnerId ? carpetStates.get(partnerId) : null;
                if (partner) {
                    const dx = partner.currentX - carpet.currentX;
                    const tiltSign = dx >= 0 ? 1 : -1;
                    const clampedStance = Math.max(-REGULATION_STANCE_LIMIT, Math.min(REGULATION_STANCE_LIMIT, carpet.effectiveStance));
                    const targetTilt = tiltSign * (clampedStance / REGULATION_STANCE_LIMIT) * MAX_TILT;
                    carpet.tiltAngle += (targetTilt - carpet.tiltAngle) * (1 - Math.exp(-2 * deltaTime));
                }
            } else {
                carpet.tiltAngle += (0 - carpet.tiltAngle) * (1 - Math.exp(-2 * deltaTime));
            }

            carpet.isOccupied = seat !== undefined;
            const targetOffset = carpet.isOccupied ? this.CARPET_OCCUPIED_DROP : 0;
            const landingDrop = carpet.landingProgress * CARPET_CONVERSATION_DROP;
            const offsetSmoothing = 4;
            const offsetFactor = 1 - Math.exp(-offsetSmoothing * deltaTime);
            carpet.occupiedOffset += (targetOffset + landingDrop - carpet.occupiedOffset) * offsetFactor;

            const windDampen = 1 - Math.min(1, carpet.landingProgress / 0.4);

            for (let i = 0; i < carpet.vertices.length; i++) {
                const vertex = carpet.vertices[i];
                const worldX = carpet.currentX + vertex.baseX;
                const windForce = this.windField.sample(worldX) * windDampen;
                vertex.velocity += windForce * this.CARPET_SPRING_STRENGTH * deltaTime;
                vertex.velocity -= vertex.yOffset * this.CARPET_SPRING_STRENGTH * 0.5 * deltaTime;
                if (i > 0) {
                    const prev = carpet.vertices[i - 1];
                    const diff = prev.yOffset - vertex.yOffset;
                    vertex.velocity += diff * this.CARPET_SPRING_STRENGTH * 0.3 * deltaTime;
                }
                if (i < carpet.vertices.length - 1) {
                    const next = carpet.vertices[i + 1];
                    const diff = next.yOffset - vertex.yOffset;
                    vertex.velocity += diff * this.CARPET_SPRING_STRENGTH * 0.3 * deltaTime;
                }
                vertex.velocity *= Math.pow(this.CARPET_DAMPING, deltaTime * 60);
                vertex.yOffset += vertex.velocity * deltaTime;
            }
        }
    }

    render(carpetStates: Map<string, CarpetState>): void {
        this.latestCarpetStates = carpetStates;
        const carpetData = this.getRenderData(carpetStates);

        while (this.carpetElements.length < carpetData.length) {
            const carpet = this.createCarpetElement();
            this.carpetGroup.appendChild(carpet);
            this.carpetElements.push(carpet);
        }

        while (this.carpetElements.length > carpetData.length) {
            const carpet = this.carpetElements.pop();
            carpet?.remove();
        }

        for (let i = 0; i < carpetData.length; i++) {
            const data = carpetData[i];
            const carpet = this.carpetElements[i];
            const tilt = Math.abs(data.tiltAngle) > 0.01 ? ` rotate(${data.tiltAngle.toFixed(1)})` : '';
            carpet.setAttribute('transform', `translate(${data.x}, ${data.y}) scale(${data.scale})${tilt}`);
            carpet.setAttribute('opacity', String(data.opacity));
            carpet.dataset.carpetId = data.carpetId;

            this.updateCarpetPath(carpet, data.vertices, data.landingProgress, data.effectiveStance, data.carpetId, data.tiltAngle);
        }
    }

    private getRenderData(carpetStates: Map<string, CarpetState>): CarpetRenderData[] {
        const carpets: CarpetRenderData[] = [];

        for (const [carpetId, carpet] of carpetStates) {
            let opacity = 1;
            if (carpet.entering && carpet.progress < 0) {
                opacity = 0;
            } else if (carpet.entering) {
                const t = Math.min(carpet.progress / CARPET_FLY_DURATION, 1);
                opacity = this.easeInOutCubic(t);
            } else if (carpet.exiting) {
                const t = Math.min(carpet.progress / CARPET_FLY_DURATION, 1);
                opacity = 1 - this.easeInOutCubic(t);
            }

            const vertices = carpet.vertices.map(v => ({
                x: v.baseX,
                y: v.yOffset
            }));

            const depthScale = Math.sqrt(carpet.currentScale);
            const baseIsoX = 8 * depthScale * 2;
            const baseIsoY = -6 * depthScale * 2;
            const flatDepth = Math.sqrt(baseIsoX * baseIsoX + baseIsoY * baseIsoY);
            const flattenFraction = Math.max(0, Math.min(1, (carpet.landingProgress - 0.4) / 0.4));
            const animIsoX = baseIsoX * (1 - flattenFraction);
            const animIsoY = baseIsoY * (1 - flattenFraction) - flatDepth * flattenFraction;

            carpets.push({
                carpetId,
                x: carpet.currentX - animIsoX / 2,
                y: carpet.currentY + carpet.occupiedOffset - animIsoY / 2,
                scale: carpet.currentScale / CARPET_SCALE,
                opacity,
                landingProgress: carpet.landingProgress,
                effectiveStance: carpet.effectiveStance,
                tiltAngle: carpet.tiltAngle,
                vertices
            });
        }

        return carpets;
    }

    private static PHASE_LABELS: Record<string, string> = {
        'speak': 'Speaking',
        'listen': 'Listening',
        'mirror': 'Mirroring',
        'validate': 'Validating',
        'empathize': 'Empathizing',
    };

    private updateCarpetPath(group: SVGGElement, vertices: Array<{ x: number; y: number }>, landingProgress: number = 0, effectiveStance: number = 0, carpetId: string = '', tiltAngle: number = 0): void {
        const topSurface = group.querySelector('.carpet-top-surface') as SVGPathElement;
        const frontEdge = group.querySelector('.carpet-front-edge') as SVGPathElement;
        const sideFace = group.querySelector('.carpet-side-face') as SVGPathElement;
        const insetFrame = group.querySelector('.carpet-inset-frame') as SVGPathElement;
        const badgeText = group.querySelector('.carpet-badge') as SVGTextElement;
        const stanceBadge = group.querySelector('.carpet-stance-badge') as SVGTextElement;

        if (!topSurface || vertices.length < 2) return;

        const flattenFraction = Math.max(0, Math.min(1, (landingProgress - 0.4) / 0.4));
        const badgeOpacity = landingProgress >= 0.8 ? 1 : 0;

        const depthScale = Math.sqrt(CARPET_SCALE);
        const thickness = 1 * CARPET_SCALE;
        const baseIsoX = 8 * depthScale * 2;
        const baseIsoY = -6 * depthScale * 2;
        const flatDepth = Math.sqrt(baseIsoX * baseIsoX + baseIsoY * baseIsoY);
        const isoX = baseIsoX * (1 - flattenFraction);
        const isoY = baseIsoY * (1 - flattenFraction) - flatDepth * flattenFraction;

        if (badgeText) {
            badgeText.style.opacity = String(badgeOpacity);
            badgeText.setAttribute('x', String(isoX / 2));
            badgeText.setAttribute('y', String(isoY / 2 - 6));
            const phase = this.conversationPhases?.get(carpetId);
            badgeText.textContent = phase ? (CarpetRenderer.PHASE_LABELS[phase] ?? phase) : '';
        }
        if (stanceBadge) {
            stanceBadge.style.opacity = String(badgeOpacity);
            stanceBadge.setAttribute('x', String(isoX / 2));
            stanceBadge.setAttribute('y', String(isoY / 2 + 8));
            const sign = effectiveStance >= 0 ? '+' : '';
            stanceBadge.textContent = `${sign}${effectiveStance.toFixed(2)}`;
        }

        if (frontEdge) {
            frontEdge.style.opacity = String(1 - flattenFraction);
        }
        if (sideFace) {
            sideFace.style.opacity = String(1 - flattenFraction);
        }

        const firstV = vertices[0];
        const lastV = vertices[vertices.length - 1];

        let topSurfaceD = `M ${firstV.x} ${firstV.y}`;
        for (let i = 1; i < vertices.length; i++) {
            const prev = vertices[i - 1];
            const curr = vertices[i];
            const cpX = (prev.x + curr.x) / 2;
            topSurfaceD += ` Q ${cpX} ${(prev.y + curr.y) / 2} ${curr.x} ${curr.y}`;
        }
        topSurfaceD += ` L ${lastV.x + isoX} ${lastV.y + isoY}`;
        for (let i = vertices.length - 2; i >= 0; i--) {
            const next = vertices[i + 1];
            const curr = vertices[i];
            const cpX = (next.x + curr.x) / 2 + isoX;
            topSurfaceD += ` Q ${cpX} ${(next.y + curr.y) / 2 + isoY} ${curr.x + isoX} ${curr.y + isoY}`;
        }
        topSurfaceD += ` Z`;

        topSurface.setAttribute('d', topSurfaceD);

        if (frontEdge) {
            let frontD = `M ${firstV.x} ${firstV.y}`;
            for (let i = 1; i < vertices.length; i++) {
                const prev = vertices[i - 1];
                const curr = vertices[i];
                const cpX = (prev.x + curr.x) / 2;
                frontD += ` Q ${cpX} ${(prev.y + curr.y) / 2} ${curr.x} ${curr.y}`;
            }
            frontD += ` L ${lastV.x} ${lastV.y + thickness}`;
            for (let i = vertices.length - 2; i >= 0; i--) {
                const next = vertices[i + 1];
                const curr = vertices[i];
                const cpX = (next.x + curr.x) / 2;
                frontD += ` Q ${cpX} ${(next.y + curr.y) / 2 + thickness} ${curr.x} ${curr.y + thickness}`;
            }
            frontD += ` Z`;
            frontEdge.setAttribute('d', frontD);
        }

        if (sideFace) {
            const sideD = `M ${lastV.x} ${lastV.y}
                L ${lastV.x + isoX} ${lastV.y + isoY}
                L ${lastV.x + isoX} ${lastV.y + isoY + thickness}
                L ${lastV.x} ${lastV.y + thickness} Z`;
            sideFace.setAttribute('d', sideD);
        }

        if (insetFrame) {
            const inset = 5;

            const isoLen = Math.sqrt(isoX * isoX + isoY * isoY);
            const perpX = -isoY / isoLen;
            const perpY = isoX / isoLen;

            const leftInsetX = perpX * inset;
            const leftInsetY = perpY * inset;

            const rightInsetX = -perpX * inset;
            const rightInsetY = -perpY * inset;

            const frontInsetX = (isoX / isoLen) * inset;
            const frontInsetY = (isoY / isoLen) * inset;

            const backInsetX = -(isoX / isoLen) * inset;
            const backInsetY = -(isoY / isoLen) * inset;

            const flX = firstV.x + leftInsetX + frontInsetX;
            const flY = firstV.y + leftInsetY + frontInsetY;

            let insetD = `M ${flX} ${flY}`;
            for (let i = 1; i < vertices.length; i++) {
                const prev = vertices[i - 1];
                const curr = vertices[i];

                const prevInsetX = (i === 1 ? leftInsetX : 0) + frontInsetX;
                const prevInsetY = (i === 1 ? leftInsetY : 0) + frontInsetY;
                const currInsetX = (i === vertices.length - 1 ? rightInsetX : 0) + frontInsetX;
                const currInsetY = (i === vertices.length - 1 ? rightInsetY : 0) + frontInsetY;

                const cpX = (prev.x + curr.x) / 2 + (prevInsetX + currInsetX) / 2;
                const cpY = (prev.y + curr.y) / 2 + (prevInsetY + currInsetY) / 2;
                insetD += ` Q ${cpX} ${cpY} ${curr.x + currInsetX} ${curr.y + currInsetY}`;
            }

            const brX = lastV.x + isoX + rightInsetX + backInsetX;
            const brY = lastV.y + isoY + rightInsetY + backInsetY;
            insetD += ` L ${brX} ${brY}`;

            for (let i = vertices.length - 2; i >= 0; i--) {
                const next = vertices[i + 1];
                const curr = vertices[i];

                const nextInsetX = (i === vertices.length - 2 ? rightInsetX : 0) + backInsetX;
                const nextInsetY = (i === vertices.length - 2 ? rightInsetY : 0) + backInsetY;
                const currInsetX = (i === 0 ? leftInsetX : 0) + backInsetX;
                const currInsetY = (i === 0 ? leftInsetY : 0) + backInsetY;

                const cpX = (next.x + curr.x) / 2 + isoX + (nextInsetX + currInsetX) / 2;
                const cpY = (next.y + curr.y) / 2 + isoY + (nextInsetY + currInsetY) / 2;
                insetD += ` Q ${cpX} ${cpY} ${curr.x + isoX + currInsetX} ${curr.y + isoY + currInsetY}`;
            }

            insetD += ` Z`;

            insetFrame.setAttribute('d', insetD);

            const stanceBlend = landingProgress * effectiveStance;
            if (Math.abs(stanceBlend) > 0.001) {
                const strokeWidth = 1.5 + stanceBlend * 1.5;
                insetFrame.setAttribute('stroke-width', String(strokeWidth));
                const lerpColor = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
                if (stanceBlend > 0) {
                    const r = lerpColor(0x8B, 0xCC, stanceBlend);
                    insetFrame.setAttribute('stroke', `rgb(${r},0,0)`);
                } else {
                    // #8B0000 grayscale = 0.299*0x8B ≈ 42
                    const t = -stanceBlend;
                    const gray = 42;
                    const r = lerpColor(0x8B, gray, t);
                    const g = lerpColor(0x00, gray, t);
                    const b = lerpColor(0x00, gray, t);
                    insetFrame.setAttribute('stroke', `rgb(${r},${g},${b})`);
                }
            } else {
                insetFrame.setAttribute('stroke-width', '1.5');
                insetFrame.setAttribute('stroke', '#8B0000');
            }
        }

        if (topSurface) {
            const stanceBlend = landingProgress * effectiveStance;
            if (stanceBlend < -0.001) {
                // #B8860B grayscale = 0.299*184 + 0.587*134 + 0.114*11 ≈ 134
                const t = -stanceBlend;
                const gray = 134;
                const lerpColor = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
                const r = lerpColor(0xB8, gray, t);
                const g = lerpColor(0x86, gray, t);
                const b = lerpColor(0x0B, gray, t);
                topSurface.setAttribute('fill', `rgb(${r},${g},${b})`);
            } else {
                topSurface.setAttribute('fill', '#B8860B');
            }
        }
    }

    private createCarpetElement(): SVGGElement {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'flying-carpet');
        group.setAttribute('pointer-events', 'all');
        group.setAttribute('cursor', this.conversationActive ? 'pointer' : 'grab');

        const sideFace = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        sideFace.setAttribute('class', 'carpet-side-face');
        sideFace.setAttribute('fill', '#2A1505');
        sideFace.setAttribute('stroke', 'none');

        const frontEdge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        frontEdge.setAttribute('class', 'carpet-front-edge');
        frontEdge.setAttribute('fill', '#3D2510');
        frontEdge.setAttribute('stroke', '#1A0A02');
        frontEdge.setAttribute('stroke-width', '0.5');

        const topSurface = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        topSurface.setAttribute('class', 'carpet-top-surface');
        topSurface.setAttribute('fill', '#B8860B');
        topSurface.setAttribute('stroke', '#8B6914');
        topSurface.setAttribute('stroke-width', '1');

        const insetFrame = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        insetFrame.setAttribute('class', 'carpet-inset-frame');
        insetFrame.setAttribute('fill', 'none');
        insetFrame.setAttribute('stroke', '#8B0000');
        insetFrame.setAttribute('stroke-width', '1.5');

        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badge.setAttribute('class', 'carpet-badge');
        badge.setAttribute('fill', 'white');
        badge.setAttribute('font-size', '12');
        badge.setAttribute('font-weight', 'bold');
        badge.setAttribute('text-anchor', 'middle');
        badge.setAttribute('dominant-baseline', 'central');
        badge.setAttribute('x', '0');
        badge.setAttribute('y', '0');
        badge.setAttribute('pointer-events', 'none');
        badge.style.userSelect = 'none';
        badge.style.opacity = '0';
        badge.textContent = '';

        const stanceBadge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        stanceBadge.setAttribute('class', 'carpet-stance-badge');
        stanceBadge.setAttribute('fill', '#7CFC00');
        stanceBadge.setAttribute('font-size', '9');
        stanceBadge.setAttribute('font-family', 'monospace');
        stanceBadge.setAttribute('text-anchor', 'middle');
        stanceBadge.setAttribute('dominant-baseline', 'central');
        stanceBadge.setAttribute('pointer-events', 'none');
        stanceBadge.style.userSelect = 'none';
        stanceBadge.style.opacity = '0';

        group.appendChild(sideFace);
        group.appendChild(frontEdge);
        group.appendChild(topSurface);
        group.appendChild(insetFrame);
        group.appendChild(badge);
        group.appendChild(stanceBadge);

        return group;
    }

    clear(): void {
        for (const carpet of this.carpetElements) {
            carpet.remove();
        }
        this.carpetElements = [];
    }

    setDimensions(width: number, height: number): void {
        this.canvasWidth = width;
        this.canvasHeight = height;
    }

    setDebugMode(enabled: boolean): void {
        this.windField.debugEnabled = enabled;
        if (!enabled) {
            const existing = this.carpetGroup.parentElement?.querySelector('#wind-debug-group');
            existing?.remove();
        }
    }

    renderDebugWaveField(carpetStates: Map<string, CarpetState>): void {
        if (!this.windField.debugEnabled) return;

        const parent = this.carpetGroup.parentElement;
        if (!parent) return;

        let debugGroup = parent.querySelector('#wind-debug-group') as SVGGElement | null;
        if (!debugGroup) {
            debugGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            debugGroup.setAttribute('id', 'wind-debug-group');
            parent.insertBefore(debugGroup, parent.firstChild);
        }

        while (debugGroup.firstChild) {
            debugGroup.removeChild(debugGroup.firstChild);
        }

        const sampleCount = 100;
        const width = this.windField.getCanvasWidth();
        const centerY = this.canvasHeight / 2;
        const scale = 5;

        let pathD = '';
        for (let i = 0; i < sampleCount; i++) {
            const x = (i / (sampleCount - 1)) * width;
            const windForce = this.windField.sample(x);
            const y = centerY + windForce * scale;
            pathD += (i === 0 ? 'M' : 'L') + ` ${x} ${y}`;
        }

        const wavePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        wavePath.setAttribute('d', pathD);
        wavePath.setAttribute('fill', 'none');
        wavePath.setAttribute('stroke', 'rgba(255, 100, 100, 0.7)');
        wavePath.setAttribute('stroke-width', '2');
        debugGroup.appendChild(wavePath);

        const zeroLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        zeroLine.setAttribute('x1', '0');
        zeroLine.setAttribute('y1', String(centerY));
        zeroLine.setAttribute('x2', String(width));
        zeroLine.setAttribute('y2', String(centerY));
        zeroLine.setAttribute('stroke', 'rgba(255, 255, 255, 0.3)');
        zeroLine.setAttribute('stroke-width', '1');
        zeroLine.setAttribute('stroke-dasharray', '5,5');
        debugGroup.appendChild(zeroLine);

        for (const carpet of carpetStates.values()) {
            for (const vertex of carpet.vertices) {
                const worldX = carpet.currentX + vertex.baseX;
                const windForce = this.windField.sample(worldX);

                const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                marker.setAttribute('cx', String(worldX));
                marker.setAttribute('cy', String(centerY + windForce * scale));
                marker.setAttribute('r', '4');
                marker.setAttribute('fill', 'rgba(100, 255, 100, 0.8)');
                debugGroup.appendChild(marker);

                const vertLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                vertLine.setAttribute('x1', String(worldX));
                vertLine.setAttribute('y1', String(centerY));
                vertLine.setAttribute('x2', String(worldX));
                vertLine.setAttribute('y2', String(centerY + windForce * scale));
                vertLine.setAttribute('stroke', 'rgba(100, 255, 100, 0.4)');
                vertLine.setAttribute('stroke-width', '1');
                debugGroup.appendChild(vertLine);
            }
        }

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', '10');
        label.setAttribute('y', '20');
        label.setAttribute('fill', 'rgba(255, 100, 100, 0.9)');
        label.setAttribute('font-size', '12');
        label.setAttribute('font-family', 'monospace');
        label.textContent = 'Wind Field Debug (red=wave, green=carpet vertices)';
        debugGroup.appendChild(label);
    }
}
