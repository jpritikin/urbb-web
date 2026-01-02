export class CoordinateConverter {
    private fieldSize: number;
    private centerX: number;
    private centerY: number;

    constructor(fieldSize: number, centerX: number, centerY: number) {
        this.fieldSize = fieldSize;
        this.centerX = centerX;
        this.centerY = centerY;
    }

    updateCenter(centerX: number, centerY: number): void {
        this.centerX = centerX;
        this.centerY = centerY;
    }

    toNormalized(absX: number, absY: number): { x: number; y: number } {
        const originX = this.centerX - this.fieldSize / 2;
        const originY = this.centerY - this.fieldSize / 2;
        return {
            x: (absX - originX) / this.fieldSize,
            y: (absY - originY) / this.fieldSize,
        };
    }

    getOrigin(): { x: number; y: number } {
        return {
            x: this.centerX - this.fieldSize / 2,
            y: this.centerY - this.fieldSize / 2,
        };
    }
}
