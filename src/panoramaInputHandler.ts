import { CloudInstance } from './types.js';

export interface PanoramaInputConfig {
    minZoom: number;
    maxZoom: number;
    rotationSensitivity: number;
}

const DEFAULT_CONFIG: PanoramaInputConfig = {
    minZoom: 0.7,
    maxZoom: 1.5,
    rotationSensitivity: 0.008,
};

export class PanoramaInputHandler {
    private svgElement: SVGSVGElement;
    private config: PanoramaInputConfig;
    private getMode: () => 'panorama' | 'foreground';
    private getInstances: () => CloudInstance[];
    private getZoom: () => number;
    private setZoom: (zoom: number) => void;

    private initialPinchDistance: number = 0;
    private initialZoom: number = 1;
    private isPinching: boolean = false;

    private isDragging: boolean = false;
    private lastDragX: number = 0;

    private isMouseDragging: boolean = false;
    private lastMouseX: number = 0;

    constructor(
        svgElement: SVGSVGElement,
        options: {
            getMode: () => 'panorama' | 'foreground';
            getInstances: () => CloudInstance[];
            getZoom: () => number;
            setZoom: (zoom: number) => void;
            config?: Partial<PanoramaInputConfig>;
        }
    ) {
        this.svgElement = svgElement;
        this.getMode = options.getMode;
        this.getInstances = options.getInstances;
        this.getZoom = options.getZoom;
        this.setZoom = options.setZoom;
        this.config = { ...DEFAULT_CONFIG, ...options.config };

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Touch events
        this.svgElement.addEventListener('touchstart', this.handleTouchStart, { passive: false });
        this.svgElement.addEventListener('touchmove', this.handleTouchMove, { passive: false });
        this.svgElement.addEventListener('touchend', this.handleTouchEnd, { passive: true });
        this.svgElement.addEventListener('touchcancel', this.handleTouchEnd, { passive: true });

        // Mouse events
        this.svgElement.addEventListener('wheel', this.handleWheel, { passive: false });
        this.svgElement.addEventListener('mousedown', this.handleMouseDown);
        this.svgElement.addEventListener('mousemove', this.handleMouseMove);
        this.svgElement.addEventListener('mouseup', this.handleMouseUp);
        this.svgElement.addEventListener('mouseleave', this.handleMouseUp);
    }

    private handleTouchStart = (e: TouchEvent): void => {
        if (this.getMode() !== 'panorama') return;

        if (e.touches.length === 2) {
            e.preventDefault();
            this.startPinch(e.touches[0], e.touches[1]);
        } else if (e.touches.length === 1) {
            this.startDrag(e.touches[0]);
        }
    };

    private handleTouchMove = (e: TouchEvent): void => {
        if (this.getMode() !== 'panorama') return;

        if (e.touches.length === 2 && this.isPinching) {
            e.preventDefault();
            this.updatePinch(e.touches[0], e.touches[1]);
        } else if (e.touches.length === 1 && this.isDragging) {
            e.preventDefault();
            this.updateDrag(e.touches[0]);
        }
    };

    private handleTouchEnd = (e: TouchEvent): void => {
        if (e.touches.length < 2) {
            this.isPinching = false;
        }
        if (e.touches.length === 0) {
            this.isDragging = false;
        }
    };

    private startPinch(touch1: Touch, touch2: Touch): void {
        this.isPinching = true;
        this.isDragging = false;
        this.initialPinchDistance = this.getTouchDistance(touch1, touch2);
        this.initialZoom = this.getZoom();
    }

    private updatePinch(touch1: Touch, touch2: Touch): void {
        const currentDistance = this.getTouchDistance(touch1, touch2);
        const scale = currentDistance / this.initialPinchDistance;
        const newZoom = this.initialZoom * scale;
        const clampedZoom = Math.max(this.config.minZoom, Math.min(this.config.maxZoom, newZoom));
        this.setZoom(clampedZoom);
    }

    private getTouchDistance(touch1: Touch, touch2: Touch): number {
        const dx = touch2.clientX - touch1.clientX;
        const dy = touch2.clientY - touch1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private startDrag(touch: Touch): void {
        this.isDragging = true;
        this.lastDragX = touch.clientX;
    }

    private updateDrag(touch: Touch): void {
        const dx = touch.clientX - this.lastDragX;
        this.lastDragX = touch.clientX;

        const angularDelta = dx * this.config.rotationSensitivity;
        this.applyRotation(angularDelta);
    }

    private applyRotation(angularDelta: number): void {
        const instances = this.getInstances();
        const torusRotationX = Math.PI / 3;
        const cosRot = Math.cos(torusRotationX);
        const sinRot = Math.sin(torusRotationX);
        const cosTheta = Math.cos(angularDelta);
        const sinTheta = Math.sin(angularDelta);

        for (const instance of instances) {
            const pos = instance.position;

            // Transform to torus-aligned coordinates (undo torus tilt)
            const torusY = pos.y * cosRot + pos.z * sinRot;
            const torusZ = -pos.y * sinRot + pos.z * cosRot;

            // Rotate around the torus axis (y-axis in torus space)
            const newX = pos.x * cosTheta - torusY * sinTheta;
            const newTorusY = pos.x * sinTheta + torusY * cosTheta;

            // Transform back to world coordinates (reapply torus tilt)
            pos.x = newX;
            pos.y = newTorusY * cosRot - torusZ * sinRot;
            pos.z = newTorusY * sinRot + torusZ * cosRot;
        }
    }

    private handleWheel = (e: WheelEvent): void => {
        if (this.getMode() !== 'panorama') return;

        e.preventDefault();
        const zoomSensitivity = 0.001;
        const currentZoom = this.getZoom();
        const delta = -e.deltaY * zoomSensitivity;
        const newZoom = currentZoom * (1 + delta);
        const clampedZoom = Math.max(this.config.minZoom, Math.min(this.config.maxZoom, newZoom));
        this.setZoom(clampedZoom);
    };

    private handleMouseDown = (e: MouseEvent): void => {
        if (this.getMode() !== 'panorama') return;
        if (e.button !== 0) return; // Only left click

        // Check if clicking on a cloud - if so, don't start drag
        const target = e.target as Element;
        if (target.closest('.cloud-group')) return;

        this.isMouseDragging = true;
        this.lastMouseX = e.clientX;
    };

    private handleMouseMove = (e: MouseEvent): void => {
        if (!this.isMouseDragging) return;
        if (this.getMode() !== 'panorama') return;

        const dx = e.clientX - this.lastMouseX;
        this.lastMouseX = e.clientX;

        const angularDelta = dx * this.config.rotationSensitivity;
        this.applyRotation(angularDelta);
    };

    private handleMouseUp = (): void => {
        this.isMouseDragging = false;
    };

    destroy(): void {
        this.svgElement.removeEventListener('touchstart', this.handleTouchStart);
        this.svgElement.removeEventListener('touchmove', this.handleTouchMove);
        this.svgElement.removeEventListener('touchend', this.handleTouchEnd);
        this.svgElement.removeEventListener('touchcancel', this.handleTouchEnd);
        this.svgElement.removeEventListener('wheel', this.handleWheel);
        this.svgElement.removeEventListener('mousedown', this.handleMouseDown);
        this.svgElement.removeEventListener('mousemove', this.handleMouseMove);
        this.svgElement.removeEventListener('mouseup', this.handleMouseUp);
        this.svgElement.removeEventListener('mouseleave', this.handleMouseUp);
    }
}
