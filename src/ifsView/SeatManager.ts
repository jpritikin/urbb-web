import { SimulatorModel } from '../ifsModel.js';
import { CarpetState, SeatInfo, createCarpetVertices, CARPET_START_SCALE, CARPET_ENTRY_STAGGER, CARPET_OFFSCREEN_DISTANCE } from '../carpetRenderer.js';

export const CARPET_MAX_VELOCITY = 20;
export const UPDATE_INTERVAL = 100;
export const STAR_CLOUD_ID = '*';
export const UNBLENDED_SEAT_ID = '__unblended__';

const SEAT_REARRANGEMENT_SPEED = 0.04;

function getOffscreenPosition(fromX: number, fromY: number, canvasWidth: number, canvasHeight: number): { x: number; y: number } {
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const dx = fromX - centerX;
    const dy = fromY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) {
        return { x: centerX, y: centerY - CARPET_OFFSCREEN_DISTANCE };
    }
    const dirX = dx / dist;
    const dirY = dy / dist;
    return {
        x: centerX + dirX * CARPET_OFFSCREEN_DISTANCE,
        y: centerY + dirY * CARPET_OFFSCREEN_DISTANCE
    };
}

interface SeatState {
    seatId: string;
    angle: number;
    targetAngle: number;
    x: number;
    y: number;
}

interface CarpetVelocity {
    vx: number;
    vy: number;
}

export class SeatManager {
    private canvasWidth: number;
    private canvasHeight: number;

    private seats: SeatState[] = [];
    private conferencePhaseShift: number;
    private conferenceRotationSpeed: number = 0.05;
    private currentRadiusScale: number = 0.6;
    private targetRadiusScale: number = 0.6;

    private carpets: Map<string, CarpetState> = new Map();
    private carpetVelocities: Map<string, CarpetVelocity> = new Map();
    private lastUpdateTime: number = 0;
    private draggingCarpetId: string | null = null;
    private dragOffsetX: number = 0;
    private dragOffsetY: number = 0;
    private previousMatching: Map<string, string> = new Map();
    private debugGroup: SVGGElement | null = null;

    constructor(canvasWidth: number, canvasHeight: number, initialPhase: number = Math.random() * Math.PI * 2) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.conferencePhaseShift = initialPhase;
    }

    setDebugGroup(group: SVGGElement | null): void {
        this.debugGroup = group;
        if (group) {
            this.setupDragHandlers(group);
        }
    }

    private setupDragHandlers(group: SVGGElement): void {
        const svg = group.ownerSVGElement;
        if (!svg) return;

        const getEventPos = (e: MouseEvent | TouchEvent): { x: number; y: number } => {
            const rect = svg.getBoundingClientRect();
            const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
            const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
            const scaleX = svg.viewBox.baseVal.width / rect.width;
            const scaleY = svg.viewBox.baseVal.height / rect.height;
            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY
            };
        };

        const onStart = (e: MouseEvent | TouchEvent) => {
            const target = e.target as SVGElement;
            const carpetId = target.dataset?.carpetId;
            if (carpetId && this.carpets.has(carpetId)) {
                this.draggingCarpetId = carpetId;
                e.preventDefault();
                e.stopPropagation();
            }
        };

        const onMove = (e: MouseEvent | TouchEvent) => {
            if (!this.draggingCarpetId) return;
            const pos = getEventPos(e);
            const carpet = this.carpets.get(this.draggingCarpetId);
            if (carpet) {
                carpet.currentX = pos.x;
                carpet.currentY = pos.y;
            }
            e.preventDefault();
        };

        const onEnd = () => {
            this.draggingCarpetId = null;
        };

        group.addEventListener('mousedown', onStart);
        svg.addEventListener('mousemove', onMove);
        svg.addEventListener('mouseup', onEnd);
        svg.addEventListener('mouseleave', onEnd);
        group.addEventListener('touchstart', onStart, { passive: false });
        svg.addEventListener('touchmove', onMove, { passive: false });
        svg.addEventListener('touchend', onEnd);
    }

    private getTargetRadiusScale(seatCount: number): number {
        if (seatCount <= 2) return 0.6;
        if (seatCount >= 7) return 1;
        return 0.6 + 0.4 * (seatCount - 2) / 5;
    }

    getConferenceTableRadii(seatCount?: number): { rx: number; ry: number } {
        const baseRx = this.canvasWidth * 0.35;
        const baseRy = this.canvasHeight * 0.35;
        return { rx: baseRx * this.currentRadiusScale, ry: baseRy * this.currentRadiusScale };
    }

    getConferenceTableRadius(seatCount?: number): number {
        const { rx, ry } = this.getConferenceTableRadii(seatCount);
        return Math.min(rx, ry);
    }

    getSeats(): SeatInfo[] {
        return this.seats.map(s => ({
            seatId: s.seatId,
            angle: s.angle,
            targetAngle: s.targetAngle,
            x: s.x,
            y: s.y
        }));
    }

    getSeatPosition(seatId: string): { x: number; y: number } | undefined {
        const seat = this.seats.find(s => s.seatId === seatId);
        return seat ? { x: seat.x, y: seat.y } : undefined;
    }

    getCloudPosition(cloudId: string): { x: number; y: number } | undefined {
        const carpet = this.carpets.get(cloudId);
        if (carpet && !carpet.entering && !carpet.exiting) {
            return { x: carpet.currentX, y: carpet.currentY };
        }
        return this.getSeatPosition(cloudId);
    }

    getStarPosition(): { x: number; y: number } {
        return this.getSeatPosition(STAR_CLOUD_ID) ?? { x: this.canvasWidth / 2, y: this.canvasHeight / 2 };
    }

    getUnblendedSeatPosition(): { x: number; y: number } | undefined {
        return this.getSeatPosition(UNBLENDED_SEAT_ID);
    }

    isSeated(cloudId: string): boolean {
        return this.carpets.has(cloudId);
    }

    getCarpets(): Map<string, CarpetState> {
        return this.carpets;
    }

    setCarpetPosition(carpetId: string, x: number, y: number): void {
        const carpet = this.carpets.get(carpetId);
        if (!carpet || carpet.entering || carpet.exiting) {
            this.draggingCarpetId = null;
            return;
        }
        if (this.draggingCarpetId !== carpetId) {
            this.dragOffsetX = carpet.currentX - x;
            this.dragOffsetY = carpet.currentY - y;
            this.draggingCarpetId = carpetId;
        }
        carpet.currentX = x + this.dragOffsetX;
        carpet.currentY = y + this.dragOffsetY;
    }

    clearDragging(): void {
        this.draggingCarpetId = null;
    }

    reassignUnblendedCarpet(newSeatId: string): void {
        const carpet = this.carpets.get(UNBLENDED_SEAT_ID);
        if (carpet) {
            this.carpets.delete(UNBLENDED_SEAT_ID);
            this.carpets.set(newSeatId, carpet);
            const velocity = this.carpetVelocities.get(UNBLENDED_SEAT_ID);
            if (velocity) {
                this.carpetVelocities.delete(UNBLENDED_SEAT_ID);
                this.carpetVelocities.set(newSeatId, velocity);
            }
        }
    }

    private reassignCarpetToUnblended(oldSeatId: string): void {
        const carpet = this.carpets.get(oldSeatId);
        if (carpet) {
            this.carpets.delete(oldSeatId);
            this.carpets.set(UNBLENDED_SEAT_ID, carpet);
            const velocity = this.carpetVelocities.get(oldSeatId);
            if (velocity) {
                this.carpetVelocities.delete(oldSeatId);
                this.carpetVelocities.set(UNBLENDED_SEAT_ID, velocity);
            }
        }
    }

    updateSeatAssignments(oldModel: SimulatorModel | null, newModel: SimulatorModel): void {
        const targetIds = Array.from(newModel.getTargetCloudIds());
        const blendedIds = newModel.getBlendedParts();
        const hasBlendedParts = blendedIds.length > 0;

        if (oldModel) {
            const oldBlended = new Set(oldModel.getBlendedParts());
            const oldTargets = new Set(Array.from(oldModel.getTargetCloudIds()));
            const newTargets = newModel.getTargetCloudIds();
            const newBlended = new Set(blendedIds);

            for (const targetId of newTargets) {
                if (oldBlended.has(targetId) && !oldTargets.has(targetId)) {
                    this.reassignUnblendedCarpet(targetId);
                }
            }

            for (const blendedId of newBlended) {
                if (oldTargets.has(blendedId) && !oldBlended.has(blendedId)) {
                    this.reassignCarpetToUnblended(blendedId);
                }
            }
        }

        const seatIds = [STAR_CLOUD_ID, ...targetIds];
        if (hasBlendedParts) {
            seatIds.push(UNBLENDED_SEAT_ID);
        }

        const previousCarpetIds = new Set(this.carpets.keys());
        const newSeatIds = new Set(seatIds);

        for (const carpetId of previousCarpetIds) {
            if (!newSeatIds.has(carpetId)) {
                this.markCarpetForExit(carpetId);
            }
        }

        this.setSeats(seatIds);

        let enteringCount = this.getEnteringCarpetCount();
        for (const seatId of seatIds) {
            if (seatId !== STAR_CLOUD_ID && !previousCarpetIds.has(seatId) && !this.carpets.has(seatId)) {
                this.createCarpet(seatId, seatIds.length, enteringCount);
                enteringCount++;
            }
        }
    }

    private setSeats(seatIds: string[]): void {
        const totalSeats = seatIds.length;
        const angleStep = (2 * Math.PI) / totalSeats;

        const targetAngles: number[] = [];
        for (let i = 0; i < totalSeats; i++) {
            targetAngles.push(this.conferencePhaseShift + angleStep * i);
        }

        const existingSeats = new Map(this.seats.map(s => [s.seatId, s]));
        const newSeats: SeatState[] = [];
        const usedAngles = new Set<number>();

        const existingSeatIds = seatIds.filter(id => existingSeats.has(id));
        const distances: { seatId: string; angleIndex: number; distance: number }[] = [];

        for (const seatId of existingSeatIds) {
            const seat = existingSeats.get(seatId)!;
            for (let i = 0; i < targetAngles.length; i++) {
                const diff = Math.atan2(
                    Math.sin(targetAngles[i] - seat.angle),
                    Math.cos(targetAngles[i] - seat.angle)
                );
                distances.push({ seatId, angleIndex: i, distance: Math.abs(diff) });
            }
        }

        distances.sort((a, b) => a.distance - b.distance);
        const assignedSeats = new Set<string>();

        for (const { seatId, angleIndex } of distances) {
            if (assignedSeats.has(seatId) || usedAngles.has(angleIndex)) continue;
            assignedSeats.add(seatId);
            usedAngles.add(angleIndex);

            const oldSeat = existingSeats.get(seatId)!;
            newSeats.push({
                seatId,
                angle: oldSeat.angle,
                targetAngle: targetAngles[angleIndex],
                x: oldSeat.x,
                y: oldSeat.y
            });
        }

        const newSeatIds = seatIds.filter(id => !existingSeats.has(id));
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const { rx, ry } = this.getConferenceTableRadii();

        for (const seatId of newSeatIds) {
            let bestAngleIndex = -1;
            for (let i = 0; i < targetAngles.length; i++) {
                if (!usedAngles.has(i)) {
                    bestAngleIndex = i;
                    break;
                }
            }
            if (bestAngleIndex === -1) continue;

            usedAngles.add(bestAngleIndex);
            const angle = this.findLargestGap(newSeats);
            newSeats.push({
                seatId,
                angle,
                targetAngle: targetAngles[bestAngleIndex],
                x: centerX + rx * Math.cos(angle),
                y: centerY + ry * Math.sin(angle)
            });
        }

        this.seats = newSeats;
    }

    private findLargestGap(seats: SeatState[]): number {
        if (seats.length === 0) return this.conferencePhaseShift;

        const sorted = [...seats].sort((a, b) => a.angle - b.angle);
        let largestGap = 0;
        let bestAngle = this.conferencePhaseShift;

        for (let i = 0; i < sorted.length; i++) {
            const current = sorted[i].angle;
            const next = sorted[(i + 1) % sorted.length].angle;
            const gap = next > current ? next - current : (2 * Math.PI - current) + next;

            if (gap > largestGap) {
                largestGap = gap;
                bestAngle = current + gap / 2;
                if (bestAngle >= 2 * Math.PI) bestAngle -= 2 * Math.PI;
            }
        }

        return bestAngle;
    }

    private getEnteringCarpetCount(): number {
        let count = 0;
        for (const carpet of this.carpets.values()) {
            if (carpet.entering && !carpet.exiting) count++;
        }
        return count;
    }

    private createCarpet(seatId: string, totalSeats: number, enteringCount: number): void {
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const startPos = getOffscreenPosition(centerX, centerY, this.canvasWidth, this.canvasHeight);

        this.carpets.set(seatId, {
            currentX: startPos.x,
            currentY: startPos.y,
            targetX: centerX,
            targetY: centerY,
            startX: startPos.x,
            startY: startPos.y,
            currentScale: CARPET_START_SCALE,
            isOccupied: false,
            occupiedOffset: 0,
            entering: true,
            exiting: false,
            progress: -enteringCount * CARPET_ENTRY_STAGGER,
            vertices: createCarpetVertices()
        });
        this.carpetVelocities.set(seatId, { vx: 0, vy: 0 });
    }

    private markCarpetForExit(seatId: string): void {
        const carpet = this.carpets.get(seatId);
        if (carpet && !carpet.exiting) {
            if (this.draggingCarpetId === seatId) {
                this.draggingCarpetId = null;
            }
            const exitPos = getOffscreenPosition(carpet.currentX, carpet.currentY, this.canvasWidth, this.canvasHeight);
            carpet.exiting = true;
            carpet.entering = false;
            carpet.progress = 0;
            carpet.targetX = carpet.currentX;
            carpet.targetY = carpet.currentY;
            carpet.startX = exitPos.x;
            carpet.startY = exitPos.y;
        }
    }

    private computeOptimalMatching(): Map<string, { x: number; y: number }> {
        const REASSIGNMENT_THRESHOLD = 20;

        const activeCarpetIds: string[] = [];
        for (const [id, carpet] of this.carpets) {
            if (!carpet.entering && !carpet.exiting) {
                activeCarpetIds.push(id);
            }
        }

        const nonStarSeats = this.seats.filter(s => s.seatId !== STAR_CLOUD_ID);
        const matching = new Map<string, { x: number; y: number }>();
        const newMatching = new Map<string, string>();

        if (activeCarpetIds.length === 0 || nonStarSeats.length === 0) {
            this.previousMatching.clear();
            return matching;
        }

        const seatById = new Map(nonStarSeats.map(s => [s.seatId, s]));
        const remainingCarpets = new Set(activeCarpetIds);
        const remainingSeats = new Set(nonStarSeats);

        for (const carpetId of activeCarpetIds) {
            const prevSeatId = this.previousMatching.get(carpetId);
            if (!prevSeatId) continue;

            const prevSeat = seatById.get(prevSeatId);
            if (!prevSeat || !remainingSeats.has(prevSeat)) continue;

            const carpet = this.carpets.get(carpetId)!;
            const prevDx = prevSeat.x - carpet.currentX;
            const prevDy = prevSeat.y - carpet.currentY;
            const prevDist = Math.sqrt(prevDx * prevDx + prevDy * prevDy);

            let shouldKeep = true;
            for (const seat of remainingSeats) {
                if (seat.seatId === prevSeatId) continue;
                const dx = seat.x - carpet.currentX;
                const dy = seat.y - carpet.currentY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist + REASSIGNMENT_THRESHOLD < prevDist) {
                    shouldKeep = false;
                    break;
                }
            }

            if (shouldKeep) {
                matching.set(carpetId, { x: prevSeat.x, y: prevSeat.y });
                newMatching.set(carpetId, prevSeatId);
                remainingCarpets.delete(carpetId);
                remainingSeats.delete(prevSeat);
            }
        }

        while (remainingCarpets.size > 0 && remainingSeats.size > 0) {
            let bestCarpetId: string | null = null;
            let bestSeat: SeatState | null = null;
            let bestDist = Infinity;

            for (const carpetId of remainingCarpets) {
                const carpet = this.carpets.get(carpetId)!;
                for (const seat of remainingSeats) {
                    const dx = seat.x - carpet.currentX;
                    const dy = seat.y - carpet.currentY;
                    const dist = dx * dx + dy * dy;
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestCarpetId = carpetId;
                        bestSeat = seat;
                    }
                }
            }

            if (bestCarpetId && bestSeat) {
                matching.set(bestCarpetId, { x: bestSeat.x, y: bestSeat.y });
                newMatching.set(bestCarpetId, bestSeat.seatId);
                remainingCarpets.delete(bestCarpetId);
                remainingSeats.delete(bestSeat);
            } else {
                break;
            }
        }

        this.previousMatching = newMatching;
        return matching;
    }

    private updateCarpetPositions(deltaTime: number): void {
        const matching = this.computeOptimalMatching();

        for (const [carpetId, carpet] of this.carpets) {
            if (carpet.entering || carpet.exiting) continue;

            const targetPos = matching.get(carpetId);
            if (!targetPos) continue;

            carpet.targetX = targetPos.x;
            carpet.targetY = targetPos.y;

            if (carpetId === this.draggingCarpetId) continue;

            const centerX = this.canvasWidth / 2;
            const centerY = this.canvasHeight / 2;

            const curDx = carpet.currentX - centerX;
            const curDy = carpet.currentY - centerY;
            const curRadius = Math.sqrt(curDx * curDx + curDy * curDy);
            const curAngle = Math.atan2(curDy, curDx);

            const tgtDx = targetPos.x - centerX;
            const tgtDy = targetPos.y - centerY;
            const tgtRadius = Math.sqrt(tgtDx * tgtDx + tgtDy * tgtDy);
            const tgtAngle = Math.atan2(tgtDy, tgtDx);

            const radiusDiff = tgtRadius - curRadius;
            let angleDiff = tgtAngle - curAngle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

            const radiusError = Math.abs(radiusDiff);
            const arcError = Math.abs(angleDiff) * curRadius;

            if (radiusError < 1 && arcError < 1) {
                carpet.currentX = targetPos.x;
                carpet.currentY = targetPos.y;
                this.carpetVelocities.set(carpetId, { vx: 0, vy: 0 });
                continue;
            }

            const moveAmount = CARPET_MAX_VELOCITY * deltaTime;

            const radialWeight = Math.min(1, radiusError / 30);
            const angularWeight = 1 - radialWeight;

            const radialDir = radiusDiff > 0 ? 1 : -1;
            const radialMove = Math.min(Math.abs(radiusDiff), moveAmount * radialWeight) * radialDir;

            const angularDir = angleDiff > 0 ? 1 : -1;
            const maxAngularMove = moveAmount * angularWeight;
            const angularMove = Math.min(Math.abs(angleDiff) * curRadius, maxAngularMove) * angularDir / Math.max(1, curRadius);

            const newRadius = curRadius + radialMove;
            const newAngle = curAngle + angularMove;

            carpet.currentX = centerX + Math.cos(newAngle) * newRadius;
            carpet.currentY = centerY + Math.sin(newAngle) * newRadius;

            const dx = carpet.currentX - (centerX + Math.cos(curAngle) * curRadius);
            const dy = carpet.currentY - (centerY + Math.sin(curAngle) * curRadius);
            this.carpetVelocities.set(carpetId, { vx: dx / deltaTime, vy: dy / deltaTime });
        }
    }

    private animateSeats(deltaTime: number): void {
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const { rx, ry } = this.getConferenceTableRadii(this.seats.length);

        for (const seat of this.seats) {
            const angleDiff = seat.targetAngle - seat.angle;
            const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));

            if (Math.abs(normalizedDiff) > 0.001) {
                const maxMove = SEAT_REARRANGEMENT_SPEED * deltaTime;
                const move = Math.sign(normalizedDiff) * Math.min(Math.abs(normalizedDiff), maxMove);
                seat.angle += move;

                if (seat.angle < 0) seat.angle += 2 * Math.PI;
                if (seat.angle >= 2 * Math.PI) seat.angle -= 2 * Math.PI;
            }

            seat.x = centerX + rx * Math.cos(seat.angle);
            seat.y = centerY + ry * Math.sin(seat.angle);
        }
    }

    animate(deltaTime: number, mode: 'panorama' | 'foreground'): void {
        if (mode === 'foreground') {
            const phaseChange = this.conferenceRotationSpeed * deltaTime;
            this.conferencePhaseShift += phaseChange;

            const radiusDiff = this.targetRadiusScale - this.currentRadiusScale;
            if (Math.abs(radiusDiff) > 0.001) {
                const maxRadiusMove = SEAT_REARRANGEMENT_SPEED * deltaTime;
                const radiusMove = Math.sign(radiusDiff) * Math.min(Math.abs(radiusDiff), maxRadiusMove);
                this.currentRadiusScale += radiusMove;
            }

            for (const seat of this.seats) {
                seat.angle += phaseChange;
                seat.targetAngle += phaseChange;
                if (seat.angle >= 2 * Math.PI) seat.angle -= 2 * Math.PI;
                if (seat.targetAngle >= 2 * Math.PI) seat.targetAngle -= 2 * Math.PI;
            }

            this.animateSeats(deltaTime);
        }

        const now = performance.now();
        if (now - this.lastUpdateTime >= UPDATE_INTERVAL) {
            this.lastUpdateTime = now;
            const throttledDelta = UPDATE_INTERVAL / 1000;
            this.updateCarpetPositions(throttledDelta);
        }
    }

    setConferenceRotationPaused(paused: boolean): void {
        this.conferenceRotationSpeed = paused ? 0 : 0.05;
    }

    setDimensions(width: number, height: number): void {
        this.canvasWidth = width;
        this.canvasHeight = height;
    }
}
