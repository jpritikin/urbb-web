export class Point {
    constructor(public x: number, public y: number) { }

    add(other: Point): Point {
        return new Point(this.x + other.x, this.y + other.y);
    }

    sub(other: Point): Point {
        return new Point(this.x - other.x, this.y - other.y);
    }

    mul(scalar: number): Point {
        return new Point(this.x * scalar, this.y * scalar);
    }

    length(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    distanceTo(other: Point): number {
        const dx = other.x - this.x;
        const dy = other.y - this.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    normalize(): Point {
        const l = this.length();
        if (l > 0) {
            return new Point(this.x / l, this.y / l);
        }
        return new Point(1, 0);
    }

    perpendicular(): Point {
        return new Point(-this.y, this.x);
    }
}

export enum KnotType {
    SMOOTH = 'smooth',
    SYMMETRIC = 'symmetric',
    LINE = 'line'
}

export class Knot {
    constructor(public point: Point, public type: KnotType = KnotType.SMOOTH) { }
}
