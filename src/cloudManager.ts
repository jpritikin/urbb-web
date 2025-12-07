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
        this.createSelfStar();
        this.createUIContainer();
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

        this.svgElement.appendChild(star);
        this.selfElement = star;
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
        const scaledWidth = this.canvasWidth / this.zoom;
        const scaledHeight = this.canvasHeight / this.zoom;
        const viewBoxX = this.panX - scaledWidth / 2;
        const viewBoxY = this.panY - scaledHeight / 2;
        this.svgElement?.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${scaledWidth} ${scaledHeight}`);
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
        this.targetCloud = null;

        if (this.uiContainer) {
            this.uiContainer.style.display = 'none';
        }

        if (this.selfElement) {
            this.selfElement.removeAttribute('transform');
        }

        for (const instance of this.instances) {
            const group = instance.cloud.getGroupElement();
            if (group) {
                group.style.visibility = 'visible';
            }
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
        }

        for (let i = 0; i < this.instances.length; i++) {
            if (i % this.partitionCount === this.currentPartition) {
                const instance = this.instances[i];
                instance.cloud.animate(deltaTime * this.partitionCount);

                if (this.mode === 'panorama' && !isTransitioning) {
                    this.applyPhysics(instance, deltaTime * this.partitionCount);
                    this.updateCloudPosition(instance);
                } else if (isTransitioning || this.mode === 'foreground') {
                    if (instance.cloud !== this.targetCloud) {
                        const group = instance.cloud.getGroupElement();
                        if (group) {
                            group.style.visibility = 'hidden';
                        }
                    }
                }
                instance.cloud.updateSVGElements(this.debug);
            }
        }

        this.depthSort();
        this.currentPartition = (this.currentPartition + 1) % this.partitionCount;
        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }

    private updateForegroundTransition(): void {
        const eased = this.easeInOutCubic(this.transitionProgress);
        const effectiveProgress = this.transitionDirection === 'forward' ? eased : 1 - eased;
        this.updateSplitPaneLayout(effectiveProgress);
    }

    private updateSplitPaneLayout(progress: number): void {
        if (!this.svgElement || !this.targetCloud) return;

        const leftPaneX = this.canvasWidth * 0.25;
        const rightPaneX = this.canvasWidth * 0.75;

        if (this.selfElement) {
            const starStartX = this.canvasWidth / 2;
            const starStartY = this.canvasHeight / 2;
            const starTargetX = leftPaneX;
            const starTargetY = this.canvasHeight / 2;

            const starCurrentX = starStartX + (starTargetX - starStartX) * progress;
            const starCurrentY = starStartY + (starTargetY - starStartY) * progress;

            this.selfElement.setAttribute('transform', `translate(${starCurrentX - this.canvasWidth / 2}, ${starCurrentY - this.canvasHeight / 2})`);
        }

        const targetInstance = this.instances.find(i => i.cloud === this.targetCloud);
        if (targetInstance) {
            const scale = this.perspectiveFactor / (this.perspectiveFactor - targetInstance.position.z);

            const cloudStartX = this.canvasWidth / 2 + targetInstance.position.x * scale;
            const cloudStartY = this.canvasHeight / 2 + targetInstance.position.y * scale;
            const cloudTargetX = rightPaneX;
            const cloudTargetY = this.canvasHeight / 2;

            const cloudCurrentX = cloudStartX + (cloudTargetX - cloudStartX) * progress;
            const cloudCurrentY = cloudStartY + (cloudTargetY - cloudStartY) * progress;

            const group = targetInstance.cloud.getGroupElement();
            if (group) {
                group.setAttribute('transform', `translate(${cloudCurrentX}, ${cloudCurrentY}) scale(${scale})`);
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
