export interface BubbleLayout {
    bubbleX: number;
    bubbleY: number;
    bubbleWidth: number;
    bubbleHeight: number;
    tailDirX: number;
    tailDirY: number;
    textHeight: number;
    lines: string[];
}

export interface BubbleConfig {
    padding: number;
    fontSize: number;
    maxWidth: number;
    lineHeight: number;
    tailLength: number;
    margin: number;
    charWidthFactor: number;
}

export const THOUGHT_BUBBLE_CONFIG: BubbleConfig = {
    padding: 12,
    fontSize: 16,
    maxWidth: 200,
    lineHeight: 20,
    tailLength: 50,
    margin: 10,
    charWidthFactor: 0.55,
};

export const MESSAGE_BUBBLE_CONFIG: BubbleConfig = {
    padding: 8,
    fontSize: 13,
    maxWidth: 120,
    lineHeight: 15,
    tailLength: 0,
    margin: 10,
    charWidthFactor: 0.5,
};

export function wrapText(text: string, maxWidth: number, fontSize: number, charWidthFactor: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (testLine.length * fontSize * charWidthFactor > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
}

export function computeBubbleSize(
    text: string,
    config: BubbleConfig
): { width: number; height: number; lines: string[]; textHeight: number } {
    const lines = wrapText(text, config.maxWidth, config.fontSize, config.charWidthFactor);
    const textHeight = lines.length * config.lineHeight;
    const textWidth = Math.min(
        config.maxWidth,
        Math.max(...lines.map(l => l.length * config.fontSize * config.charWidthFactor))
    );
    return {
        width: textWidth + config.padding * 2,
        height: textHeight + config.padding * 2,
        lines,
        textHeight,
    };
}

export function computeBubblePlacement(
    anchorX: number,
    anchorY: number,
    bubbleWidth: number,
    bubbleHeight: number,
    canvasWidth: number,
    canvasHeight: number,
    config: BubbleConfig
): { bubbleX: number; bubbleY: number; tailDirX: number; tailDirY: number } {
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    const dx = anchorX - centerX;
    const dy = anchorY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dirX = dist > 0 ? dx / dist : 0;
    const dirY = dist > 0 ? dy / dist : -1;

    let bubbleX = anchorX + dirX * (config.tailLength + bubbleWidth / 2);
    let bubbleY = anchorY + dirY * (config.tailLength + bubbleHeight / 2);

    bubbleX = Math.max(config.margin + bubbleWidth / 2, Math.min(canvasWidth - config.margin - bubbleWidth / 2, bubbleX));
    bubbleY = Math.max(config.margin + bubbleHeight / 2, Math.min(canvasHeight - config.margin - bubbleHeight / 2, bubbleY));

    const tailDx = bubbleX - anchorX;
    const tailDy = bubbleY - anchorY;
    const tailDist = Math.sqrt(tailDx * tailDx + tailDy * tailDy);
    const tailDirX = tailDist > 0 ? tailDx / tailDist : 0;
    const tailDirY = tailDist > 0 ? tailDy / tailDist : -1;

    return { bubbleX, bubbleY, tailDirX, tailDirY };
}

export function computeBubbleLayout(
    anchorX: number,
    anchorY: number,
    text: string,
    canvasWidth: number,
    canvasHeight: number,
    config: BubbleConfig
): BubbleLayout {
    const size = computeBubbleSize(text, config);
    const placement = computeBubblePlacement(
        anchorX,
        anchorY,
        size.width,
        size.height,
        canvasWidth,
        canvasHeight,
        config
    );
    return {
        bubbleX: placement.bubbleX,
        bubbleY: placement.bubbleY,
        bubbleWidth: size.width,
        bubbleHeight: size.height,
        tailDirX: placement.tailDirX,
        tailDirY: placement.tailDirY,
        textHeight: size.textHeight,
        lines: size.lines,
    };
}
