type SliderMode = 'horizontal' | 'vertical';

class ImageSlider {
  private container: HTMLElement;
  private overlay: HTMLElement;
  private slider: HTMLElement;
  private baseImg: HTMLImageElement;
  private overlayImg: HTMLImageElement;
  private isDragging = false;
  private onManipulated?: () => void;
  private mode: SliderMode;
  private holdStartTime: number | null = null;
  private holdTimer: number | null = null;

  constructor(containerId: string, onManipulated?: () => void) {
    const container = document.querySelector(containerId);
    if (!container) throw new Error(`Container ${containerId} not found`);

    this.container = container as HTMLElement;
    this.overlay = this.container.querySelector('.image-overlay')!;
    this.slider = this.container.querySelector('.slider')!;
    this.baseImg = this.container.querySelector('.image-base')!;
    this.overlayImg = this.container.querySelector('.image-overlay-img')!;
    this.onManipulated = onManipulated;

    // 10% chance to start in vertical mode, 90% horizontal
    this.mode = Math.random() < 0.1 ? 'vertical' : 'horizontal';
    this.applyModeStyles();

    this.syncImageSizes();
    this.attachEventListeners();

    window.addEventListener('resize', () => this.syncImageSizes());
    this.baseImg.addEventListener('load', () => this.syncImageSizes());
  }

  private syncImageSizes(): void {
    const rect = this.baseImg.getBoundingClientRect();
    this.overlayImg.style.width = `${rect.width}px`;
    this.overlayImg.style.height = `${rect.height}px`;
  }

  private applyModeStyles(): void {
    const cursor = this.mode === 'horizontal' ? 'ew-resize' : 'ns-resize';
    this.container.style.cursor = cursor;

    // Reset slider position based on mode
    if (this.mode === 'horizontal') {
      this.slider.style.left = '50%';
      this.slider.style.top = '';
      this.slider.style.width = '4px';
      this.slider.style.height = '100%';
      this.overlayImg.style.clipPath = 'inset(0 50% 0 0)';
    } else {
      this.slider.style.top = '50%';
      this.slider.style.left = '';
      this.slider.style.width = '100%';
      this.slider.style.height = '4px';
      this.overlayImg.style.clipPath = 'inset(0 0 50% 0)';
    }
  }

  private switchMode(): void {
    this.mode = this.mode === 'horizontal' ? 'vertical' : 'horizontal';
    this.applyModeStyles();
  }

  private attachEventListeners(): void {
    this.slider.addEventListener('mousedown', () => this.startDragging());
    document.addEventListener('mouseup', () => this.stopDragging());
    document.addEventListener('mousemove', (e) => this.handleMove(e));

    this.slider.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.startDragging();
    });
    document.addEventListener('touchend', () => this.stopDragging());
    document.addEventListener('touchmove', (e) => this.handleMove(e), { passive: false });

    this.container.addEventListener('click', (e) => {
      if (e.target === this.slider || this.slider.contains(e.target as Node)) return;
      this.updatePosition(e.clientX, e.clientY);
      this.onManipulated?.();
    });
  }

  private startDragging(): void {
    this.isDragging = true;
    const cursor = this.mode === 'horizontal' ? 'ew-resize' : 'ns-resize';
    this.container.style.cursor = cursor;
    this.onManipulated?.();

    // Start tracking hold time
    this.holdStartTime = Date.now();

    // Set timer for 5 seconds - 20% chance to switch modes
    this.holdTimer = window.setTimeout(() => {
      if (this.isDragging && Math.random() < 0.2) {
        this.switchMode();
      }
    }, 5000);
  }

  private stopDragging(): void {
    this.isDragging = false;
    const cursor = this.mode === 'horizontal' ? 'ew-resize' : 'ns-resize';
    this.container.style.cursor = cursor;

    // Clear hold timer
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.holdStartTime = null;
  }

  private handleMove(e: MouseEvent | TouchEvent): void {
    if (!this.isDragging) return;
    e.preventDefault();

    const x = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
    const y = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;
    this.updatePosition(x, y);
  }

  private updatePosition(clientX: number, clientY: number): void {
    const imgRect = this.baseImg.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();

    if (this.mode === 'horizontal') {
      let position = ((clientX - imgRect.left) / imgRect.width) * 100;
      position = Math.max(0, Math.min(100, position));

      const clipRight = 100 - position;
      this.overlayImg.style.clipPath = `inset(0 ${clipRight}% 0 0)`;

      const imgLeftOffset = ((imgRect.left - containerRect.left) / containerRect.width) * 100;
      const imgWidthPercent = (imgRect.width / containerRect.width) * 100;
      const sliderPosition = imgLeftOffset + (position * imgWidthPercent / 100);

      this.slider.style.left = `${sliderPosition}%`;
    } else {
      // Vertical mode
      let position = ((clientY - imgRect.top) / imgRect.height) * 100;
      position = Math.max(0, Math.min(100, position));

      const clipBottom = 100 - position;
      this.overlayImg.style.clipPath = `inset(0 0 ${clipBottom}% 0)`;

      const imgTopOffset = ((imgRect.top - containerRect.top) / containerRect.height) * 100;
      const imgHeightPercent = (imgRect.height / containerRect.height) * 100;
      const sliderPosition = imgTopOffset + (position * imgHeightPercent / 100);

      this.slider.style.top = `${sliderPosition}%`;
    }
  }
}

export default ImageSlider;
