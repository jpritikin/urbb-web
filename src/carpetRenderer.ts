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
}

export const CARPET_FLY_DURATION = 1.5;
export const CARPET_ENTRY_STAGGER = 0.5;
export const CARPET_START_SCALE = 10;
export const CARPET_OFFSCREEN_DISTANCE = 350;

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

export class CarpetRenderer {
    private windField: WindField;
    private canvasWidth: number;
    private canvasHeight: number;

    private carpetGroup: SVGGElement;
    private carpetElements: SVGGElement[] = [];
    private carpetStates: Map<number, CarpetState> = new Map();

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
    }

    private easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    update(carpetStates: Map<string, CarpetState>, seats: SeatInfo[], deltaTime: number): void {
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
            } else {
                const smoothing = 5;
                const factor = 1 - Math.exp(-smoothing * deltaTime);
                carpet.currentX += (carpet.targetX - carpet.currentX) * factor;
                carpet.currentY += (carpet.targetY - carpet.currentY) * factor;
            }

            carpet.isOccupied = seat !== undefined;
            const targetOffset = carpet.isOccupied ? this.CARPET_OCCUPIED_DROP : 0;
            const offsetSmoothing = 4;
            const offsetFactor = 1 - Math.exp(-offsetSmoothing * deltaTime);
            carpet.occupiedOffset += (targetOffset - carpet.occupiedOffset) * offsetFactor;

            for (let i = 0; i < carpet.vertices.length; i++) {
                const vertex = carpet.vertices[i];
                const worldX = carpet.currentX + vertex.baseX;
                const windForce = this.windField.sample(worldX);
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
                vertex.velocity *= this.CARPET_DAMPING;
                vertex.yOffset += vertex.velocity * deltaTime;
            }
        }
    }

    render(carpetStates: Map<string, CarpetState>): void {
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
            carpet.setAttribute('transform', `translate(${data.x}, ${data.y}) scale(${data.scale})`);
            carpet.setAttribute('opacity', String(data.opacity));

            this.updateCarpetPath(carpet, data.vertices);
        }
    }

    private getRenderData(carpetStates: Map<string, CarpetState>): Array<{
        x: number;
        y: number;
        scale: number;
        opacity: number;
        vertices: Array<{ x: number; y: number }>;
    }> {
        const carpets: Array<{
            x: number;
            y: number;
            scale: number;
            opacity: number;
            vertices: Array<{ x: number; y: number }>;
        }> = [];

        for (const carpet of carpetStates.values()) {
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
            const isoX = 8 * depthScale * 2;

            carpets.push({
                x: carpet.currentX - isoX / 2,
                y: carpet.currentY + carpet.occupiedOffset,
                scale: carpet.currentScale / CARPET_SCALE,
                opacity,
                vertices
            });
        }

        return carpets;
    }

    private updateCarpetPath(group: SVGGElement, vertices: Array<{ x: number; y: number }>): void {
        const topSurface = group.querySelector('.carpet-top-surface') as SVGPathElement;
        const frontEdge = group.querySelector('.carpet-front-edge') as SVGPathElement;
        const sideFace = group.querySelector('.carpet-side-face') as SVGPathElement;
        const insetFrame = group.querySelector('.carpet-inset-frame') as SVGPathElement;

        if (!topSurface || vertices.length < 2) return;

        const depthScale = Math.sqrt(CARPET_SCALE);
        const thickness = 1 * CARPET_SCALE;
        const isoX = 8 * depthScale * 2;
        const isoY = -6 * depthScale * 2;

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
        }
    }

    private createCarpetElement(): SVGGElement {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'flying-carpet');

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

        group.appendChild(sideFace);
        group.appendChild(frontEdge);
        group.appendChild(topSurface);
        group.appendChild(insetFrame);

        return group;
    }

    clear(): void {
        for (const carpet of this.carpetElements) {
            carpet.remove();
        }
        this.carpetElements = [];
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
