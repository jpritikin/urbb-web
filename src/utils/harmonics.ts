export interface HarmonicParams {
    amplitude: number;
    frequency: number;
    phase: number;
}

export class NormalizedHarmonics {
    harmonics: HarmonicParams[];
    baseRadius: number;
    offset: number;

    constructor(harmonics: HarmonicParams[], baseRadius: number) {
        this.harmonics = harmonics;
        this.baseRadius = baseRadius;

        let minValue = 0;
        for (let testAngle = 0; testAngle < Math.PI * 2; testAngle += 0.1) {
            let value = 0;
            for (const h of harmonics) {
                value += h.amplitude * Math.sin(h.frequency * testAngle + h.phase);
            }
            minValue = Math.min(minValue, value);
        }
        this.offset = this.baseRadius - minValue;
    }

    evaluate(angle: number, rotation: number = 0): number {
        let value = 0;
        for (const h of this.harmonics) {
            value += h.amplitude * Math.sin(h.frequency * (angle + rotation) + h.phase);
        }
        return value + this.offset;
    }

    getRange(startAngle: number = 0, endAngle: number = Math.PI * 2, rotation: number = 0): { min: number; max: number } {
        let minRadius = Infinity;
        let maxRadius = -Infinity;

        for (let testAngle = startAngle; testAngle <= endAngle; testAngle += 0.1) {
            const radius = this.evaluate(testAngle, rotation);
            minRadius = Math.min(minRadius, radius);
            maxRadius = Math.max(maxRadius, radius);
        }

        return { min: minRadius, max: maxRadius };
    }
}

export function generateHarmonics(count: number, freq: number, ampl: number): HarmonicParams[] {
    const harmonics: HarmonicParams[] = [];
    const weights: number[] = [];
    let totalWeight = 0;

    for (let i = 0; i < count; i++) {
        const weight = Math.random();
        weights.push(weight);
        totalWeight += weight;
    }

    for (let i = 0; i < count; i++) {
        let ph = Math.random() * Math.PI * 2;
        if (freq == 0) ph = Math.PI / 2;
        harmonics.push({
            amplitude: (weights[i] / totalWeight) * ampl,
            frequency: freq,
            phase: ph
        });
    }
    return harmonics;
}

export function getRandomInt(min: number, max: number): number {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (1 + max - min)) + min;
}
