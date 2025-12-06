import { Cloud, CloudType } from './cloudShape.js';
import { Point } from './geometry.js';
import { NormalizedHarmonics } from './harmonics.js';

export { CloudType };

const FONT_SIZE = 12;
const STROKE_WIDTH = 0.8;

function generateCircleKnots(
    height: number,
    startAngle: number,
    endAngle: number,
    harmonics: NormalizedHarmonics,
    rotation: number = 0
): Point[] {
    const baseRadius = height / 2
    const MAX_ARC_LENGTH = height * 0.4;

    const totalAngle = Math.abs(endAngle - startAngle);
    const estimatedArcLength = baseRadius * totalAngle;
    const minKnots = 4;
    const knotCount = Math.max(minKnots, Math.ceil(estimatedArcLength / MAX_ARC_LENGTH));

    const knots: Point[] = [];
    const angleStep = (endAngle - startAngle) / (knotCount - 1);

    for (let i = 0; i < knotCount; i++) {
        const angle = startAngle + i * angleStep;
        const radius = harmonics.evaluate(angle, rotation);
        const x = radius * Math.cos(angle);
        const mathYCoord = radius * Math.sin(angle);
        const svgYCoord = -mathYCoord;
        knots.push(new Point(x, svgYCoord));
    }

    const maxSvgY = Math.max(...knots.map(k => k.y));
    for (const knot of knots) {
        knot.y -= maxSvgY;
    }

    return knots;
}

interface CloudInstance {
    cloud: Cloud;
    groupElement: SVGGElement;
    pathElement: SVGPathElement;
    textElement: SVGTextElement;
}

export class CloudRenderer {
    private debug: boolean = true;

    setDebug(enabled: boolean): void {
        this.debug = enabled;
    }

    createCloudElements(cloud: Cloud, svgElement: SVGSVGElement, onSelect: () => void): CloudInstance {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(${cloud.x}, ${cloud.y})`);
        g.style.cursor = 'pointer';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.style.strokeWidth = String(STROKE_WIDTH);
        path.style.pointerEvents = 'all';

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.style.fontFamily = 'sans-serif';
        text.style.fontSize = `${FONT_SIZE}px`;
        text.style.textAnchor = 'middle';
        text.style.fill = '#000000';
        text.style.fillOpacity = '1';
        text.style.pointerEvents = 'none';

        g.appendChild(path);
        g.appendChild(text);

        g.addEventListener('click', (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect();
        }, true);

        svgElement.appendChild(g);

        this.updateDebugStyles(path);
        this.renderText(cloud, text);
        const outlinePath = cloud.generateOutlinePath();
        path.setAttribute('d', outlinePath);

        return { cloud, groupElement: g, pathElement: path, textElement: text };
    }

    updateAnimation(instance: CloudInstance): void {
        const { cloud, groupElement, pathElement } = instance;

        const outlinePath = cloud.generateOutlinePath();
        pathElement.setAttribute('d', outlinePath);

        if (this.debug) {
            while (groupElement.childNodes.length > 2) {
                groupElement.removeChild(groupElement.lastChild!);
            }
            cloud.renderDebugInfo(groupElement);
        }
    }

    updateDebugStyles(pathElement: SVGPathElement): void {
        if (this.debug) {
            pathElement.style.fill = 'yellow';
            pathElement.style.stroke = 'red';
        } else {
            pathElement.style.fill = 'white';
            pathElement.style.stroke = '#000000';
            pathElement.style.strokeOpacity = '1';
            pathElement.style.strokeLinejoin = 'round';
        }
    }

    private renderText(cloud: Cloud, textElement: SVGTextElement): void {
        const textX = cloud.textLeft + cloud.textWidth / 2;
        const lines = cloud.text.split('\\n');
        const lineHeight = cloud.textAscent + cloud.textDescent;
        const totalTextHeight = lines.length * lineHeight;
        const centerSvgY = -cloud.minHeight / 2;
        const firstBaselineSvgY = centerSvgY - totalTextHeight / 2 + cloud.textAscent;

        textElement.setAttribute('x', String(textX));
        textElement.innerHTML = '';
        for (let j = 0; j < lines.length; j++) {
            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.setAttribute('x', String(textX));
            tspan.setAttribute('y', String(firstBaselineSvgY + j * lineHeight));
            tspan.textContent = lines[j];
            textElement.appendChild(tspan);
        }
    }

    remove(instance: CloudInstance, svgElement: SVGSVGElement): void {
        svgElement.removeChild(instance.groupElement);
    }
}

export class CloudManager {
    private instances: CloudInstance[] = [];
    private svgElement: SVGSVGElement | null = null;
    private container: HTMLElement | null = null;
    private renderer: CloudRenderer = new CloudRenderer();
    private zoom: number = 1;
    private canvasWidth: number = 800;
    private canvasHeight: number = 600;
    private panX: number = 0;
    private panY: number = 0;
    private animating: boolean = false;
    private animationFrameId: number | null = null;
    private lastFrameTime: number = 0;
    private selectedCloud: Cloud | null = null;
    private partitionCount: number = 10;
    private currentPartition: number = 0;

    init(containerId: string): void {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`Container ${containerId} not found`);
            return;
        }

        this.svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svgElement.setAttribute('width', String(this.canvasWidth));
        this.svgElement.setAttribute('height', String(this.canvasHeight));
        this.svgElement.setAttribute('viewBox', `0 0 ${this.canvasWidth} ${this.canvasHeight}`);
        this.svgElement.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        this.svgElement.style.border = '1px solid #ccc';
        this.svgElement.style.background = '#f0f0f0';

        this.container.appendChild(this.svgElement);
    }

    addCloud(word: string, x?: number, y?: number, cloudType?: CloudType): void {
        if (!this.svgElement) return;

        const cloudX = x ?? Math.random() * (this.canvasWidth - 200);
        const cloudY = y ?? this.canvasHeight / 2 + (Math.random() * 60 - 30);

        const cloud = new Cloud(word, cloudX, cloudY, cloudType);
        const instance = this.renderer.createCloudElements(
            cloud,
            this.svgElement,
            () => this.selectCloud(cloud)
        );
        this.instances.push(instance);
    }

    setDebug(enabled: boolean): void {
        this.renderer.setDebug(enabled);
        for (const instance of this.instances) {
            this.renderer.updateDebugStyles(instance.pathElement);
            if (enabled) {
                instance.cloud.renderDebugInfo(instance.groupElement);
            } else {
                while (instance.groupElement.childNodes.length > 2) {
                    instance.groupElement.removeChild(instance.groupElement.lastChild!);
                }
            }
        }
    }

    setZoom(zoomLevel: number): void {
        this.zoom = Math.max(0.1, Math.min(5, zoomLevel));
        this.updateViewBox();
    }

    centerOnPoint(x: number, y: number): void {
        this.panX = x;
        this.panY = y;
        this.updateViewBox();
    }

    private updateViewBox(): void {
        const scaledWidth = this.canvasWidth / this.zoom;
        const scaledHeight = this.canvasHeight / this.zoom;
        const viewBoxX = this.panX - scaledWidth / 2;
        const viewBoxY = this.panY - scaledHeight / 2;
        this.svgElement?.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${scaledWidth} ${scaledHeight}`);
    }

    clear(): void {
        if (!this.svgElement) return;
        for (const instance of this.instances) {
            this.renderer.remove(instance, this.svgElement);
        }
        this.instances = [];
    }

    startAnimation(): void {
        if (this.animating) return;
        this.animating = true;
        this.lastFrameTime = performance.now();
        this.animate();
    }

    stopAnimation(): void {
        this.animating = false;
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    selectCloud(cloud: Cloud): void {
        this.selectedCloud = cloud;
        cloud.logKnotPositions();
        cloud.logAnimationSnapshot();
        this.updateControlsPanel();
        const centerX = cloud.centerX + cloud.x;
        const centerY = cloud.centerY + cloud.y;
        this.centerOnPoint(centerX, centerY);
    }

    private updateControlsPanel(): void {
        const knotPositionsEl = document.getElementById('knot-positions');

        if (!knotPositionsEl) return;

        if (!this.selectedCloud) {
            knotPositionsEl.textContent = 'No cloud selected';
            return;
        }

        const cloud = this.selectedCloud;

        const leftCircleKnots = generateCircleKnots(-cloud.leftHeight, -Math.PI / 2, -3 * Math.PI / 2, cloud.leftHarmonics, cloud.leftRotation);
        const rightCircleKnots = generateCircleKnots(-cloud.rightHeight, Math.PI / 2, -Math.PI / 2, cloud.rightHarmonics, cloud.rightRotation);

        let html = `<strong>Selected: ${cloud.text}</strong><br>`;
        html += `<strong>Left Rotation:</strong> ${cloud.leftRotation.toFixed(3)} rad<br>`;
        html += `<strong>Right Rotation:</strong> ${cloud.rightRotation.toFixed(3)} rad<br><br>`;

        html += `<div style="display: flex; gap: 1em;">`;

        html += `<div style="flex: 1;">`;
        html += `<strong style="color: blue;">Left Circle Knots:</strong><br>`;
        html += `<svg width="150" height="150" style="border: 1px dotted blue; background: #f9f9f9;">`;
        const leftMaxY = Math.max(...leftCircleKnots.map(k => Math.abs(k.y)));
        const leftScale = 60 / leftMaxY;

        let leftContour = '';
        for (let angle = 0; angle < 2 * Math.PI; angle += 0.05) {
            const radius = cloud.leftHarmonics.evaluate(angle, cloud.leftRotation);
            const px = 75 + (radius * Math.cos(angle)) * leftScale;
            const py = 75 - (radius * Math.sin(angle)) * leftScale;
            leftContour += (leftContour ? ' L' : 'M') + ` ${px},${py}`;
        }
        html += `<path d="${leftContour}" fill="none" stroke="cyan" stroke-width="1.5" opacity="0.6"/>`;

        leftCircleKnots.forEach((knot, i) => {
            const x = 75 + knot.x * leftScale;
            const y = 75 - knot.y * leftScale;
            html += `<circle cx="${x}" cy="${y}" r="2" fill="blue"/>`;
            html += `<text x="${x + 5}" y="${y}" font-size="8" fill="blue">${i}</text>`;
        });
        const rotX = 75 + 60 * Math.cos(cloud.leftRotation);
        const rotY = 75 - 60 * Math.sin(cloud.leftRotation);
        html += `<line x1="75" y1="75" x2="${rotX}" y2="${rotY}" stroke="blue" stroke-width="1.5"/>`;
        html += `<circle cx="75" cy="75" r="60" fill="none" stroke="blue" stroke-dasharray="2,2" opacity="0.3"/>`;
        html += `</svg>`;
        html += `</div>`;

        html += `<div style="flex: 1;">`;
        html += `<strong style="color: green;">Right Circle Knots:</strong><br>`;
        html += `<svg width="150" height="150" style="border: 1px dotted green; background: #f9f9f9;">`;
        const rightMaxY = Math.max(...rightCircleKnots.map(k => Math.abs(k.y)));
        const rightScale = 60 / rightMaxY;

        let rightContour = '';
        for (let angle = 0; angle < 2 * Math.PI; angle += 0.05) {
            const radius = cloud.rightHarmonics.evaluate(angle, cloud.rightRotation);
            const px = 75 + (radius * Math.cos(angle)) * rightScale;
            const py = 75 - (radius * Math.sin(angle)) * rightScale;
            rightContour += (rightContour ? ' L' : 'M') + ` ${px},${py}`;
        }
        html += `<path d="${rightContour}" fill="none" stroke="lime" stroke-width="1.5" opacity="0.6"/>`;

        rightCircleKnots.forEach((knot, i) => {
            const x = 75 + knot.x * rightScale;
            const y = 75 - knot.y * rightScale;
            html += `<circle cx="${x}" cy="${y}" r="2" fill="green"/>`;
            html += `<text x="${x + 5}" y="${y}" font-size="8" fill="green">${i}</text>`;
        });
        const rotX2 = 75 + 60 * Math.cos(cloud.rightRotation);
        const rotY2 = 75 - 60 * Math.sin(cloud.rightRotation);
        html += `<line x1="75" y1="75" x2="${rotX2}" y2="${rotY2}" stroke="green" stroke-width="1.5"/>`;
        html += `<circle cx="75" cy="75" r="60" fill="none" stroke="green" stroke-dasharray="2,2" opacity="0.3"/>`;
        html += `</svg>`;
        html += `</div>`;

        html += `</div><br>`;

        knotPositionsEl.innerHTML = html;
    }

    private animate(): void {
        if (!this.animating) return;

        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastFrameTime) / 1000;
        this.lastFrameTime = currentTime;

        for (let i = 0; i < this.instances.length; i++) {
            if (i % this.partitionCount === this.currentPartition) {
                const instance = this.instances[i];
                instance.cloud.animate(deltaTime * this.partitionCount);
                this.renderer.updateAnimation(instance);
            }
        }

        this.currentPartition = (this.currentPartition + 1) % this.partitionCount;
        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }
}
