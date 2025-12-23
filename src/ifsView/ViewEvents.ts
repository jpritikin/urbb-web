export type ViewEventMap = {
    'mode-changed': { mode: 'panorama' | 'foreground' };
    'transition-started': { direction: 'forward' | 'reverse' };
    'transition-completed': {};
};

export class ViewEventEmitter {
    private listeners = new Map<keyof ViewEventMap, Set<Function>>();

    on<K extends keyof ViewEventMap>(event: K, listener: (data: ViewEventMap[K]) => void): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(listener);
    }

    off<K extends keyof ViewEventMap>(event: K, listener: Function): void {
        this.listeners.get(event)?.delete(listener);
    }

    emit<K extends keyof ViewEventMap>(event: K, data: ViewEventMap[K]): void {
        this.listeners.get(event)?.forEach(listener => listener(data));
    }
}
