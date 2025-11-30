type SliderMode = 'horizontal' | 'vertical';


class ImageSlider {
    private container: HTMLElement;
    private overlay: HTMLElement;
    private slider: HTMLElement;
    private sliderButton: HTMLElement;
    private sliderSvg: SVGElement;
    private baseImg: HTMLImageElement;
    private overlayImg: HTMLImageElement;
    private isDragging = false;
    private onManipulated?: () => void;
    private mode: SliderMode;
    private holdStartTime: number | null = null;
    private holdTimer: number | null = null;
    private clipBase: boolean;
    private audio: HTMLAudioElement | null = null;
    private audioStarted = false;
    private audioUnlockPrompt: HTMLButtonElement | null = null;
    private lastCathedralPercentage = 0;

    constructor(containerId: string, onManipulated?: () => void) {
        const pageVersion = document.querySelector('meta[name="page-version"]')?.getAttribute('content') || 'unknown';
        console.log('[ImageSlider] Page version:', pageVersion);

        const container = document.querySelector(containerId);
        if (!container) throw new Error(`Container ${containerId} not found`);

        this.container = container as HTMLElement;
        this.overlay = this.container.querySelector('.image-overlay')!;
        this.slider = this.container.querySelector('.slider')!;
        this.sliderButton = this.slider.querySelector('div')!;
        this.sliderSvg = this.sliderButton.querySelector('svg')!;
        this.baseImg = this.container.querySelector('.image-base')!;
        this.overlayImg = this.container.querySelector('.image-overlay-img')!;
        this.audio = document.getElementById('cathedral-audio') as HTMLAudioElement;
        this.onManipulated = onManipulated;

        // 10% chance to start in vertical mode, 90% horizontal
        this.mode = Math.random() < 0.1 ? 'vertical' : 'horizontal';

        this.clipBase = Math.random() < 0.25; // another variation

        this.applyModeStyles();

        this.syncImageSizes();
        this.attachEventListeners();

        window.addEventListener('resize', () => this.syncImageSizes());
        this.baseImg.addEventListener('load', () => this.syncImageSizes());

        if (this.audio) {
            this.createAudioUnlockPrompt();
        }
    }

    private createAudioUnlockPrompt(): void {
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (!isMobile) {
            // On desktop, mark as ready (will start when slider reaches 90%)
            this.audioStarted = true;
            return;
        }

        // Create speaker button (mobile only)
        this.audioUnlockPrompt = document.createElement('button');
        this.audioUnlockPrompt.setAttribute('aria-label', 'Enable audio');
        this.audioUnlockPrompt.style.cssText = 'position:fixed;top:1rem;left:1rem;width:3rem;height:3rem;border-radius:0.5rem;background:rgb(228 228 231);border:none;cursor:pointer;z-index:50;display:flex;align-items:center;justify-content:center;transition:background 0.3s;opacity:0.5;';

        // Muted speaker icon SVG (with X)
        this.audioUnlockPrompt.innerHTML = `<svg class="w-6 h-6" fill="none" stroke="rgb(161 161 170)" viewBox="0 0 24 24" style="width:1.5rem;height:1.5rem;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path>
        </svg>`;

        // Add to body
        document.body.appendChild(this.audioUnlockPrompt);

        // Add dark mode support
        const htmlElement = document.documentElement;
        const updateColors = () => {
            if (htmlElement.classList.contains('dark')) {
                this.audioUnlockPrompt!.style.background = 'rgb(63 63 70)';
                const svg = this.audioUnlockPrompt!.querySelector('svg');
                if (svg) svg.setAttribute('stroke', 'rgb(113 113 122)');
            } else {
                this.audioUnlockPrompt!.style.background = 'rgb(228 228 231)';
                const svg = this.audioUnlockPrompt!.querySelector('svg');
                if (svg) svg.setAttribute('stroke', 'rgb(161 161 170)');
            }
        };
        updateColors();

        const observer = new MutationObserver(updateColors);
        observer.observe(htmlElement, { attributes: true, attributeFilter: ['class'] });

        this.audioUnlockPrompt.addEventListener('click', () => {
            console.log('[AudioUnlock] User tapped speaker button');
            if (this.audio) {
                this.audio.volume = 0;
                this.audio.play().then(() => {
                    console.log('[AudioUnlock] Audio started successfully');
                    this.audioStarted = true;
                    if (this.audioUnlockPrompt) {
                        this.audioUnlockPrompt.remove();
                        this.audioUnlockPrompt = null;
                    }
                    observer.disconnect();

                    // Immediately update volume based on current slider position
                    console.log('[AudioUnlock] Updating volume for current position:', this.lastCathedralPercentage);
                    this.updateAudioVolume(this.lastCathedralPercentage);
                }).catch(err => {
                    console.log('[AudioUnlock] Failed:', err.message);
                });
            }
        });
    }

    private requestAudioAttention(): void {
        if (!this.audioUnlockPrompt || this.audioStarted) return;

        // Add blinking animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes audio-blink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.3; }
            }
        `;
        document.head.appendChild(style);
        this.audioUnlockPrompt.style.animation = 'audio-blink 1s ease-in-out infinite';
    }

    private syncImageSizes(): void {
        const rect = this.baseImg.getBoundingClientRect();
        this.overlayImg.style.width = `${rect.width}px`;
        this.overlayImg.style.height = `${rect.height}px`;
    }


    private updateAudioVolume(cathedralPercentage: number): void {
        if (!this.audio) {
            console.log('[updateAudioVolume] No audio element');
            return;
        }

        // Store the current percentage for later use
        this.lastCathedralPercentage = cathedralPercentage;

        // If user wants audio but it's not started yet, blink the button
        if (!this.audioStarted && cathedralPercentage >= 90) {
            console.log('[updateAudioVolume] Audio needed but not started, requesting attention');
            this.requestAudioAttention();
            return;
        }

        if (!this.audioStarted) {
            console.log('[updateAudioVolume] Audio not started yet, percentage:', cathedralPercentage);
            return;
        }

        console.log('[updateAudioVolume] percentage:', cathedralPercentage);

        if (cathedralPercentage < 90) {
            if (!this.audio.paused) {
                this.audio.pause();
            }
            this.container.classList.remove('audio-playing');
        } else {
            const fadeRange = 100 - 90;
            const fadeProgress = (cathedralPercentage - 90) / fadeRange;
            this.audio.volume = fadeProgress;

            if (this.audio.paused) {
                this.audio.play().catch(err => console.log('[updateAudioVolume] Play failed:', err.message));
            }

            console.log('[updateAudioVolume] Set volume to:', fadeProgress, 'paused:', this.audio.paused);
            this.container.classList.add('audio-playing');
        }
    }

    private applyModeStyles(): void {
        const cursor = this.mode === 'horizontal' ? 'ew-resize' : 'ns-resize';
        this.container.style.cursor = cursor;
        this.sliderButton.style.cursor = cursor;

        if (this.mode === 'horizontal') {
            this.slider.style.left = '50%';
            this.slider.style.top = '';
            this.slider.style.width = '4px';
            this.slider.style.height = '100%';
            this.overlayImg.style.clipPath = this.clipBase ? 'inset(0 0 0 50%)' : 'inset(0 50% 0 0)';
            this.sliderSvg.style.transform = 'rotate(0deg)';
        } else {
            this.slider.style.top = '50%';
            this.slider.style.left = '';
            this.slider.style.width = '100%';
            this.slider.style.height = '4px';
            this.overlayImg.style.clipPath = this.clipBase ? 'inset(50% 0 0 0)' : 'inset(0 0 50% 0)';
            this.sliderSvg.style.transform = 'rotate(90deg)';
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
        console.log('[startDragging] Called');
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

            let cathedralPercentage: number;
            if (this.clipBase) {
                const clipLeft = position;
                this.overlayImg.style.clipPath = `inset(0 0 0 ${clipLeft}%)`;
                cathedralPercentage = 100 - position;
            } else {
                const clipRight = 100 - position;
                this.overlayImg.style.clipPath = `inset(0 ${clipRight}% 0 0)`;
                cathedralPercentage = position;
            }

            const imgLeftOffset = ((imgRect.left - containerRect.left) / containerRect.width) * 100;
            const imgWidthPercent = (imgRect.width / containerRect.width) * 100;
            const sliderPosition = imgLeftOffset + (position * imgWidthPercent / 100);

            this.slider.style.left = `${sliderPosition}%`;
            this.updateAudioVolume(cathedralPercentage);
        } else {
            // Vertical mode
            let position = ((clientY - imgRect.top) / imgRect.height) * 100;
            position = Math.max(0, Math.min(100, position));

            let cathedralPercentage: number;
            if (this.clipBase) {
                const clipTop = position;
                this.overlayImg.style.clipPath = `inset(${clipTop}% 0 0 0)`;
                cathedralPercentage = 100 - position;
            } else {
                const clipBottom = 100 - position;
                this.overlayImg.style.clipPath = `inset(0 0 ${clipBottom}% 0)`;
                cathedralPercentage = position;
            }

            const imgTopOffset = ((imgRect.top - containerRect.top) / containerRect.height) * 100;
            const imgHeightPercent = (imgRect.height / containerRect.height) * 100;
            const sliderPosition = imgTopOffset + (position * imgHeightPercent / 100);

            this.slider.style.top = `${sliderPosition}%`;
            this.updateAudioVolume(cathedralPercentage);
        }
    }
}

export default ImageSlider;
