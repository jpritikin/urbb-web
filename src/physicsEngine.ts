interface Vec3 {
    x: number;
    y: number;
    z: number;
}

interface CloudInstance {
    cloud: any;
    position: Vec3;
    velocity: Vec3;
}

export interface PhysicsConfig {
    torusMajorRadius: number;
    torusMinorRadius: number;
    torusRotationX: number;
    friction: number;
    repulsionStrength: number;
    surfaceRepulsionStrength: number;
    angularAcceleration: number;
}

export class PhysicsEngine {
    private config: PhysicsConfig;

    constructor(config: PhysicsConfig) {
        this.config = config;
    }

    updateConfig(config: Partial<PhysicsConfig>): void {
        this.config = { ...this.config, ...config };
    }

    applyPhysics(instance: CloudInstance, allInstances: CloudInstance[], deltaTime: number): void {
        const force = { x: 0, y: 0, z: 0 };

        this.applyCloudRepulsion(instance, allInstances, force);
        this.applyTorusSurfaceRepulsion(instance, force);
        this.applyAngularForce(instance, force);

        instance.velocity.x += force.x * deltaTime;
        instance.velocity.y += force.y * deltaTime;
        instance.velocity.z += force.z * deltaTime;

        instance.velocity.x *= this.config.friction;
        instance.velocity.y *= this.config.friction;
        instance.velocity.z *= this.config.friction;

        instance.position.x += instance.velocity.x * deltaTime;
        instance.position.y += instance.velocity.y * deltaTime;
        instance.position.z += instance.velocity.z * deltaTime;
    }

    generateTorusPosition(): Vec3 {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 2;
        const r = this.config.torusMinorRadius * Math.sqrt(Math.random());

        const torusX = (this.config.torusMajorRadius + r * Math.cos(phi)) * Math.cos(theta);
        const torusY = (this.config.torusMajorRadius + r * Math.cos(phi)) * Math.sin(theta);
        const torusZ = r * Math.sin(phi);

        const cosRot = Math.cos(this.config.torusRotationX);
        const sinRot = Math.sin(this.config.torusRotationX);

        return {
            x: torusX,
            y: torusY * cosRot - torusZ * sinRot,
            z: torusY * sinRot + torusZ * cosRot
        };
    }

    private applyCloudRepulsion(instance: CloudInstance, allInstances: CloudInstance[], force: Vec3): void {
        for (const other of allInstances) {
            if (other === instance) continue;

            const dx = instance.position.x - other.position.x;
            const dy = instance.position.y - other.position.y;
            const dz = instance.position.z - other.position.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            const minDist = 50;

            if (distSq < minDist * minDist && distSq > 0.01) {
                const dist = Math.sqrt(distSq);
                const strength = this.config.repulsionStrength * (1 - dist / minDist);
                force.x += (dx / dist) * strength;
                force.y += (dy / dist) * strength;
                force.z += (dz / dist) * strength;
            }
        }
    }

    private applyTorusSurfaceRepulsion(instance: CloudInstance, force: Vec3): void {
        const pos = instance.position;
        const cosRot = Math.cos(this.config.torusRotationX);
        const sinRot = Math.sin(this.config.torusRotationX);

        const torusY = pos.y * cosRot + pos.z * sinRot;
        const torusZ = -pos.y * sinRot + pos.z * cosRot;

        const distFromCenter = Math.sqrt(pos.x * pos.x + torusY * torusY);
        const ringDist = Math.abs(distFromCenter - this.config.torusMajorRadius);
        const vertDist = Math.abs(torusZ);
        const distFromSurface = Math.sqrt(ringDist * ringDist + vertDist * vertDist);

        if (distFromSurface > this.config.torusMinorRadius * 0.7) {
            const excess = distFromSurface - this.config.torusMinorRadius * 0.7;
            const strength = this.config.surfaceRepulsionStrength * excess;

            const theta = Math.atan2(torusY, pos.x);
            const towardCenterTorus = {
                x: this.config.torusMajorRadius * Math.cos(theta) - pos.x,
                y: this.config.torusMajorRadius * Math.sin(theta) - torusY,
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
        const cosRot = Math.cos(this.config.torusRotationX);
        const sinRot = Math.sin(this.config.torusRotationX);

        const torusY = pos.y * cosRot + pos.z * sinRot;
        const distFromCenter = Math.sqrt(pos.x * pos.x + torusY * torusY);

        if (distFromCenter > 0.01) {
            const tangentX = -torusY / distFromCenter;
            const tangentY = pos.x / distFromCenter;

            force.x += tangentX * this.config.angularAcceleration;
            force.y += (tangentY * cosRot) * this.config.angularAcceleration;
            force.z += (tangentY * sinRot) * this.config.angularAcceleration;
        }
    }
}
