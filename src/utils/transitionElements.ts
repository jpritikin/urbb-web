export class TransitionElements {
    private clipPathGroup: SVGClipPathElement;
    private firstElement: SVGPolygonElement | null = null;
    private secondElement: SVGPolygonElement | null = null;

    constructor(clipPathGroup: SVGClipPathElement) {
        this.clipPathGroup = clipPathGroup;
    }

    createFirst(): void {
        this.removeFirst();
        this.firstElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        this.clipPathGroup.appendChild(this.firstElement);
    }

    createSecond(): void {
        this.removeSecond();
        this.secondElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        this.clipPathGroup.appendChild(this.secondElement);
    }

    removeFirst(): void {
        this.firstElement?.remove();
        this.firstElement = null;
    }

    removeSecond(): void {
        this.secondElement?.remove();
        this.secondElement = null;
    }

    removeAll(): void {
        this.removeFirst();
        this.removeSecond();
    }

    getFirst(): SVGPolygonElement | null {
        return this.firstElement;
    }

    getSecond(): SVGPolygonElement | null {
        return this.secondElement;
    }
}
