import { Cloud, CloudType } from './cloudShape.js';
import { Point } from './geometry.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';

export { CloudType };

interface Vec3 {
    x: number;
    y: number;
    z: number;
}

interface CloudInstance {
    cloud: Cloud;
    position: Vec3;
    velocity: Vec3;
}

export class CloudManager {
    private instances: CloudInstance[] = [];
    private svgElement: SVGSVGElement | null = null;
    private container: HTMLElement | null = null;
    private debug: boolean = false;
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
    private selfElement: SVGElement | null = null;
    private counterZoomGroup: SVGGElement | null = null;

    private torusMajorRadius: number = 200;
    private torusMinorRadius: number = 80;
    private friction: number = 0.6;
    private repulsionStrength: number = 20;
    private surfaceRepulsionStrength: number = 20;
    private angularAcceleration: number = 25;
    private perspectiveFactor: number = 600;
    private torusRotationX: number = Math.PI / 3;

    private mode: 'panorama' | 'foreground' = 'panorama';
    private targetCloud: Cloud | null = null;
    private uiContainer: HTMLElement | null = null;
    private transitionProgress: number = 0;
    private transitionDuration: number = 1.0;
    private transitionDirection: 'forward' | 'reverse' | 'none' = 'none';
    private savedCloudTransforms: Map<Cloud, string> = new Map();
    private debugBox: HTMLElement | null = null;

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

        this.counterZoomGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.counterZoomGroup.setAttribute('id', 'counter-zoom-group');
        this.svgElement.appendChild(this.counterZoomGroup);

        this.createSelfStar();
        this.createUIContainer();
        this.createDebugBox();
        this.panX = this.canvasWidth / 2;
        this.panY = this.canvasHeight / 2;
        this.updateViewBox();
        this.setupVisibilityHandling();
    }

    private setupVisibilityHandling(): void {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (this.animating) {
                    this.stopAnimation();
                    this.animating = true;
                }
            } else {
                if (this.animating) {
                    this.lastFrameTime = performance.now();
                    this.animate();
                }
            }
        });
    }

    private createSelfStar(): void {
        if (!this.svgElement) return;

        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const outerRadius = 20;
        const innerRadius = 8;
        const points = 5;

        const starPoints: string[] = [];
        for (let i = 0; i < points * 2; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (Math.PI / points) * i - Math.PI / 2;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            starPoints.push(`${x.toFixed(2)},${y.toFixed(2)}`);
        }

        const star = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        star.setAttribute('points', starPoints.join(' '));
        star.setAttribute('fill', '#FFD700');
        star.setAttribute('stroke', '#DAA520');
        star.setAttribute('stroke-width', '1.5');
        star.setAttribute('opacity', '0.9');

        this.counterZoomGroup!.appendChild(star);
        this.selfElement = star;
    }

    private createDebugBox(): void {
        if (!this.container) return;

        this.debugBox = document.createElement('pre');
        this.debugBox.style.position = 'fixed';
        this.debugBox.style.top = '10px';
        this.debugBox.style.right = '10px';
        this.debugBox.style.background = 'rgba(0, 0, 0, 0.7)';
        this.debugBox.style.color = 'white';
        this.debugBox.style.padding = '10px';
        this.debugBox.style.fontFamily = 'monospace';
        this.debugBox.style.fontSize = '12px';
        this.debugBox.style.zIndex = '10000';
        this.debugBox.style.margin = '0';
        this.debugBox.style.pointerEvents = 'all';
        this.debugBox.style.userSelect = 'all';
        this.debugBox.style.webkitUserSelect = 'all';
        this.debugBox.style.cursor = 'text';
        this.debugBox.textContent = 'ViewBox: 0 0 800 600';
        document.body.appendChild(this.debugBox);
    }

    private createUIContainer(): void {
        if (!this.container) return;

        this.container.style.position = 'relative';

        this.uiContainer = document.createElement('div');
        this.uiContainer.style.position = 'absolute';
        this.uiContainer.style.top = '10px';
        this.uiContainer.style.right = '10px';
        this.uiContainer.style.display = 'none';
        this.uiContainer.style.zIndex = '1000';

        const returnButton = document.createElement('button');
        returnButton.textContent = 'Return to Panorama';
        returnButton.style.padding = '10px 20px';
        returnButton.style.fontSize = '14px';
        returnButton.style.cursor = 'pointer';
        returnButton.addEventListener('click', () => this.returnToPanorama());

        this.uiContainer.appendChild(returnButton);
        this.container.appendChild(this.uiContainer);
    }

    addCloud(word: string, options?: any): Cloud {
        if (!this.svgElement) throw new Error('SVG element not initialized');

        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 2;
        const r = this.torusMinorRadius * Math.sqrt(Math.random());

        const torusX = (this.torusMajorRadius + r * Math.cos(phi)) * Math.cos(theta);
        const torusY = (this.torusMajorRadius + r * Math.cos(phi)) * Math.sin(theta);
        const torusZ = r * Math.sin(phi);

        const cosRot = Math.cos(this.torusRotationX);
        const sinRot = Math.sin(this.torusRotationX);

        const position: Vec3 = {
            x: torusX,
            y: torusY * cosRot - torusZ * sinRot,
            z: torusY * sinRot + torusZ * cosRot
        };

        const cloud = new Cloud(word, 0, 0, undefined, options);
        const group = cloud.createSVGElements(() => this.selectCloud(cloud));
        this.svgElement.appendChild(group);
        cloud.updateSVGElements(this.debug);

        const instance: CloudInstance = {
            cloud,
            position,
            velocity: { x: 0, y: 0, z: 0 }
        };
        this.instances.push(instance);
        this.updateCloudPosition(instance);
        return cloud;
    }

    private updateCloudPosition(instance: CloudInstance): void {
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;

        const scale = this.perspectiveFactor / (this.perspectiveFactor - instance.position.z);
        const projectedX = instance.position.x * scale;
        const projectedY = instance.position.y * scale;

        instance.cloud.x = centerX + projectedX;
        instance.cloud.y = centerY + projectedY;

        const group = instance.cloud.getGroupElement();
        if (group) {
            group.setAttribute('transform', `translate(${instance.cloud.x}, ${instance.cloud.y}) scale(${scale})`);
        }
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
            const group = instance.cloud.getGroupElement();
            if (group) {
                this.svgElement.removeChild(group);
            }
            this.instances.splice(index, 1);
            this.relationships.removeCloud(cloud.id);
        }
    }

    setDebug(enabled: boolean): void {
        this.debug = enabled;
        for (const instance of this.instances) {
            instance.cloud.updateSVGElements(enabled);
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
        let effectiveZoom = this.zoom;
        let centerX = this.panX;
        let centerY = this.panY;

        if (this.transitionDirection !== 'none' && this.transitionProgress < 1) {
            const eased = this.easeInOutCubic(this.transitionProgress);
            const zoomProgress = this.transitionDirection === 'forward' ? eased : 1 - eased;
            const maxZoomFactor = 3.0;
            effectiveZoom = this.zoom * (1 + (maxZoomFactor - 1) * zoomProgress);

            centerX = this.canvasWidth / 2;
            centerY = this.canvasHeight / 2;
        } else if (this.mode === 'foreground') {
            const maxZoomFactor = 3.0;
            effectiveZoom = this.zoom * maxZoomFactor;

            centerX = this.canvasWidth / 2;
            centerY = this.canvasHeight / 2;
        }

        const scaledWidth = this.canvasWidth / effectiveZoom;
        const scaledHeight = this.canvasHeight / effectiveZoom;
        const viewBoxX = centerX - scaledWidth / 2;
        const viewBoxY = centerY - scaledHeight / 2;
        this.svgElement?.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${scaledWidth} ${scaledHeight}`);

        if (this.debugBox) {
            const debugText =
                `Mode: ${this.mode}\n` +
                `Transition: ${this.transitionDirection} (${(this.transitionProgress * 100).toFixed(0)}%)\n` +
                `ViewBox: ${viewBoxX.toFixed(1)} ${viewBoxY.toFixed(1)} ${scaledWidth.toFixed(1)} ${scaledHeight.toFixed(1)}\n` +
                `Zoom: ${effectiveZoom.toFixed(2)}x`;
            this.debugBox.textContent = debugText;

            // Also log to console for easy copying
            if (this.transitionDirection !== 'none' || this.mode === 'foreground') {
                console.log(debugText);
            }
        }
    }

    clear(): void {
        if (!this.svgElement) return;
        for (const instance of this.instances) {
            const group = instance.cloud.getGroupElement();
            if (group) {
                this.svgElement.removeChild(group);
            }
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

        if (this.mode === 'panorama') {
            this.enterForegroundMode(cloud);
        } else {
            const centerX = cloud.centerX + cloud.x;
            const centerY = cloud.centerY + cloud.y;
            this.centerOnPoint(centerX, centerY);
        }
    }

    private enterForegroundMode(cloud: Cloud): void {
        this.targetCloud = cloud;
        this.transitionProgress = 0;
        this.transitionDirection = 'forward';

        if (this.uiContainer) {
            this.uiContainer.style.display = 'block';
        }
    }

    private returnToPanorama(): void {
        this.transitionProgress = 0;
        this.transitionDirection = 'reverse';
    }

    private finishReturnToPanorama(): void {
        this.mode = 'panorama';

        if (this.targetCloud) {
            const targetInstance = this.instances.find(i => i.cloud === this.targetCloud);
            if (targetInstance) {
                const group = targetInstance.cloud.getGroupElement();
                if (group && group.parentNode === this.counterZoomGroup) {
                    this.svgElement!.appendChild(group);
                }
                this.updateCloudPosition(targetInstance);
            }
        }

        this.targetCloud = null;

        if (this.uiContainer) {
            this.uiContainer.style.display = 'none';
        }

        if (this.selfElement) {
            this.selfElement.removeAttribute('transform');
        }

        this.panX = this.canvasWidth / 2;
        this.panY = this.canvasHeight / 2;
        this.updateViewBox();

        for (const instance of this.instances) {
            this.updateCloudPosition(instance);
        }
    }

    private depthSort(): void {
        if (!this.svgElement) return;

        this.instances.sort((a, b) => a.position.z - b.position.z);

        let selfInserted = false;
        for (const instance of this.instances) {
            if (!selfInserted && instance.position.z >= 0 && this.selfElement && this.selfElement.parentNode === this.svgElement) {
                this.svgElement.appendChild(this.selfElement);
                selfInserted = true;
            }
            const group = instance.cloud.getGroupElement();
            if (group && group.parentNode === this.svgElement) {
                this.svgElement.appendChild(group);
            }
        }

        if (!selfInserted && this.selfElement && this.selfElement.parentNode === this.svgElement) {
            this.svgElement.appendChild(this.selfElement);
        }
    }

    private animate(): void {
        if (!this.animating) return;

        const currentTime = performance.now();
        const deltaTime = Math.min((currentTime - this.lastFrameTime) / 1000, 0.1);
        this.lastFrameTime = currentTime;

        const isTransitioning = this.transitionDirection !== 'none' && this.transitionProgress < 1;

        if (this.transitionDirection === 'forward' && this.transitionProgress < 1) {
            this.transitionProgress = Math.min(1, this.transitionProgress + deltaTime / this.transitionDuration);
            this.updateForegroundTransition();
            if (this.transitionProgress >= 1) {
                this.mode = 'foreground';
                this.transitionDirection = 'none';
            }
        } else if (this.transitionDirection === 'reverse' && this.transitionProgress < 1) {
            this.transitionProgress = Math.min(1, this.transitionProgress + deltaTime / this.transitionDuration);
            this.updateForegroundTransition();
            if (this.transitionProgress >= 1) {
                this.finishReturnToPanorama();
                this.transitionDirection = 'none';
            }
        } else if (this.mode === 'foreground') {
            this.updateViewBox();
            this.updateSplitPaneLayout(1);
        } else {
            this.updateCounterZoom(1);
        }

        let needsOpacityUpdate = isTransitioning;
        let fadeProgress = 0;
        if (needsOpacityUpdate) {
            const eased = this.easeInOutCubic(this.transitionProgress);
            fadeProgress = this.transitionDirection === 'forward' ? eased : 1 - eased;
        }

        for (let i = 0; i < this.instances.length; i++) {
            if (i % this.partitionCount === this.currentPartition) {
                const instance = this.instances[i];
                instance.cloud.animate(deltaTime * this.partitionCount);

                const isTargetCloud = instance.cloud === this.targetCloud;

                if (this.mode === 'panorama' && !isTransitioning) {
                    if (isTargetCloud) {
                        throw new Error('Physics should not run on target cloud - target cloud should be null in panorama mode');
                    }
                    this.applyPhysics(instance, deltaTime * this.partitionCount);
                    this.updateCloudPosition(instance);
                } else if (isTransitioning) {
                    if (!isTargetCloud) {
                        const group = instance.cloud.getGroupElement();
                        if (group) {
                            const opacity = 1 - fadeProgress;
                            group.setAttribute('opacity', String(opacity));
                        }
                    }
                } else if (this.mode === 'foreground' && !isTargetCloud) {
                    const group = instance.cloud.getGroupElement();
                    if (group && group.getAttribute('opacity') !== '0') {
                        group.setAttribute('opacity', '0');
                    }
                }
                instance.cloud.updateSVGElements(this.debug);
            }
        }

        if (this.mode === 'panorama') {
            this.depthSort();
        }
        this.currentPartition = (this.currentPartition + 1) % this.partitionCount;
        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }

    private updateForegroundTransition(): void {
        const eased = this.easeInOutCubic(this.transitionProgress);
        this.updateViewBox();
        this.updateSplitPaneLayout(eased);
    }

    private updateCounterZoom(currentZoomFactor: number): void {
        if (!this.counterZoomGroup) return;

        const counterScale = 1 / currentZoomFactor;
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;

        this.counterZoomGroup.setAttribute('transform',
            `translate(${centerX}, ${centerY}) scale(${counterScale}) translate(${-centerX}, ${-centerY})`);
    }

    private updateSplitPaneLayout(progress: number): void {
        if (!this.svgElement || !this.targetCloud) return;

        const maxZoomFactor = 3.0;
        let currentZoomFactor: number;

        if (this.transitionDirection !== 'none' && this.transitionProgress < 1) {
            const eased = this.easeInOutCubic(this.transitionProgress);
            const zoomProgress = this.transitionDirection === 'forward' ? eased : 1 - eased;
            currentZoomFactor = 1 + (maxZoomFactor - 1) * zoomProgress;
        } else if (this.mode === 'foreground') {
            currentZoomFactor = maxZoomFactor;
        } else {
            currentZoomFactor = 1;
        }

        this.updateCounterZoom(currentZoomFactor);

        const counterScale = 1 / currentZoomFactor;
        const leftPaneX = this.canvasWidth * 0.25;
        const rightPaneX = this.canvasWidth * 0.75;

        if (this.selfElement) {
            let starCurrentX: number;
            let starCurrentY: number;

            if (this.transitionDirection === 'forward') {
                const starStartX = this.canvasWidth / 2;
                const starStartY = this.canvasHeight / 2;
                const starTargetX = leftPaneX;
                const starTargetY = this.canvasHeight / 2;
                starCurrentX = starStartX + (starTargetX - starStartX) * progress;
                starCurrentY = starStartY + (starTargetY - starStartY) * progress;
            } else if (this.transitionDirection === 'reverse') {
                const starStartX = leftPaneX;
                const starStartY = this.canvasHeight / 2;
                const starTargetX = this.canvasWidth / 2;
                const starTargetY = this.canvasHeight / 2;
                starCurrentX = starStartX + (starTargetX - starStartX) * progress;
                starCurrentY = starStartY + (starTargetY - starStartY) * progress;
            } else {
                starCurrentX = leftPaneX;
                starCurrentY = this.canvasHeight / 2;
            }

            this.selfElement.setAttribute('transform',
                `translate(${starCurrentX - this.canvasWidth / 2}, ${starCurrentY - this.canvasHeight / 2})`);
        }

        const targetInstance = this.instances.find(i => i.cloud === this.targetCloud);
        if (targetInstance) {
            const perspectiveScale = this.perspectiveFactor / (this.perspectiveFactor - targetInstance.position.z);
            const naturalScale = 1.0;

            let currentScale: number;
            let cloudCurrentX: number;
            let cloudCurrentY: number;

            if (this.transitionDirection === 'forward') {
                currentScale = perspectiveScale + (naturalScale - perspectiveScale) * progress;
                const cloudStartX = this.canvasWidth / 2 + targetInstance.position.x * perspectiveScale;
                const cloudStartY = this.canvasHeight / 2 + targetInstance.position.y * perspectiveScale;
                const cloudTargetX = rightPaneX;
                const cloudTargetY = this.canvasHeight / 2;
                cloudCurrentX = cloudStartX + (cloudTargetX - cloudStartX) * progress;
                cloudCurrentY = cloudStartY + (cloudTargetY - cloudStartY) * progress;
            } else if (this.transitionDirection === 'reverse') {
                currentScale = naturalScale + (perspectiveScale - naturalScale) * progress;
                const cloudStartX = rightPaneX;
                const cloudStartY = this.canvasHeight / 2;
                const cloudTargetX = this.canvasWidth / 2 + targetInstance.position.x * perspectiveScale;
                const cloudTargetY = this.canvasHeight / 2 + targetInstance.position.y * perspectiveScale;
                cloudCurrentX = cloudStartX + (cloudTargetX - cloudStartX) * progress;
                cloudCurrentY = cloudStartY + (cloudTargetY - cloudStartY) * progress;
            } else {
                currentScale = naturalScale;
                cloudCurrentX = rightPaneX;
                cloudCurrentY = this.canvasHeight / 2;
            }

            const group = targetInstance.cloud.getGroupElement();
            if (group) {
                if (group.parentNode !== this.counterZoomGroup) {
                    this.counterZoomGroup!.appendChild(group);
                }
                group.setAttribute('transform',
                    `translate(${cloudCurrentX}, ${cloudCurrentY}) scale(${currentScale})`);
            }
        }
    }

    private easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    private applyPhysics(instance: CloudInstance, deltaTime: number): void {
        const force = { x: 0, y: 0, z: 0 };

        this.applyCloudRepulsion(instance, force);
        this.applyTorusSurfaceRepulsion(instance, force);
        this.applyAngularForce(instance, force);

        instance.velocity.x += force.x * deltaTime;
        instance.velocity.y += force.y * deltaTime;
        instance.velocity.z += force.z * deltaTime;

        instance.velocity.x *= this.friction;
        instance.velocity.y *= this.friction;
        instance.velocity.z *= this.friction;

        instance.position.x += instance.velocity.x * deltaTime;
        instance.position.y += instance.velocity.y * deltaTime;
        instance.position.z += instance.velocity.z * deltaTime;
    }

    private applyCloudRepulsion(instance: CloudInstance, force: Vec3): void {
        for (const other of this.instances) {
            if (other === instance) continue;

            const dx = instance.position.x - other.position.x;
            const dy = instance.position.y - other.position.y;
            const dz = instance.position.z - other.position.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            const minDist = 50;

            if (distSq < minDist * minDist && distSq > 0.01) {
                const dist = Math.sqrt(distSq);
                const strength = this.repulsionStrength * (1 - dist / minDist);
                force.x += (dx / dist) * strength;
                force.y += (dy / dist) * strength;
                force.z += (dz / dist) * strength;
            }
        }
    }

    private applyTorusSurfaceRepulsion(instance: CloudInstance, force: Vec3): void {
        const pos = instance.position;
        const cosRot = Math.cos(this.torusRotationX);
        const sinRot = Math.sin(this.torusRotationX);

        const torusY = pos.y * cosRot + pos.z * sinRot;
        const torusZ = -pos.y * sinRot + pos.z * cosRot;

        const distFromCenter = Math.sqrt(pos.x * pos.x + torusY * torusY);
        const ringDist = Math.abs(distFromCenter - this.torusMajorRadius);
        const vertDist = Math.abs(torusZ);
        const distFromSurface = Math.sqrt(ringDist * ringDist + vertDist * vertDist);

        if (distFromSurface > this.torusMinorRadius * 0.7) {
            const excess = distFromSurface - this.torusMinorRadius * 0.7;
            const strength = this.surfaceRepulsionStrength * excess;

            const theta = Math.atan2(torusY, pos.x);
            const towardCenterTorus = {
                x: this.torusMajorRadius * Math.cos(theta) - pos.x,
                y: this.torusMajorRadius * Math.sin(theta) - torusY,
                z: -torusZ
            };
            const mag = Math.sqrt(towardCenterTorus.x ** 2 + towardCenterTorus.y ** 2 + towardCenterTorus.z ** 2);
            if (mag > 0.01) {
                force.x += (towardCenterTorus.x / mag) * strength;
                force.y += (towardCenterTorus.y * cosRot - towardCenterTorus.z * sinRot) * strength / mag;
                force.z += (towardCenterTorus.y * sinRot + towardCenterTorus.z * cosRot) * strength / mag;
            }
        }
    }

    private applyAngularForce(instance: CloudInstance, force: Vec3): void {
        const pos = instance.position;
        const cosRot = Math.cos(this.torusRotationX);
        const sinRot = Math.sin(this.torusRotationX);

        const torusY = pos.y * cosRot + pos.z * sinRot;
        const distFromCenter = Math.sqrt(pos.x * pos.x + torusY * torusY);

        if (distFromCenter > 0.01) {
            const tangentX = -torusY / distFromCenter;
            const tangentY = pos.x / distFromCenter;

            force.x += tangentX * this.angularAcceleration;
            force.y += (tangentY * cosRot) * this.angularAcceleration;
            force.z += (tangentY * sinRot) * this.angularAcceleration;
        }
    }
}
