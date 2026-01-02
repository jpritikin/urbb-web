export interface RngLogEntry {
    label: string;
    value: number;
}

export interface RNG {
    random(purpose?: string): number;
    pickRandom<T>(arr: readonly T[], purpose?: string): T;
    randomInRange(min: number, max: number, purpose?: string): number;
    getCallCount(): number;
    getCallLog(): RngLogEntry[];
}

export class SeededRNG implements RNG {
    private seed: number;
    private initialSeed: number;
    private callCount: number = 0;
    private callLog: RngLogEntry[] = [];

    constructor(seed: number) {
        this.initialSeed = seed >>> 0;
        this.seed = this.initialSeed;
    }

    random(purpose?: string): number {
        this.callCount++;
        // Mulberry32 - fast, good distribution
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        const value = ((t ^ t >>> 14) >>> 0) / 4294967296;
        this.callLog.push({ label: purpose ?? 'random', value });
        return value;
    }

    getCallCount(): number {
        return this.callCount;
    }

    getCallLog(): RngLogEntry[] {
        return [...this.callLog];
    }

    pickRandom<T>(arr: readonly T[], purpose?: string): T {
        if (arr.length === 0) throw new Error('Cannot pick from empty array');
        return arr[Math.floor(this.random(purpose ?? 'pickRandom') * arr.length)];
    }

    randomInRange(min: number, max: number, purpose?: string): number {
        return min + this.random(purpose ?? 'randomInRange') * (max - min);
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
    private callCount: number = 0;
    private callLog: RngLogEntry[] = [];

    random(purpose?: string): number {
        this.callCount++;
        const value = Math.random();
        this.callLog.push({ label: purpose ?? 'random', value });
        return value;
    }

    pickRandom<T>(arr: readonly T[], purpose?: string): T {
        if (arr.length === 0) throw new Error('Cannot pick from empty array');
        return arr[Math.floor(this.random(purpose ?? 'pickRandom') * arr.length)];
    }

    randomInRange(min: number, max: number, purpose?: string): number {
        return min + this.random(purpose ?? 'randomInRange') * (max - min);
    }

    getCallCount(): number {
        return this.callCount;
    }

    getCallLog(): RngLogEntry[] {
        return [...this.callLog];
    }
}

export function pickRandom<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Cannot pick from empty array');
    return arr[Math.floor(Math.random() * arr.length)];
}

export function createModelRNG(seed?: number): RNG {
    return seed !== undefined ? new SeededRNG(seed) : new SystemRNG();
}
