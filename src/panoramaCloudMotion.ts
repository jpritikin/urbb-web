import { Vec3, CloudInstance } from './types.js';

export interface PanoramaConfig {
    torusMajorRadiusX: number;
    torusMajorRadiusY: number;
    torusMinorRadius: number;
    torusRotationX: number;
    maxVelocity: number;
    minRetargetInterval: number;
    maxRetargetInterval: number;
    angularVelocity: number;
}

interface CloudMotionState {
    cloudId: string;
    homeTheta: number;  // angle on torus core circle
    targetPosition: Vec3;
    nextRetargetTime: number;
}

const UPDATE_INTERVAL = 0.1; // 10 fps

export class PanoramaCloudMotion {
    private config: PanoramaConfig;
    private states: Map<string, CloudMotionState> = new Map();
    private elapsedTime: number = 0;
    private timeSinceLastUpdate: number = 0;
    private random: () => number = Math.random;
    private debugGroup: SVGGElement | null = null;
    private debugEnabled: boolean = false;

    constructor(config: PanoramaConfig) {
        this.config = config;
    }

    setRandom(fn: () => number): void {
        this.random = fn;
    }

    updateConfig(config: Partial<PanoramaConfig>): void {
        this.config = { ...this.config, ...config };
    }

    setDimensions(width: number, height: number): void {
        this.config.torusMajorRadiusX = width * 0.35;
        this.config.torusMajorRadiusY = height * 0.35;
    }

    initializeCloud(cloudId: string, position: Vec3): void {
        const homeTheta = 0;
        this.states.set(cloudId, {
            cloudId,
            homeTheta,
            targetPosition: { x: 0, y: 0, z: 0 },
            nextRetargetTime: this.elapsedTime + this.randomRetargetDelay()
        });
    }

    finalizeInitialization(instances: { cloud: { id: string }; position: Vec3 }[]): void {
        const count = this.states.size;
        if (count === 0) return;

        const angleStep = (Math.PI * 2) / count;
        let index = 0;
        for (const instance of instances) {
            const state = this.states.get(instance.cloud.id);
            if (state) {
                state.homeTheta = index * angleStep;
                const initialPos = this.generatePositionInSphere(state.homeTheta);
                instance.position.x = initialPos.x;
                instance.position.y = initialPos.y;
                instance.position.z = initialPos.z;
                state.targetPosition = { ...instance.position };
                index++;
            }
        }
    }

    generateInitialPosition(): Vec3 {
        return { x: 0, y: 0, z: 0 };
    }

    private generatePositionInSphere(theta: number): Vec3 {
        const r = this.config.torusMinorRadius * Math.cbrt(this.random());
        const u = this.random() * 2 - 1;
        const phi = this.random() * Math.PI * 2;
        const sqrtOneMinusU2 = Math.sqrt(1 - u * u);

        const localX = r * sqrtOneMinusU2 * Math.cos(phi);
        const localY = r * sqrtOneMinusU2 * Math.sin(phi);
        const localZ = r * u;

        // Ellipse center point
        const centerX = this.config.torusMajorRadiusX * Math.cos(theta);
        const centerY = this.config.torusMajorRadiusY * Math.sin(theta);

        // Tangent direction on ellipse (normalized)
        const tangentX = -this.config.torusMajorRadiusX * Math.sin(theta);
        const tangentY = this.config.torusMajorRadiusY * Math.cos(theta);
        const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
        const normTangentX = tangentX / tangentLen;
        const normTangentY = tangentY / tangentLen;

        // Normal (perpendicular to tangent, pointing outward)
        const normalX = normTangentY;
        const normalY = -normTangentX;

        // Position sphere center at ellipse point, offset in normal direction
        const torusX = centerX + localX * normalX - localY * normTangentX;
        const torusY = centerY + localX * normalY - localY * normTangentY;
        const torusZ = localZ;

        const cosRot = Math.cos(this.config.torusRotationX);
        const sinRot = Math.sin(this.config.torusRotationX);

        return {
            x: torusX,
            y: torusY * cosRot - torusZ * sinRot,
            z: torusY * sinRot + torusZ * cosRot
        };
    }

    private randomRetargetDelay(): number {
        const { minRetargetInterval, maxRetargetInterval } = this.config;
        return minRetargetInterval + this.random() * (maxRetargetInterval - minRetargetInterval);
    }

    private pickNewTarget(state: CloudMotionState): void {
        state.targetPosition = this.generatePositionInSphere(state.homeTheta);
        state.nextRetargetTime = this.elapsedTime + this.randomRetargetDelay();
    }

    animate(instances: CloudInstance[], deltaTime: number, userRotation: number): void {
        this.timeSinceLastUpdate += deltaTime;
        if (this.timeSinceLastUpdate < UPDATE_INTERVAL) return;

        const updateDelta = this.timeSinceLastUpdate;
        this.timeSinceLastUpdate = 0;
        this.elapsedTime += updateDelta;

        const autoRotation = this.config.angularVelocity * updateDelta;
        const totalRotation = autoRotation + userRotation;

        for (const instance of instances) {
            const state = this.states.get(instance.cloud.id);
            if (!state) continue;

            // Rotate homeTheta and positions around torus axis
            const oldTheta = state.homeTheta;
            const newTheta = oldTheta + totalRotation;
            state.homeTheta = newTheta;
            this.rotateAroundTorusAxis(state.targetPosition, totalRotation, oldTheta, newTheta);
            this.rotateAroundTorusAxis(instance.position, totalRotation, oldTheta, newTheta);

            if (this.elapsedTime >= state.nextRetargetTime) {
                this.pickNewTarget(state);
            }

            const dx = state.targetPosition.x - instance.position.x;
            const dy = state.targetPosition.y - instance.position.y;
            const dz = state.targetPosition.z - instance.position.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < 0.5) {
                instance.position.x = state.targetPosition.x;
                instance.position.y = state.targetPosition.y;
                instance.position.z = state.targetPosition.z;
                instance.velocity.x = 0;
                instance.velocity.y = 0;
                instance.velocity.z = 0;
                continue;
            }

            const speed = Math.min(this.config.maxVelocity, dist / updateDelta);
            instance.velocity.x = (dx / dist) * speed;
            instance.velocity.y = (dy / dist) * speed;
            instance.velocity.z = (dz / dist) * speed;

            instance.position.x += instance.velocity.x * updateDelta;
            instance.position.y += instance.velocity.y * updateDelta;
            instance.position.z += instance.velocity.z * updateDelta;
        }
    }

    private rotateAroundTorusAxis(pos: Vec3, angle: number, oldTheta: number, newTheta: number): void {
        const cosRot = Math.cos(this.config.torusRotationX);
        const sinRot = Math.sin(this.config.torusRotationX);

        // Transform to torus-aligned coordinates
        const torusY = pos.y * cosRot + pos.z * sinRot;
        const torusZ = -pos.y * sinRot + pos.z * cosRot;

        // Find offset from old ellipse center
        const oldCenterX = this.config.torusMajorRadiusX * Math.cos(oldTheta);
        const oldCenterY = this.config.torusMajorRadiusY * Math.sin(oldTheta);
        const offsetX = pos.x - oldCenterX;
        const offsetY = torusY - oldCenterY;

        // Move to new ellipse center
        const newCenterX = this.config.torusMajorRadiusX * Math.cos(newTheta);
        const newCenterY = this.config.torusMajorRadiusY * Math.sin(newTheta);

        // Rotate the offset by the angle change
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const rotatedOffsetX = offsetX * cosA - offsetY * sinA;
        const rotatedOffsetY = offsetX * sinA + offsetY * cosA;

        const newX = newCenterX + rotatedOffsetX;
        const newTorusY = newCenterY + rotatedOffsetY;

        // Transform back
        pos.x = newX;
        pos.y = newTorusY * cosRot - torusZ * sinRot;
        pos.z = newTorusY * sinRot + torusZ * cosRot;
    }

    depthSort(
        instances: CloudInstance[],
        container: SVGGElement,
        starElement: SVGGElement | null
    ): void {
        const DEPTH_THRESHOLD = 15;
        instances.sort((a, b) => {
            const diff = a.position.z - b.position.z;
            return Math.abs(diff) < DEPTH_THRESHOLD ? 0 : diff;
        });

        if (starElement && starElement.parentNode !== container) {
            container.appendChild(starElement);
        }

        let selfInserted = false;
        for (const instance of instances) {
            if (!selfInserted && instance.position.z >= 0 && starElement) {
                container.appendChild(starElement);
                selfInserted = true;
            }
            const group = instance.cloud.getGroupElement();
            if (group && group.parentNode === container) {
                container.appendChild(group);
            }
        }

        if (!selfInserted && starElement) {
            container.appendChild(starElement);
        }
    }

    setDebugGroup(group: SVGGElement | null): void {
        this.debugGroup = group;
    }

    setDebugEnabled(enabled: boolean): void {
        this.debugEnabled = enabled;
    }

    renderDebug(instances: CloudInstance[], canvasWidth: number, canvasHeight: number, perspectiveFactor: number): void {
        if (!this.debugGroup) return;

        while (this.debugGroup.firstChild) {
            this.debugGroup.removeChild(this.debugGroup.firstChild);
        }

        if (!this.debugEnabled) return;

        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;

        for (const instance of instances) {
            const state = this.states.get(instance.cloud.id);
            if (!state) continue;

            const target = state.targetPosition;
            const scale = perspectiveFactor / (perspectiveFactor - target.z);
            const screenX = centerX + target.x * scale;
            const screenY = centerY + target.y * scale;

            const thetaDegrees = ((state.homeTheta * 180 / Math.PI) % 360 + 360) % 360;
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(screenX));
            text.setAttribute('y', String(screenY));
            text.setAttribute('fill', 'red');
            text.setAttribute('font-size', String(12 * scale));
            text.setAttribute('font-family', 'monospace');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.textContent = `${thetaDegrees.toFixed(0)}°`;
            this.debugGroup.appendChild(text);

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            const posScale = perspectiveFactor / (perspectiveFactor - instance.position.z);
            const posScreenX = centerX + instance.position.x * posScale;
            const posScreenY = centerY + instance.position.y * posScale;
            line.setAttribute('x1', String(posScreenX));
            line.setAttribute('y1', String(posScreenY));
            line.setAttribute('x2', String(screenX));
            line.setAttribute('y2', String(screenY));
            line.setAttribute('stroke', 'rgba(255, 0, 0, 0.3)');
            line.setAttribute('stroke-width', '1');
            line.setAttribute('stroke-dasharray', '3,3');
            this.debugGroup.appendChild(line);
        }
    }
}
