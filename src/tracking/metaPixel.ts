declare global {
    interface Window {
        fbq: (...args: unknown[]) => void;
        Snipcart: SnipcartGlobal;
    }
}

interface SnipcartGlobal {
    events: {
        on: (event: string, callback: (data: unknown) => void) => void;
    };
    store: {
        getState: () => SnipcartState;
    };
}

interface SnipcartState {
    cart: {
        total: number;
        currency: string;
        items: {
            items: CartItem[];
        };
    };
}

interface CartItem {
    id: string;
    name: string;
    price: number;
    quantity: number;
}

interface CartConfirmResponse {
    token: string;
    total: number;
    currency: string;
    items: {
        items: CartItem[];
    };
}

function trackViewContent(productId: string, productName: string, value: number) {
    window.fbq('track', 'ViewContent', {
        content_ids: [productId],
        content_name: productName,
        content_type: 'product',
        value: value,
        currency: 'USD',
    });
}

function trackAddToCart(item: CartItem) {
    window.fbq('track', 'AddToCart', {
        content_ids: [item.id],
        content_name: item.name,
        content_type: 'product',
        value: item.price * item.quantity,
        currency: 'USD',
    });
}

function trackInitiateCheckout(state: SnipcartState) {
    const items = state.cart.items.items;
    window.fbq('track', 'InitiateCheckout', {
        content_ids: items.map((i) => i.id),
        contents: items.map((i) => ({
            id: i.id,
            quantity: i.quantity,
        })),
        num_items: items.reduce((sum, i) => sum + i.quantity, 0),
        value: state.cart.total,
        currency: state.cart.currency || 'USD',
    });
}

function trackPurchase(response: CartConfirmResponse) {
    const items = response.items.items;
    window.fbq('track', 'Purchase', {
        content_ids: items.map((i) => i.id),
        contents: items.map((i) => ({
            id: i.id,
            quantity: i.quantity,
        })),
        content_type: 'product',
        num_items: items.reduce((sum, i) => sum + i.quantity, 0),
        value: response.total,
        currency: response.currency.toUpperCase(),
    });
}

function initSnipcartTracking() {
    const snipcart = window.Snipcart;
    if (!snipcart?.events) return;

    snipcart.events.on('item.added', (data: unknown) => {
        const item = data as CartItem;
        trackAddToCart(item);
    });

    snipcart.events.on('summary.checkout_clicked', () => {
        const state = snipcart.store.getState();
        trackInitiateCheckout(state);
    });

    snipcart.events.on('cart.confirmed', (data: unknown) => {
        const response = data as CartConfirmResponse;
        trackPurchase(response);
    });
}

export function initMetaPixelTracking() {
    if (typeof window.fbq !== 'function') return;

    document.querySelectorAll('.snipcart-add-item').forEach((button) => {
        button.addEventListener('click', () => {
            const id = button.getAttribute('data-item-id');
            const name = button.getAttribute('data-item-name');
            const price = parseFloat(button.getAttribute('data-item-price') || '0');
            if (id && name) {
                trackViewContent(id, name, price);
            }
        });
    });

    if (window.Snipcart) {
        initSnipcartTracking();
    } else {
        document.addEventListener('snipcart.ready', () => initSnipcartTracking());
    }
}
