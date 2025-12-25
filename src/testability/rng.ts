export interface RNG {
    random(): number;
    pickRandom<T>(arr: readonly T[]): T;
    randomInRange(min: number, max: number): number;
}

export class SeededRNG implements RNG {
    private seed: number;
    private initialSeed: number;

    constructor(seed: number) {
        this.initialSeed = seed >>> 0;
        this.seed = this.initialSeed;
    }

    random(): number {
        // Mulberry32 - fast, good distribution
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    pickRandom<T>(arr: readonly T[]): T {
        if (arr.length === 0) throw new Error('Cannot pick from empty array');
        return arr[Math.floor(this.random() * arr.length)];
    }

    randomInRange(min: number, max: number): number {
        return min + this.random() * (max - min);
    }

    getSeed(): number {
        return this.seed;
    }

    getInitialSeed(): number {
        return this.initialSeed;
    }

    reset(): void {
        this.seed = this.initialSeed;
    }
}

export class SystemRNG implements RNG {
    random(): number {
        return Math.random();
    }

    pickRandom<T>(arr: readonly T[]): T {
        if (arr.length === 0) throw new Error('Cannot pick from empty array');
        return arr[Math.floor(Math.random() * arr.length)];
    }

    randomInRange(min: number, max: number): number {
        return min + Math.random() * (max - min);
    }
}

export interface DualRNG {
    model: RNG;     // State-affecting decisions (recorded for replay)
    cosmetic: RNG;  // Presentation-only choices (not recorded)
}

export function createDualRNG(modelSeed?: number): DualRNG {
    return {
        model: modelSeed !== undefined ? new SeededRNG(modelSeed) : new SystemRNG(),
        cosmetic: new SystemRNG(),
    };
}

export function createSeededDualRNG(modelSeed: number, cosmeticSeed: number): DualRNG {
    return {
        model: new SeededRNG(modelSeed),
        cosmetic: new SeededRNG(cosmeticSeed),
    };
}
