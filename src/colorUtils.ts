export interface HSLColor {
    h: number;
    s: number;
    l: number;
}

export function hexToHSL(hex: string): HSLColor {
    hex = hex.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    if (max === min) return { h: 0, s: 0, l: l * 100 };

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;

    return { h: h * 360, s: s * 100, l: l * 100 };
}

export function getCSSColor(name: string, defaultColor: HSLColor): HSLColor {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (value && value.startsWith('#')) return hexToHSL(value);
    return defaultColor;
}
