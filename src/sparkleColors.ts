import { HSLColor } from './colorUtils.js';

export interface SparkleColor {
    hue: number;
    saturation: number;
    lightness: number;
}

const WHITE: SparkleColor = { hue: 0, saturation: 0, lightness: 100 };

export function generateSpacedColors(count: number, fillColor: HSLColor): SparkleColor[] {
    const colors: SparkleColor[] = [];
    const coloredCount = Math.ceil(count / 2);
    const excludeRange = 36;
    const availableRange = 360 - excludeRange;
    const spacing = availableRange / coloredCount;
    const offset = (fillColor.h + excludeRange / 2) % 360;

    for (let i = 0; i < count; i++) {
        const isWhite = i < count / 2;
        if (isWhite) {
            colors.push(WHITE);
        } else {
            const hueIndex = i - Math.floor(count / 2);
            const hue = (offset + hueIndex * spacing) % 360;
            colors.push({ hue, saturation: fillColor.s, lightness: 85 });
        }
    }
    return colors;
}

export class SparkleColorGenerator {
    private fillHue: number;
    private fillSaturation: number;

    constructor(fillColor: HSLColor) {
        this.fillHue = fillColor.h;
        this.fillSaturation = fillColor.s;
    }

    generateRandom(): SparkleColor {
        const isWhite = Math.random() < 0.5;
        if (isWhite) {
            return WHITE;
        }
        return {
            hue: this.pickRandomHue(),
            saturation: this.fillSaturation,
            lightness: 85
        };
    }

    private pickRandomHue(): number {
        const excludeRange = 36;
        const offset = (this.fillHue + excludeRange / 2) % 360;
        const randomOffset = Math.random() * (360 - excludeRange);
        return (offset + randomOffset) % 360;
    }
}
