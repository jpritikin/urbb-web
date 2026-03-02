const STORAGE_KEY = 'urbb_cart';

export interface CartItem {
    variantId: string;
    title: string;
    price: number;
    quantity: number;
}

export interface CartState {
    items: CartItem[];
}

type CartListener = (state: CartState) => void;

const listeners: CartListener[] = [];

function load(): CartState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return { items: [] };
}

function save(state: CartState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    listeners.forEach(fn => fn(state));
}

export function getCart(): CartState {
    return load();
}

export function addItem(item: CartItem) {
    const state = load();
    const existing = state.items.find(i => i.variantId === item.variantId);
    if (existing) {
        existing.quantity += item.quantity;
    } else {
        state.items.push({ ...item });
    }
    save(state);
}

export function removeItem(variantId: string) {
    const state = load();
    state.items = state.items.filter(i => i.variantId !== variantId);
    save(state);
}

export function updateQuantity(variantId: string, quantity: number) {
    const state = load();
    const item = state.items.find(i => i.variantId === variantId);
    if (item) {
        item.quantity = quantity;
        if (item.quantity <= 0) state.items = state.items.filter(i => i.variantId !== variantId);
    }
    save(state);
}

export function clearCart() {
    save({ items: [] });
}

export function totalItems(state: CartState): number {
    return state.items.reduce((sum, i) => sum + i.quantity, 0);
}

export function totalPrice(state: CartState): number {
    return state.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
}

export function onCartChange(fn: CartListener) {
    listeners.push(fn);
}
