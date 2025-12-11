const CARPET_VERTEX_COUNT = 8;
const CARPET_BASE_WIDTH = 40;
export const CARPET_SCALE = 3;
const CARPET_WIDTH = CARPET_BASE_WIDTH * CARPET_SCALE;

interface CarpetVertex {
    baseX: number;
    yOffset: number;
    velocity: number;
}

interface CarpetState {
    seatIndex: number;
    currentX: number;
    currentY: number;
    targetX: number;
    targetY: number;
    isOccupied: boolean;
    occupiedOffset: number;
    entering: boolean;
    exiting: boolean;
    exitProgress: number;
    entryProgress: number;
    entryStartX: number;
    entryStartY: number;
    vertices: CarpetVertex[];
}

interface WindWave {
    amplitude: number;
    spatialFrequency: number;
    speed: number;
    phase: number;
}

interface WindImpulse {
    startTime: number;
    duration: number;
    peakAmplitude: number;
    position: number;
    width: number;
}

class WindField {
    private waves: WindWave[] = [];
    private impulses: WindImpulse[] = [];
    private direction: number;
    private time: number = 0;
    private baseWindSpeed: number = 1;
    private targetWindSpeed: number = 1;
    private canvasWidth: number;

    constructor(canvasWidth: number) {
        this.canvasWidth = canvasWidth;
        this.direction = Math.random() < 0.5 ? 1 : -1;

        this.waves = [
            { amplitude: 1.2, spatialFrequency: 0.015, speed: 80, phase: Math.random() * Math.PI * 2 },
            { amplitude: 0.8, spatialFrequency: 0.035, speed: 120, phase: Math.random() * Math.PI * 2 },
            { amplitude: 0.5, spatialFrequency: 0.008, speed: 40, phase: Math.random() * Math.PI * 2 },
            { amplitude: 0.6, spatialFrequency: 0.055, speed: 180, phase: Math.random() * Math.PI * 2 },
        ];

        for (let i = 0; i < 3; i++) {
            this.impulses.push({
                startTime: -Math.random() * 2,
                duration: 0.4 + Math.random() * 0.4,
                peakAmplitude: 0.8 + Math.random() * 1.5,
                position: Math.random() * this.canvasWidth,
                width: 100 + Math.random() * 200
            });
        }
    }

    update(deltaTime: number): void {
        this.time += deltaTime;

        if (Math.random() < 0.02 * deltaTime) {
            this.targetWindSpeed = 0.3 + Math.random() * 1.4;
        }
        this.baseWindSpeed += (this.targetWindSpeed - this.baseWindSpeed) * deltaTime * 0.5;

        if (Math.random() < 0.3 * deltaTime) {
            this.impulses.push({
                startTime: this.time,
                duration: 0.3 + Math.random() * 0.5,
                peakAmplitude: 1.2 + Math.random() * 2.5,
                position: Math.random() * this.canvasWidth,
                width: 100 + Math.random() * 200
            });
        }

        this.impulses = this.impulses.filter(imp =>
            this.time < imp.startTime + imp.duration + 2
        );
    }

    sample(x: number): number {
        let windForce = 0;

        for (const wave of this.waves) {
            const phase = (x * wave.spatialFrequency) - (this.time * wave.speed * 0.01 * this.direction) + wave.phase;
            windForce += Math.sin(phase) * wave.amplitude;
        }

        for (const imp of this.impulses) {
            const elapsed = this.time - imp.startTime;
            if (elapsed < 0) continue;

            const travelDistance = elapsed * 150 * this.direction;
            const impulseCenter = imp.position + travelDistance;

            const dist = Math.abs(x - impulseCenter);
            if (dist < imp.width) {
                const spatialFalloff = 1 - (dist / imp.width);
                let temporalEnvelope: number;
                if (elapsed < imp.duration * 0.3) {
                    temporalEnvelope = elapsed / (imp.duration * 0.3);
                } else if (elapsed < imp.duration) {
                    temporalEnvelope = 1;
                } else {
                    const decay = (elapsed - imp.duration) / 2;
                    temporalEnvelope = Math.exp(-decay * 2);
                }
                windForce += imp.peakAmplitude * spatialFalloff * temporalEnvelope;
            }
        }

        return windForce * this.baseWindSpeed;
    }
}

export interface SeatInfo {
    index: number;
    x: number;
    y: number;
    occupied: boolean;
}

export class CarpetRenderer {
    private carpetStates: Map<number, CarpetState> = new Map();
    private windField: WindField;
    private canvasWidth: number;
    private canvasHeight: number;

    private carpetGroup: SVGGElement;
    private carpetElements: SVGGElement[] = [];

    private readonly CARPET_OCCUPIED_DROP = 35;
    private readonly CARPET_FLY_DURATION = 0.8;
    private readonly CARPET_DAMPING = 0.92;
    private readonly CARPET_SPRING_STRENGTH = 15;
    private readonly CARPET_MAX_DISPLACEMENT = 12;

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

    private createCarpetVertices(): CarpetVertex[] {
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

    update(seats: SeatInfo[], deltaTime: number): void {
        this.windField.update(deltaTime);

        const currentSeatIndices = new Set(seats.map(s => s.index));

        for (const [seatIndex, carpet] of this.carpetStates) {
            if (!currentSeatIndices.has(seatIndex) && !carpet.exiting) {
                carpet.exiting = true;
                carpet.exitProgress = 0;
            }
        }

        for (const seat of seats) {
            if (!this.carpetStates.has(seat.index)) {
                const entryAngle = Math.random() * Math.PI * 2;
                const entryDistance = Math.max(this.canvasWidth, this.canvasHeight);
                this.carpetStates.set(seat.index, {
                    seatIndex: seat.index,
                    currentX: seat.x + Math.cos(entryAngle) * entryDistance,
                    currentY: seat.y + Math.sin(entryAngle) * entryDistance,
                    targetX: seat.x,
                    targetY: seat.y,
                    isOccupied: false,
                    occupiedOffset: 0,
                    entering: true,
                    exiting: false,
                    exitProgress: 0,
                    entryProgress: 0,
                    entryStartX: seat.x + Math.cos(entryAngle) * entryDistance,
                    entryStartY: seat.y + Math.sin(entryAngle) * entryDistance,
                    vertices: this.createCarpetVertices()
                });
            }
        }

        const occupiedIndices = new Set(seats.filter(s => s.occupied).map(s => s.index));

        for (const [seatIndex, carpet] of this.carpetStates) {
            if (carpet.exiting) {
                carpet.exitProgress += deltaTime / this.CARPET_FLY_DURATION;
                if (carpet.exitProgress >= 1) {
                    this.carpetStates.delete(seatIndex);
                    continue;
                }
                const eased = this.easeInOutCubic(carpet.exitProgress);
                const exitAngle = Math.atan2(carpet.currentY - this.canvasHeight / 2, carpet.currentX - this.canvasWidth / 2);
                const exitDistance = Math.max(this.canvasWidth, this.canvasHeight);
                carpet.currentX = carpet.targetX + Math.cos(exitAngle) * exitDistance * eased;
                carpet.currentY = carpet.targetY + Math.sin(exitAngle) * exitDistance * eased;
                continue;
            }

            const seat = seats.find(s => s.index === seatIndex);
            if (carpet.entering) {
                carpet.entryProgress += deltaTime / this.CARPET_FLY_DURATION;
                if (carpet.entryProgress >= 1) {
                    carpet.entering = false;
                    carpet.currentX = carpet.targetX;
                    carpet.currentY = carpet.targetY;
                } else {
                    const eased = this.easeInOutCubic(carpet.entryProgress);
                    carpet.currentX = carpet.entryStartX + (carpet.targetX - carpet.entryStartX) * eased;
                    carpet.currentY = carpet.entryStartY + (carpet.targetY - carpet.entryStartY) * eased;
                }
            } else if (seat) {
                carpet.targetX = seat.x;
                carpet.targetY = seat.y;

                const smoothing = 5;
                const factor = 1 - Math.exp(-smoothing * deltaTime);
                carpet.currentX += (carpet.targetX - carpet.currentX) * factor;
                carpet.currentY += (carpet.targetY - carpet.currentY) * factor;
            }

            const isNowOccupied = occupiedIndices.has(seatIndex);
            carpet.isOccupied = isNowOccupied;

            const targetOffset = isNowOccupied ? this.CARPET_OCCUPIED_DROP : 0;
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
                vertex.yOffset = Math.max(-this.CARPET_MAX_DISPLACEMENT,
                    Math.min(this.CARPET_MAX_DISPLACEMENT, vertex.yOffset));
            }
        }
    }

    render(): void {
        const carpetData = this.getRenderData();

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
            carpet.setAttribute('transform', `translate(${data.x}, ${data.y})`);
            carpet.setAttribute('opacity', String(data.opacity));

            this.updateCarpetPath(carpet, data.vertices);
        }
    }

    private getRenderData(): Array<{
        x: number;
        y: number;
        opacity: number;
        vertices: Array<{ x: number; y: number }>;
    }> {
        const carpets: Array<{
            x: number;
            y: number;
            opacity: number;
            vertices: Array<{ x: number; y: number }>;
        }> = [];

        for (const carpet of this.carpetStates.values()) {
            let opacity = 1;
            if (carpet.entering) {
                opacity = this.easeInOutCubic(carpet.entryProgress);
            } else if (carpet.exiting) {
                opacity = 1 - this.easeInOutCubic(carpet.exitProgress);
            }

            const vertices = carpet.vertices.map(v => ({
                x: v.baseX,
                y: v.yOffset
            }));

            carpets.push({
                x: carpet.currentX,
                y: carpet.currentY + carpet.occupiedOffset,
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
        this.carpetStates.clear();
    }
}
