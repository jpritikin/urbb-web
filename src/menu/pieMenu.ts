export interface PieMenuItem {
    id: string;
    label: string;
    shortName: string;
    icon?: string;
    category?: string;
}

export interface PieMenuConfig {
    items: PieMenuItem[];
    radius: number;
    innerRadius: number;
}

export class PieMenu {
    private static activeMenu: PieMenu | null = null;
    private static globalVisibilityCallback: ((visible: boolean) => void) | null = null;

    static setGlobalVisibilityCallback(callback: (visible: boolean) => void): void {
        PieMenu.globalVisibilityCallback = callback;
    }

    private group: SVGGElement | null = null;
    private visible: boolean = false;
    private targetCloudId: string | null = null;
    private targetName: string | null = null;
    private items: PieMenuItem[] = [];
    private radius: number = 75;
    private innerRadius: number = 20;
    private onSelect: ((item: PieMenuItem, cloudId: string) => void) | null = null;
    private onClose: (() => void) | null = null;
    private tooltipElement: SVGGElement | null = null;
    private hoverIndex: number = -1;
    private overlayContainer: SVGGElement | null = null;
    private menuCenterX: number = 0;
    private menuCenterY: number = 0;
    private itemSlices: { group: SVGGElement; highlight: () => void; unhighlight: () => void; select: () => void }[] = [];
    private activeSliceIndex: number = -1;
    private touchMode: 'none' | 'drag' | 'tap' = 'none';
    private boundTouchMove: ((e: TouchEvent) => void) | null = null;
    private boundTouchEnd: ((e: TouchEvent) => void) | null = null;
    private touchStartTime: number = 0;
    private touchStartX: number = 0;
    private touchStartY: number = 0;
    private hasDragged: boolean = false;
    private tapSelectedIndex: number = -1;
    private readonly TAP_THRESHOLD_MS = 300;
    private readonly DRAG_THRESHOLD = 15;

    constructor(private container: SVGGElement) {}

    setOverlayContainer(overlay: SVGGElement): void {
        this.overlayContainer = overlay;
    }

    setItems(items: PieMenuItem[]): void {
        this.items = items;
    }

    getItems(): PieMenuItem[] {
        return this.items;
    }

    setConfig(config: Partial<PieMenuConfig>): void {
        if (config.items) this.items = config.items;
        if (config.radius) this.radius = config.radius;
        if (config.innerRadius) this.innerRadius = config.innerRadius;
    }

    setOnSelect(callback: (item: PieMenuItem, cloudId: string) => void): void {
        this.onSelect = callback;
    }

    setOnClose(callback: () => void): void {
        this.onClose = callback;
    }

    isVisible(): boolean {
        return this.visible;
    }

    getCenter(): { x: number; y: number } {
        return { x: this.menuCenterX, y: this.menuCenterY };
    }

    selectSlice(index: number): boolean {
        if (index < 0 || index >= this.itemSlices.length) return false;
        this.itemSlices[index].select();
        return true;
    }

    getTargetCloudId(): string | null {
        return this.targetCloudId;
    }

    setTargetName(name: string | null): void {
        this.targetName = name;
    }

    show(x: number, y: number, cloudId: string): void {
        this.showInternal(x, y, cloudId, false);
    }

    showWithTouch(x: number, y: number, cloudId: string, touchClientX: number, touchClientY: number): void {
        this.touchStartTime = performance.now();
        this.touchStartX = touchClientX;
        this.touchStartY = touchClientY;
        this.hasDragged = false;
        this.showInternal(x, y, cloudId, true);
        const sliceIndex = this.getSliceIndexFromPoint(touchClientX, touchClientY);
        if (sliceIndex >= 0 && sliceIndex < this.itemSlices.length) {
            this.activeSliceIndex = sliceIndex;
            this.itemSlices[sliceIndex].highlight();
        }
    }

    private showInternal(x: number, y: number, cloudId: string, touchMode: boolean): void {
        if (this.visible) {
            this.hide();
        }

        if (PieMenu.activeMenu && PieMenu.activeMenu !== this) {
            PieMenu.activeMenu.hide();
        }

        PieMenu.activeMenu = this;
        this.targetCloudId = cloudId;
        this.visible = true;
        this.hoverIndex = -1;

        const menuExtent = this.radius + 20;
        const svg = this.container.ownerSVGElement;
        const viewBox = svg?.viewBox.baseVal;
        if (viewBox) {
            x = Math.max(viewBox.x + menuExtent, Math.min(x, viewBox.x + viewBox.width - menuExtent));
            y = Math.max(viewBox.y + menuExtent, Math.min(y, viewBox.y + viewBox.height - menuExtent));
        }

        this.menuCenterX = x;
        this.menuCenterY = y;
        this.itemSlices = [];
        this.activeSliceIndex = -1;
        this.touchMode = touchMode ? 'drag' : 'none';
        this.tapSelectedIndex = -1;
        this.createMenuElements(x, y);

        if (touchMode) {
            this.boundTouchMove = this.handleTouchMove.bind(this);
            this.boundTouchEnd = this.handleTouchEnd.bind(this);
            document.addEventListener('touchmove', this.boundTouchMove, { passive: false });
            document.addEventListener('touchend', this.boundTouchEnd, { passive: false });
        }

        PieMenu.globalVisibilityCallback?.(true);
    }

    hide(): void {
        this.cleanupTouchListeners();
        this.touchMode = 'none';
        this.tapSelectedIndex = -1;
        this.hideTooltip();

        if (this.group && this.group.parentNode) {
            this.group.parentNode.removeChild(this.group);
        }
        this.group = null;
        this.visible = false;
        this.targetCloudId = null;
        if (PieMenu.activeMenu === this) {
            PieMenu.activeMenu = null;
        }
        PieMenu.globalVisibilityCallback?.(false);
        this.onClose?.();
    }

    private createMenuElements(centerX: number, centerY: number): void {
        this.group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.group.setAttribute('class', 'pie-menu');
        this.group.setAttribute('transform', `translate(${centerX}, ${centerY})`);

        const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        backdrop.setAttribute('cx', '0');
        backdrop.setAttribute('cy', '0');
        backdrop.setAttribute('r', String(this.radius + 20));
        backdrop.setAttribute('fill', 'rgba(0, 0, 0, 0.08)');
        backdrop.setAttribute('class', 'pie-menu-backdrop');
        backdrop.setAttribute('pointer-events', 'none');
        this.group.appendChild(backdrop);

        const itemCount = this.items.length;
        const angleStep = (2 * Math.PI) / itemCount;
        const startAngle = -Math.PI / 2;

        for (let i = 0; i < itemCount; i++) {
            const item = this.items[i];
            const angle = startAngle + i * angleStep;
            const labelGroup = this.createLabelItem(item, angle, i);
            this.group.appendChild(labelGroup);
        }

        const centerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        centerCircle.setAttribute('cx', '0');
        centerCircle.setAttribute('cy', '0');
        centerCircle.setAttribute('r', String(this.innerRadius));
        centerCircle.setAttribute('fill', 'rgba(255, 255, 255, 0.95)');
        centerCircle.setAttribute('stroke', '#7b68ee');
        centerCircle.setAttribute('stroke-width', '2');
        centerCircle.setAttribute('class', 'pie-menu-center');
        centerCircle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hide();
        });
        centerCircle.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.hide();
        }, { passive: false });
        this.group.appendChild(centerCircle);

        const closeX = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        closeX.setAttribute('x', '0');
        closeX.setAttribute('y', '4');
        closeX.setAttribute('text-anchor', 'middle');
        closeX.setAttribute('font-size', '16');
        closeX.setAttribute('fill', '#7b68ee');
        closeX.setAttribute('font-weight', 'bold');
        closeX.setAttribute('pointer-events', 'none');
        closeX.textContent = '✕';
        this.group.appendChild(closeX);

        (this.overlayContainer ?? this.container).appendChild(this.group);
    }

    private getSliceIndexFromPoint(clientX: number, clientY: number): number {
        const svg = this.group?.ownerSVGElement;
        if (!svg) return -1;

        const ctm = svg.getScreenCTM();
        if (!ctm) return -1;

        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const svgPt = pt.matrixTransform(ctm.inverse());

        const dx = svgPt.x - this.menuCenterX;
        const dy = svgPt.y - this.menuCenterY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.innerRadius || dist > this.radius + 15) {
            return -1;
        }

        let angle = Math.atan2(dy, dx);
        const startAngle = -Math.PI / 2;
        const itemCount = this.items.length;
        const angleStep = (2 * Math.PI) / itemCount;

        let normalizedAngle = angle - startAngle + angleStep / 2;
        while (normalizedAngle < 0) normalizedAngle += 2 * Math.PI;
        while (normalizedAngle >= 2 * Math.PI) normalizedAngle -= 2 * Math.PI;

        return Math.floor(normalizedAngle / angleStep) % itemCount;
    }

    private handleTouchMove(e: TouchEvent): void {
        if (this.touchMode !== 'drag') return;
        if (e.touches.length === 0) return;
        e.preventDefault();

        const touch = e.touches[0];

        if (!this.hasDragged) {
            const dx = touch.clientX - this.touchStartX;
            const dy = touch.clientY - this.touchStartY;
            if (Math.sqrt(dx * dx + dy * dy) > this.DRAG_THRESHOLD) {
                this.hasDragged = true;
            }
        }

        const sliceIndex = this.getSliceIndexFromPoint(touch.clientX, touch.clientY);

        if (sliceIndex !== this.activeSliceIndex) {
            if (this.activeSliceIndex >= 0 && this.activeSliceIndex < this.itemSlices.length) {
                this.itemSlices[this.activeSliceIndex].unhighlight();
            }
            this.activeSliceIndex = sliceIndex;
            if (sliceIndex >= 0 && sliceIndex < this.itemSlices.length) {
                this.itemSlices[sliceIndex].highlight();
            }
        }
    }

    private handleTouchEnd(e: TouchEvent): void {
        e.preventDefault();
        e.stopPropagation();

        const elapsed = performance.now() - this.touchStartTime;
        const wasQuickTap = elapsed < this.TAP_THRESHOLD_MS && !this.hasDragged;

        if (wasQuickTap) {
            // Switch to tap mode - keep menu open, clear highlight
            if (this.activeSliceIndex >= 0 && this.activeSliceIndex < this.itemSlices.length) {
                this.itemSlices[this.activeSliceIndex].unhighlight();
            }
            this.activeSliceIndex = -1;
            this.cleanupTouchListeners();
            this.touchMode = 'tap';
            return;
        }

        // Drag completed - select if on a slice, otherwise close
        if (this.activeSliceIndex >= 0 && this.activeSliceIndex < this.itemSlices.length) {
            this.itemSlices[this.activeSliceIndex].select();
        } else {
            this.hide();
        }
    }

    private cleanupTouchListeners(): void {
        if (this.boundTouchMove) {
            document.removeEventListener('touchmove', this.boundTouchMove);
            this.boundTouchMove = null;
        }
        if (this.boundTouchEnd) {
            document.removeEventListener('touchend', this.boundTouchEnd);
            this.boundTouchEnd = null;
        }
    }

    private createSlicePath(startAngle: number, endAngle: number, innerR: number, outerR: number): string {
        const startInnerX = innerR * Math.cos(startAngle);
        const startInnerY = innerR * Math.sin(startAngle);
        const endInnerX = innerR * Math.cos(endAngle);
        const endInnerY = innerR * Math.sin(endAngle);
        const startOuterX = outerR * Math.cos(startAngle);
        const startOuterY = outerR * Math.sin(startAngle);
        const endOuterX = outerR * Math.cos(endAngle);
        const endOuterY = outerR * Math.sin(endAngle);

        const largeArc = (endAngle - startAngle) > Math.PI ? 1 : 0;

        return `M ${startInnerX} ${startInnerY}
                L ${startOuterX} ${startOuterY}
                A ${outerR} ${outerR} 0 ${largeArc} 1 ${endOuterX} ${endOuterY}
                L ${endInnerX} ${endInnerY}
                A ${innerR} ${innerR} 0 ${largeArc} 0 ${startInnerX} ${startInnerY} Z`;
    }

    private createLabelItem(item: PieMenuItem, angle: number, index: number): SVGGElement {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'pie-menu-item');
        group.setAttribute('cursor', 'pointer');

        const itemCount = this.items.length;
        const angleStep = (2 * Math.PI) / itemCount;
        const startAngle = angle - angleStep / 2;
        const endAngle = angle + angleStep / 2;
        const sliceGap = 0.02;

        const slicePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        slicePath.setAttribute('d', this.createSlicePath(
            startAngle + sliceGap,
            endAngle - sliceGap,
            this.innerRadius + 4,
            this.radius + 15
        ));
        slicePath.setAttribute('fill', '#fff');
        slicePath.setAttribute('stroke', this.getCategoryColor(item.category, 0.6));
        slicePath.setAttribute('stroke-width', '1.5');
        slicePath.setAttribute('class', 'pie-menu-item-bg');
        group.appendChild(slicePath);

        const textRadius = (this.innerRadius + this.radius + 15) / 2 + 5;
        const textX = textRadius * Math.cos(angle);
        const textY = textRadius * Math.sin(angle);

        // Convert angle to degrees and adjust for text readability
        let rotationDeg = (angle * 180) / Math.PI;
        // Flip text on the left side so it reads left-to-right
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
            rotationDeg += 180;
        }

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(textX));
        text.setAttribute('y', String(textY));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('font-size', '13');
        text.setAttribute('font-weight', '500');
        text.setAttribute('fill', '#333');
        text.setAttribute('class', 'pie-menu-label');
        text.setAttribute('transform', `rotate(${rotationDeg}, ${textX}, ${textY})`);
        text.textContent = item.shortName;
        group.appendChild(text);

        const highlight = () => {
            slicePath.setAttribute('fill', this.getCategoryColor(item.category, 0.2));
            slicePath.setAttribute('stroke', this.getCategoryColor(item.category, 1));
            slicePath.setAttribute('stroke-width', '2');
            this.showTooltip(item.shortName, item.label);
        };

        const unhighlight = () => {
            slicePath.setAttribute('fill', '#fff');
            slicePath.setAttribute('stroke', this.getCategoryColor(item.category, 0.6));
            slicePath.setAttribute('stroke-width', '1.5');
            this.hideTooltip();
        };

        const selectItem = () => {
            if (this.onSelect && this.targetCloudId) {
                this.onSelect(item, this.targetCloudId);
            }
            this.hide();
        };

        this.itemSlices.push({ group, highlight, unhighlight, select: selectItem });

        // Desktop: hover shows tooltip, click selects
        group.addEventListener('mouseenter', highlight);
        group.addEventListener('mouseleave', unhighlight);
        group.addEventListener('click', (e) => {
            e.stopPropagation();
            selectItem();
        });

        // Mobile tap mode: first tap highlights, second tap confirms
        group.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.touchMode === 'tap') {
                if (this.tapSelectedIndex === index) {
                    selectItem();
                } else {
                    if (this.tapSelectedIndex >= 0 && this.tapSelectedIndex < this.itemSlices.length) {
                        this.itemSlices[this.tapSelectedIndex].unhighlight();
                    }
                    this.tapSelectedIndex = index;
                    highlight();
                }
            }
        }, { passive: false });

        return group;
    }

    private getCategoryColor(category: string | undefined, opacity: number): string {
        const colors: Record<string, string> = {
            discovery: `rgba(52, 152, 219, ${opacity})`,
            history: `rgba(230, 126, 34, ${opacity})`,
            relationship: `rgba(231, 76, 60, ${opacity})`,
            role: `rgba(46, 204, 113, ${opacity})`,
            curiosity: `rgba(52, 152, 219, ${opacity})`,
            gratitude: `rgba(255, 182, 193, ${opacity})`
        };
        return colors[category ?? ''] ?? `rgba(155, 89, 182, ${opacity})`;
    }

    private wrapText(text: string, maxWidth: number, fontSize: number): string[] {
        const charWidth = fontSize * 0.55;
        const maxChars = Math.floor(maxWidth / charWidth);

        if (text.length <= maxChars) return [text];

        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (testLine.length <= maxChars) {
                currentLine = testLine;
            } else {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
            }
        }
        if (currentLine) lines.push(currentLine);

        return lines;
    }

    private showTooltip(shortName: string, label: string): void {
        this.hideTooltip();

        if (!this.group) return;

        if (this.targetName) {
            label = label.replace(/\$PART/g, this.targetName);
        }

        this.tooltipElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.tooltipElement.setAttribute('class', 'pie-menu-tooltip');

        const padding = 12;
        const fontSize = 18;
        const lineHeight = fontSize + 6;
        const maxWidth = 400;
        const margin = 10;

        const svg = this.group.ownerSVGElement;
        const viewBox = svg?.viewBox.baseVal;
        const canvasWidth = viewBox?.width ?? 800;
        const canvasHeight = viewBox?.height ?? 600;

        const labelLines = this.wrapText(label, maxWidth, fontSize);
        const totalLines = 1 + labelLines.length;
        const estimatedHeight = totalLines * lineHeight + padding * 2;
        const estimatedWidth = maxWidth + padding * 2;

        const tooltipMargin = 40;
        const spaceBelow = canvasHeight - this.menuCenterY - this.radius - 15;
        const spaceAbove = this.menuCenterY - this.radius - 15;
        const showAbove = spaceBelow < estimatedHeight + tooltipMargin && spaceAbove > spaceBelow;

        let tooltipY = showAbove
            ? -(this.radius + tooltipMargin + estimatedHeight)
            : this.radius + tooltipMargin;

        // Clamp vertical position to canvas bounds
        const absoluteTop = this.menuCenterY + tooltipY;
        const absoluteBottom = absoluteTop + estimatedHeight;
        if (absoluteTop < margin) {
            tooltipY = margin - this.menuCenterY;
        } else if (absoluteBottom > canvasHeight - margin) {
            tooltipY = canvasHeight - margin - estimatedHeight - this.menuCenterY;
        }

        // Clamp horizontal position to canvas bounds
        const halfWidth = estimatedWidth / 2;
        let tooltipX = 0;
        if (this.menuCenterX - halfWidth < margin) {
            tooltipX = margin + halfWidth - this.menuCenterX;
        } else if (this.menuCenterX + halfWidth > canvasWidth - margin) {
            tooltipX = canvasWidth - margin - halfWidth - this.menuCenterX;
        }

        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', String(tooltipX));
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('font-size', String(fontSize));
        textEl.setAttribute('fill', '#fff');
        textEl.setAttribute('pointer-events', 'none');
        textEl.style.userSelect = 'none';

        const boldSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        boldSpan.setAttribute('font-weight', 'bold');
        boldSpan.setAttribute('x', String(tooltipX));
        boldSpan.setAttribute('dy', String(tooltipY + padding + fontSize - 2));
        boldSpan.textContent = shortName;
        textEl.appendChild(boldSpan);

        for (const line of labelLines) {
            const lineSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            lineSpan.setAttribute('x', String(tooltipX));
            lineSpan.setAttribute('dy', String(lineHeight));
            lineSpan.textContent = line;
            textEl.appendChild(lineSpan);
        }

        this.tooltipElement.appendChild(textEl);
        const targetContainer = this.overlayContainer ?? this.group;
        targetContainer.appendChild(this.tooltipElement);
        this.tooltipElement.setAttribute('transform', `translate(${this.menuCenterX}, ${this.menuCenterY})`);

        const bbox = textEl.getBBox();
        const rectWidth = Math.min(bbox.width + padding * 2, maxWidth + padding * 2);
        const rectHeight = bbox.height + padding * 2;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(tooltipX - rectWidth / 2));
        rect.setAttribute('y', String(tooltipY));
        rect.setAttribute('width', String(rectWidth));
        rect.setAttribute('height', String(rectHeight));
        rect.setAttribute('rx', '4');
        rect.setAttribute('fill', 'rgba(0, 0, 0, 0.85)');
        rect.setAttribute('class', 'pie-menu-tooltip-bg');

        this.tooltipElement.insertBefore(rect, textEl);
    }

    private hideTooltip(): void {
        if (this.tooltipElement && this.tooltipElement.parentNode) {
            this.tooltipElement.parentNode.removeChild(this.tooltipElement);
        }
        this.tooltipElement = null;
    }
}
