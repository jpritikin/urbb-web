import { Point } from './geometry.js';

export interface LatticeNode {
    x: number;
    y: number;
    vx: number;
    vy: number;
    anchorX: number;
    anchorY: number;
    anchorStrength: number;
}

export interface TugTarget {
    offsetX: number;
    offsetY: number;
    active: boolean;
}

const GRID_COLS = 4;
const GRID_ROWS = 4;
const SPRING_STIFFNESS = 80;
const SPRING_DAMPING = 8;
const ANCHOR_STIFFNESS = 40;
const TUG_STRENGTH = 60;
const TUG_VARIATION_SPEED = 2;
const TUG_VARIATION_AMPLITUDE = 0.4;

export type AnchorSide = 'left' | 'right' | 'top' | 'bottom';

export class LatticeDeformation {
    private nodes: LatticeNode[] = [];
    private _width: number;
    private _height: number;

    get width(): number { return this._width; }
    get height(): number { return this._height; }
    private tugPhase: number = Math.random() * Math.PI * 2;
    private tugTarget: TugTarget = { offsetX: 0, offsetY: 0, active: false };
    private currentOffset: { x: number; y: number } = { x: 0, y: 0 };
    private anchorSide: AnchorSide = 'left';

    constructor(width: number, height: number) {
        this._width = width;
        this._height = height;
        this.initializeNodes();
    }

    private initializeNodes(): void {
        this.nodes = [];
        for (let row = 0; row < GRID_ROWS; row++) {
            for (let col = 0; col < GRID_COLS; col++) {
                const x = (col / (GRID_COLS - 1)) * this._width;
                const y = (row / (GRID_ROWS - 1)) * this._height;
                this.nodes.push({
                    x, y,
                    vx: 0, vy: 0,
                    anchorX: x,
                    anchorY: y,
                    anchorStrength: this.getAnchorStrength(row, col)
                });
            }
        }
    }

    private getAnchorCorner(): { row: number; col: number } {
        switch (this.anchorSide) {
            case 'left': return { row: Math.floor(GRID_ROWS / 2), col: 0 };
            case 'right': return { row: Math.floor(GRID_ROWS / 2), col: GRID_COLS - 1 };
            case 'top': return { row: 0, col: Math.floor(GRID_COLS / 2) };
            case 'bottom': return { row: GRID_ROWS - 1, col: Math.floor(GRID_COLS / 2) };
        }
    }

    private getAnchorStrength(row: number, col: number): number {
        const corner = this.getAnchorCorner();
        const rowDist = Math.abs(row - corner.row);
        const colDist = Math.abs(col - corner.col);
        const dist = Math.sqrt(rowDist * rowDist + colDist * colDist);

        if (dist === 0) return Infinity;
        if (dist <= 1.5) return 2.0;
        return 0.3;
    }

    private getEdgeInfo(row: number, col: number): { isAnchorEdge: boolean; isStretchEdge: boolean } {
        const isLeftEdge = col === 0;
        const isRightEdge = col === GRID_COLS - 1;
        const isTopEdge = row === 0;
        const isBottomEdge = row === GRID_ROWS - 1;

        let isStretchEdge = false;
        switch (this.anchorSide) {
            case 'left': isStretchEdge = isRightEdge; break;
            case 'right': isStretchEdge = isLeftEdge; break;
            case 'top': isStretchEdge = isBottomEdge; break;
            case 'bottom': isStretchEdge = isTopEdge; break;
        }

        const corner = this.getAnchorCorner();
        const isAnchorEdge = row === corner.row && col === corner.col;

        return { isAnchorEdge, isStretchEdge };
    }

    private updateNodeAnchorStrengths(): void {
        for (let i = 0; i < this.nodes.length; i++) {
            const col = i % GRID_COLS;
            const row = Math.floor(i / GRID_COLS);
            this.nodes[i].anchorStrength = this.getAnchorStrength(row, col);
        }
    }

    updateDimensions(width: number, height: number): void {
        const scaleX = width / this._width;
        const scaleY = height / this._height;
        this._width = width;
        this._height = height;

        for (const node of this.nodes) {
            node.x *= scaleX;
            node.y *= scaleY;
            node.anchorX *= scaleX;
            node.anchorY *= scaleY;
        }
    }

    setTugOffset(offsetX: number, offsetY: number, anchorSide: AnchorSide): void {
        this.tugTarget = { offsetX, offsetY, active: true };
        if (this.anchorSide !== anchorSide) {
            this.anchorSide = anchorSide;
            this.updateNodeAnchorStrengths();
        }
        this.applyDirectStretch();
    }

    setTugOffsetImmediate(offsetX: number, offsetY: number, anchorSide: AnchorSide): void {
        this.tugTarget = { offsetX, offsetY, active: true };
        this.currentOffset = { x: offsetX, y: offsetY };
        if (this.anchorSide !== anchorSide) {
            this.anchorSide = anchorSide;
            this.updateNodeAnchorStrengths();
        }
        this.applyDirectStretch();
    }

    private applyDirectStretch(): void {
        if (!this.tugTarget.active) return;

        const corner = this.getAnchorCorner();
        const maxDist = Math.sqrt(
            Math.pow(GRID_COLS - 1, 2) + Math.pow(GRID_ROWS - 1, 2)
        );

        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            const col = i % GRID_COLS;
            const row = Math.floor(i / GRID_COLS);

            // Distance from anchor corner determines stretch amount
            const rowDist = row - corner.row;
            const colDist = col - corner.col;
            const dist = Math.sqrt(rowDist * rowDist + colDist * colDist);

            // Normalize and apply quadratic falloff
            const linearT = dist / maxDist;
            const t = linearT * linearT;

            // Use interpolated current offset instead of target directly
            node.x = node.anchorX + this.currentOffset.x * t;
            node.y = node.anchorY + this.currentOffset.y * t;
            node.vx = 0;
            node.vy = 0;
        }
    }

    private interpolateOffset(deltaTime: number): void {
        if (!this.tugTarget.active) return;

        const smoothing = 8;
        const factor = 1 - Math.exp(-smoothing * deltaTime);

        this.currentOffset.x += (this.tugTarget.offsetX - this.currentOffset.x) * factor;
        this.currentOffset.y += (this.tugTarget.offsetY - this.currentOffset.y) * factor;
    }

    clearTugTarget(): void {
        this.tugTarget.active = false;
    }

    isTugging(): boolean {
        return this.tugTarget.active;
    }

    getCurrentOffset(): { x: number; y: number } {
        return { x: this.currentOffset.x, y: this.currentOffset.y };
    }

    animate(deltaTime: number): void {
        if (this.tugTarget.active) {
            this.interpolateOffset(deltaTime);
            this.applyDirectStretch();
            return;
        }

        this.tugPhase += TUG_VARIATION_SPEED * deltaTime;
        const corner = this.getAnchorCorner();

        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            const col = i % GRID_COLS;
            const row = Math.floor(i / GRID_COLS);

            // Check if this is the anchor corner point
            const isAnchorCorner = row === corner.row && col === corner.col;

            if (isAnchorCorner) {
                node.x = node.anchorX;
                node.y = node.anchorY;
                node.vx = 0;
                node.vy = 0;
                continue;
            }

            let fx = 0;
            let fy = 0;

            // Anchor spring force
            const anchorDx = node.anchorX - node.x;
            const anchorDy = node.anchorY - node.y;
            fx += anchorDx * ANCHOR_STIFFNESS * node.anchorStrength;
            fy += anchorDy * ANCHOR_STIFFNESS * node.anchorStrength;

            // Spring forces from neighbors
            const neighbors = this.getNeighborIndices(i);
            for (const ni of neighbors) {
                const neighbor = this.nodes[ni];
                const restLength = this.getRestLength(i, ni);
                const dx = neighbor.x - node.x;
                const dy = neighbor.y - node.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
                const displacement = dist - restLength;

                fx += (dx / dist) * displacement * SPRING_STIFFNESS;
                fy += (dy / dist) * displacement * SPRING_STIFFNESS;
            }

            fx -= node.vx * SPRING_DAMPING;
            fy -= node.vy * SPRING_DAMPING;

            node.vx += fx * deltaTime;
            node.vy += fy * deltaTime;
            node.x += node.vx * deltaTime;
            node.y += node.vy * deltaTime;
        }
    }

    private getNeighborIndices(index: number): number[] {
        const col = index % GRID_COLS;
        const row = Math.floor(index / GRID_COLS);
        const neighbors: number[] = [];

        if (col > 0) neighbors.push(index - 1);
        if (col < GRID_COLS - 1) neighbors.push(index + 1);
        if (row > 0) neighbors.push(index - GRID_COLS);
        if (row < GRID_ROWS - 1) neighbors.push(index + GRID_COLS);

        return neighbors;
    }

    private getRestLength(i: number, j: number): number {
        const col1 = i % GRID_COLS;
        const row1 = Math.floor(i / GRID_COLS);
        const col2 = j % GRID_COLS;
        const row2 = Math.floor(j / GRID_COLS);

        const x1 = (col1 / (GRID_COLS - 1)) * this.width;
        const y1 = (row1 / (GRID_ROWS - 1)) * this.height;
        const x2 = (col2 / (GRID_COLS - 1)) * this.width;
        const y2 = (row2 / (GRID_ROWS - 1)) * this.height;

        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }

    getDisplacement(localX: number, localY: number): Point {
        const u = Math.max(0, Math.min(1, localX / this._width));
        const v = Math.max(0, Math.min(1, localY / this._height));

        const gridU = u * (GRID_COLS - 1);
        const gridV = v * (GRID_ROWS - 1);
        const col = Math.max(0, Math.min(Math.floor(gridU), GRID_COLS - 2));
        const row = Math.max(0, Math.min(Math.floor(gridV), GRID_ROWS - 2));
        const lu = gridU - col;
        const lv = gridV - row;

        const i00 = row * GRID_COLS + col;
        const i10 = row * GRID_COLS + col + 1;
        const i01 = (row + 1) * GRID_COLS + col;
        const i11 = (row + 1) * GRID_COLS + col + 1;

        const n00 = this.nodes[i00];
        const n10 = this.nodes[i10];
        const n01 = this.nodes[i01];
        const n11 = this.nodes[i11];

        if (!n00 || !n10 || !n01 || !n11) {
            return new Point(0, 0);
        }

        // Calculate displacement from anchor position for each node
        const d00x = n00.x - n00.anchorX;
        const d00y = n00.y - n00.anchorY;
        const d10x = n10.x - n10.anchorX;
        const d10y = n10.y - n10.anchorY;
        const d01x = n01.x - n01.anchorX;
        const d01y = n01.y - n01.anchorY;
        const d11x = n11.x - n11.anchorX;
        const d11y = n11.y - n11.anchorY;

        const dx = (1 - lu) * (1 - lv) * d00x + lu * (1 - lv) * d10x +
            (1 - lu) * lv * d01x + lu * lv * d11x;
        const dy = (1 - lu) * (1 - lv) * d00y + lu * (1 - lv) * d10y +
            (1 - lu) * lv * d01y + lu * lv * d11y;

        return new Point(dx, dy);
    }

    transformPoint(localX: number, localY: number): Point {
        const displacement = this.getDisplacement(localX, localY);
        return new Point(localX + displacement.x, localY + displacement.y);
    }

    getDeformationMagnitude(): number {
        let maxDisp = 0;
        for (const node of this.nodes) {
            const dx = node.x - node.anchorX;
            const dy = node.y - node.anchorY;
            const disp = Math.sqrt(dx * dx + dy * dy);
            maxDisp = Math.max(maxDisp, disp);
        }
        return maxDisp;
    }

    reset(): void {
        for (const node of this.nodes) {
            node.x = node.anchorX;
            node.y = node.anchorY;
            node.vx = 0;
            node.vy = 0;
        }
        this.tugTarget.active = false;
    }
}
