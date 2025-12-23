import { PhysicsEngine } from './physicsEngine.js';
import { CloudInstance } from './types.js';

export class PanoramaController {
    private physicsEngine: PhysicsEngine;

    constructor(physicsEngine: PhysicsEngine) {
        this.physicsEngine = physicsEngine;
    }

    applyPhysics(instance: CloudInstance, allInstances: CloudInstance[], deltaTime: number): void {
        this.physicsEngine.applyPhysics(instance, allInstances, deltaTime);
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
}
