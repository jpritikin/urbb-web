import { SimulatorModel } from '../ifsModel.js';
import { CarpetState, SeatInfo, createCarpetVertices, CARPET_START_SCALE, CARPET_ENTRY_STAGGER, CARPET_OFFSCREEN_DISTANCE } from '../carpetRenderer.js';

const SEAT_REARRANGEMENT_SPEED = 0.001;
const STAR_CLOUD_ID = '*';
const UNBLENDED_SEAT_ID = '__unblended__';

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

export class SeatManager {
    private canvasWidth: number;
    private canvasHeight: number;

    private seats: SeatInfo[] = [];
    private hasBlendedParts: boolean = false;
    private carpets: Map<string, CarpetState> = new Map();
    private conferencePhaseShift: number = Math.random() * Math.PI * 2;
    private conferenceRotationSpeed: number = 0.05;

    constructor(canvasWidth: number, canvasHeight: number) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
    }

    getConferenceTableRadii(seatCount?: number): { rx: number; ry: number } {
        const count = seatCount ?? this.seats.length;
        const baseRx = this.canvasWidth * 0.35;
        const baseRy = this.canvasHeight * 0.35;
        let scale: number;
        if (count <= 2) scale = 0.6;
        else if (count >= 7) scale = 1;
        else scale = 0.6 + 0.4 * (count - 2) / 5;
        return { rx: baseRx * scale, ry: baseRy * scale };
    }

    getConferenceTableRadius(seatCount?: number): number {
        const { rx, ry } = this.getConferenceTableRadii(seatCount);
        return Math.min(rx, ry);
    }

    getCloudPosition(cloudId: string): { x: number; y: number } | undefined {
        const seat = this.seats.find(s => s.seatId === cloudId);
        return seat ? { x: seat.x, y: seat.y } : undefined;
    }

    getStarPosition(): { x: number; y: number } {
        return this.getCloudPosition(STAR_CLOUD_ID) ?? { x: this.canvasWidth / 2, y: this.canvasHeight / 2 };
    }

    getUnblendedSeatPosition(): { x: number; y: number } | undefined {
        return this.getCloudPosition(UNBLENDED_SEAT_ID);
    }

    isSeated(cloudId: string): boolean {
        return this.seats.some(s => s.seatId === cloudId);
    }

    getCarpets(): Map<string, CarpetState> {
        return this.carpets;
    }

    getSeats(): SeatInfo[] {
        return this.seats;
    }

    reassignUnblendedCarpet(newSeatId: string): void {
        const carpet = this.carpets.get(UNBLENDED_SEAT_ID);
        if (carpet) {
            this.carpets.delete(UNBLENDED_SEAT_ID);
            this.carpets.set(newSeatId, carpet);
        }
    }

    private reassignCarpetToUnblended(oldSeatId: string): void {
        const carpet = this.carpets.get(oldSeatId);
        if (carpet) {
            this.carpets.delete(oldSeatId);
            this.carpets.set(UNBLENDED_SEAT_ID, carpet);
        }
    }

    updateSeatAssignments(oldModel: SimulatorModel | null, newModel: SimulatorModel): void {
        const targetIds = Array.from(newModel.getTargetCloudIds());
        const blendedIds = newModel.getBlendedParts();
        this.hasBlendedParts = blendedIds.length > 0;

        if (oldModel) {
            const oldBlended = new Set(oldModel.getBlendedParts());
            const oldTargets = new Set(Array.from(oldModel.getTargetCloudIds()));
            const newTargets = newModel.getTargetCloudIds();
            const newBlended = new Set(blendedIds);

            // Detect promoted blended → target (unblending complete)
            for (const targetId of newTargets) {
                if (oldBlended.has(targetId) && !oldTargets.has(targetId)) {
                    this.reassignUnblendedCarpet(targetId);
                }
            }

            // Detect target → blended (blend action): reassign carpet to UNBLENDED_SEAT_ID
            for (const blendedId of newBlended) {
                if (oldTargets.has(blendedId) && !oldBlended.has(blendedId)) {
                    this.reassignCarpetToUnblended(blendedId);
                }
            }
        }

        // Seats: star, targets, and one shared unblended seat (if there are blended parts)
        const seatIds = [STAR_CLOUD_ID, ...targetIds];
        if (this.hasBlendedParts) {
            seatIds.push(UNBLENDED_SEAT_ID);
        }

        const previousSeatIds = new Set(this.seats.map(s => s.seatId));
        const newSeatIds = new Set(seatIds);

        // Mark removed carpets for exit
        for (const seat of this.seats) {
            if (!newSeatIds.has(seat.seatId)) {
                this.markCarpetForExit(seat.seatId);
            }
        }

        this.updateSeats(seatIds);

        // Create carpets for new non-star seats that don't already have one
        let enteringCount = this.getEnteringCarpetCount();
        for (const seatId of seatIds) {
            if (seatId !== STAR_CLOUD_ID && !previousSeatIds.has(seatId) && !this.carpets.has(seatId)) {
                this.createCarpet(seatId, seatIds.length, enteringCount);
                enteringCount++;
            }
        }
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
    }

    private markCarpetForExit(seatId: string): void {
        const carpet = this.carpets.get(seatId);
        if (carpet && !carpet.exiting) {
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

    private updateSeats(seatIds: string[]): void {
        const totalSeats = seatIds.length;
        const angleStep = (2 * Math.PI) / totalSeats;
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const { rx, ry } = this.getConferenceTableRadii(totalSeats);

        const targetAngles: number[] = [];
        for (let i = 0; i < totalSeats; i++) {
            targetAngles.push(this.conferencePhaseShift + angleStep * i);
        }

        const existingSeats = new Map(this.seats.map(s => [s.seatId, s]));
        const newSeats: SeatInfo[] = [];
        const usedAngles = new Set<number>();

        // First pass: assign existing seats to closest available target angle
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

        // Second pass: place new seats in largest gaps
        const newSeatIds = seatIds.filter(id => !existingSeats.has(id));
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

        // Animate seats toward target angles
        for (const seat of newSeats) {
            const angleDiff = seat.targetAngle - seat.angle;
            const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
            seat.angle += normalizedDiff * SEAT_REARRANGEMENT_SPEED;

            if (seat.angle < 0) seat.angle += 2 * Math.PI;
            if (seat.angle >= 2 * Math.PI) seat.angle -= 2 * Math.PI;

            seat.x = centerX + rx * Math.cos(seat.angle);
            seat.y = centerY + ry * Math.sin(seat.angle);
        }

        this.seats = newSeats;
    }

    private findLargestGap(seats: SeatInfo[]): number {
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

    animate(deltaTime: number, mode: 'panorama' | 'foreground'): void {
        if (mode === 'foreground') {
            this.conferencePhaseShift += this.conferenceRotationSpeed * deltaTime;
        }
    }

    isSeatCountAnimating(): boolean {
        return false;
    }

    isConferenceRotating(): boolean {
        return this.conferenceRotationSpeed !== 0;
    }

    setConferenceRotationPaused(paused: boolean): void {
        this.conferenceRotationSpeed = paused ? 0 : 0.05;
    }

    setDimensions(width: number, height: number): void {
        this.canvasWidth = width;
        this.canvasHeight = height;
    }
}
