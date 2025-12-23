const SVG_NS = 'http://www.w3.org/2000/svg';

export function createSvgElement<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, String(value));
    }
    return el;
}

export function createGroup(attrs: Record<string, string | number> = {}): SVGGElement {
    return createSvgElement('g', attrs);
}

export function createCircle(cx: number, cy: number, r: number, attrs: Record<string, string | number> = {}): SVGCircleElement {
    return createSvgElement('circle', { cx, cy, r, ...attrs });
}

export function createEllipse(cx: number, cy: number, rx: number, ry: number, attrs: Record<string, string | number> = {}): SVGEllipseElement {
    return createSvgElement('ellipse', { cx, cy, rx, ry, ...attrs });
}

export function createRect(x: number, y: number, width: number, height: number, attrs: Record<string, string | number> = {}): SVGRectElement {
    return createSvgElement('rect', { x, y, width, height, ...attrs });
}

export interface TextLine {
    text: string;
    fontSize?: number;
    fontStyle?: string;
}

export function createText(
    x: number,
    y: number,
    content: string | TextLine[],
    attrs: Record<string, string | number> = {}
): SVGTextElement {
    const text = createSvgElement('text', { x, y, ...attrs });

    if (typeof content === 'string') {
        text.textContent = content;
    } else {
        const lineHeight = 20;
        content.forEach((line, i) => {
            const tspan = createSvgElement('tspan', {
                x,
                y: y + i * lineHeight,
                ...(line.fontSize && { 'font-size': line.fontSize }),
                ...(line.fontStyle && { 'font-style': line.fontStyle }),
            });
            tspan.textContent = line.text;
            text.appendChild(tspan);
        });
    }

    return text;
}

export function createForeignObject(x: number, y: number, width: number, height: number): SVGForeignObjectElement {
    return createSvgElement('foreignObject', { x, y, width, height });
}

export function setClickHandler(el: SVGElement, handler: (e: MouseEvent) => void, stopPropagation = true): void {
    el.addEventListener('click', (e) => {
        if (stopPropagation) e.stopPropagation();
        handler(e as MouseEvent);
    });
    el.style.cursor = 'pointer';
}
