import { Cloud, CloudType } from './cloudShape.js';
import { Point } from './geometry.js';

export { CloudType };

const FONT_SIZE = 12;
const STROKE_WIDTH = 0.8;

interface CloudInstance {
    cloud: Cloud;
    groupElement: SVGGElement;
    pathElement: SVGPathElement;
    textElement: SVGTextElement;
}

export class CloudRelationshipManager {
    private protections = new Map<string, Set<string>>();
    private polarizations = new Map<string, Set<string>>();
    private selfRefs = new Map<string, Set<string>>();

    addProtection(protectorId: string, protectedId: string | string[]): void {
        const protectedIds = Array.isArray(protectedId) ? protectedId : [protectedId];
        for (const id of protectedIds) {
            if (!this.protections.has(protectorId)) {
                this.protections.set(protectorId, new Set());
            }
            this.protections.get(protectorId)!.add(id);
        }
    }

    removeProtection(protectorId: string, protectedId: string): void {
        this.protections.get(protectorId)?.delete(protectedId);
    }

    getProtectedBy(cloudId: string): Set<string> {
        const protectors = new Set<string>();
        for (const [protectorId, protectedSet] of this.protections) {
            if (protectedSet.has(cloudId)) {
                protectors.add(protectorId);
            }
        }
        return protectors;
    }

    getProtecting(protectorId: string): Set<string> {
        return new Set(this.protections.get(protectorId) || []);
    }

    addPolarization(cloudId1: string, cloudId2: string | string[]): void {
        const cloudIds = Array.isArray(cloudId2) ? cloudId2 : [cloudId2];
        for (const id of cloudIds) {
            if (!this.polarizations.has(cloudId1)) {
                this.polarizations.set(cloudId1, new Set());
            }
            if (!this.polarizations.has(id)) {
                this.polarizations.set(id, new Set());
            }
            this.polarizations.get(cloudId1)!.add(id);
            this.polarizations.get(id)!.add(cloudId1);
        }
    }

    removePolarization(cloudId1: string, cloudId2: string): void {
        this.polarizations.get(cloudId1)?.delete(cloudId2);
        this.polarizations.get(cloudId2)?.delete(cloudId1);
    }

    getPolarizedWith(cloudId: string): Set<string> {
        return new Set(this.polarizations.get(cloudId) || []);
    }

    addSelfReference(cloudId: string, targetId: string | string[]): void {
        const targetIds = Array.isArray(targetId) ? targetId : [targetId];
        for (const id of targetIds) {
            if (!this.selfRefs.has(cloudId)) {
                this.selfRefs.set(cloudId, new Set());
            }
            this.selfRefs.get(cloudId)!.add(id);
        }
    }

    removeSelfReference(cloudId: string, targetId: string): void {
        this.selfRefs.get(cloudId)?.delete(targetId);
    }

    getSelfReferences(cloudId: string): Set<string> {
        return new Set(this.selfRefs.get(cloudId) || []);
    }

    getReferencedBy(targetId: string): Set<string> {
        const referrers = new Set<string>();
        for (const [cloudId, targetSet] of this.selfRefs) {
            if (targetSet.has(targetId)) {
                referrers.add(cloudId);
            }
        }
        return referrers;
    }

    removeCloud(cloudId: string): void {
        this.protections.delete(cloudId);
        for (const protectedSet of this.protections.values()) {
            protectedSet.delete(cloudId);
        }

        const polarizedWith = this.polarizations.get(cloudId) || new Set();
        for (const otherId of polarizedWith) {
            this.polarizations.get(otherId)?.delete(cloudId);
        }
        this.polarizations.delete(cloudId);

        this.selfRefs.delete(cloudId);
        for (const targetSet of this.selfRefs.values()) {
            targetSet.delete(cloudId);
        }
    }

    hasProtection(protectorId: string, protectedId: string): boolean {
        return this.protections.get(protectorId)?.has(protectedId) ?? false;
    }

    hasPolarization(cloudId1: string, cloudId2: string): boolean {
        return this.polarizations.get(cloudId1)?.has(cloudId2) ?? false;
    }

    hasSelfReference(cloudId: string, targetId: string): boolean {
        return this.selfRefs.get(cloudId)?.has(targetId) ?? false;
    }
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
        text.style.pointerEvents = 'none';

        g.appendChild(path);
        g.appendChild(text);

        g.addEventListener('click', (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect();
        }, true);

        svgElement.appendChild(g);

        this.updateCloudStyles(cloud, path, text);
        this.renderText(cloud, text);
        const outlinePath = cloud.generateOutlinePath();
        path.setAttribute('d', outlinePath);

        return { cloud, groupElement: g, pathElement: path, textElement: text };
    }

    updateAnimation(instance: CloudInstance): void {
        const { cloud, groupElement, pathElement, textElement } = instance;

        const outlinePath = cloud.generateOutlinePath();
        pathElement.setAttribute('d', outlinePath);

        this.updateCloudStyles(cloud, pathElement, textElement);

        if (this.debug) {
            while (groupElement.childNodes.length > 2) {
                groupElement.removeChild(groupElement.lastChild!);
            }
            cloud.renderDebugInfo(groupElement);
        }
    }

    updateCloudStyles(cloud: Cloud, pathElement: SVGPathElement, textElement: SVGTextElement): void {
        const isDark = document.documentElement.classList.contains('dark');
        const bgColor = isDark ? '#1a1a1a' : '#ffffff';
        const textColor = isDark ? '#f5f5f5' : '#1a1a1a';

        if (this.debug) {
            pathElement.style.fill = 'yellow';
            pathElement.style.stroke = 'red';
            textElement.style.fill = '#000000';
            textElement.style.fontWeight = 'normal';
            textElement.style.stroke = '';
            textElement.style.strokeWidth = '';
        } else {
            pathElement.style.fill = cloud.getFillColor();
            pathElement.style.stroke = '#000000';
            pathElement.style.strokeOpacity = '1';
            pathElement.style.strokeLinejoin = 'round';
            textElement.style.stroke = bgColor;
            textElement.style.strokeWidth = '3';
            textElement.style.strokeLinejoin = 'round';
            textElement.style.fill = textColor;
            textElement.style.fontWeight = cloud.getTextWeight();
            textElement.style.paintOrder = 'stroke fill';
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
    private relationships: CloudRelationshipManager = new CloudRelationshipManager();
    private zoom: number = 1;
    private canvasWidth: number = 800;
    private canvasHeight: number = 600;
    private panX: number = 0;
    private panY: number = 0;
    private animating: boolean = false;
    private animationFrameId: number | null = null;
    private lastFrameTime: number = 0;
    private selectedCloud: Cloud | null = null;
    private partitionCount: number = 8;
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

    addCloud(word: string, x?: number, y?: number, cloudType?: CloudType): Cloud {
        if (!this.svgElement) throw new Error('SVG element not initialized');

        const cloudX = x ?? Math.random() * (this.canvasWidth - 200);
        const cloudY = y ?? this.canvasHeight / 2 + (Math.random() * 60 - 30);

        const cloud = new Cloud(word, cloudX, cloudY, cloudType);
        const instance = this.renderer.createCloudElements(
            cloud,
            this.svgElement,
            () => this.selectCloud(cloud)
        );
        this.instances.push(instance);
        return cloud;
    }

    getRelationships(): CloudRelationshipManager {
        return this.relationships;
    }

    getCloudById(id: string): Cloud | null {
        const instance = this.instances.find(i => i.cloud.id === id);
        return instance?.cloud ?? null;
    }

    removeCloud(cloud: Cloud): void {
        if (!this.svgElement) return;

        const index = this.instances.findIndex(i => i.cloud === cloud);
        if (index !== -1) {
            const instance = this.instances[index];
            this.renderer.remove(instance, this.svgElement);
            this.instances.splice(index, 1);
            this.relationships.removeCloud(cloud.id);
        }
    }

    setDebug(enabled: boolean): void {
        this.renderer.setDebug(enabled);
        for (const instance of this.instances) {
            this.renderer.updateCloudStyles(instance.cloud, instance.pathElement, instance.textElement);
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
            this.relationships.removeCloud(instance.cloud.id);
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
        const centerX = cloud.centerX + cloud.x;
        const centerY = cloud.centerY + cloud.y;
        this.centerOnPoint(centerX, centerY);
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
