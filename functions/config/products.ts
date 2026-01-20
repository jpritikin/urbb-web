export interface ProductConfig {
    snipcartId: string;
    name: string;
    printfulVariantId: number | null;
    shippable: boolean;
    variants?: Record<string, number>; // custom field value → printful variant ID
}

export const PRODUCTS: Record<string, ProductConfig> = {
    'cipher-lottery-ticket': {
        snipcartId: 'cipher-lottery-ticket',
        name: 'Cipher Lottery Ticket',
        printfulVariantId: 5154146194,
        shippable: true,
    },
    'inquiry-journal': {
        snipcartId: 'inquiry-journal',
        name: 'Official Way of Open Inquiry Journal',
        printfulVariantId: 5154151126,
        shippable: true,
    },
    'ceremonial-water-bottle': {
        snipcartId: 'ceremonial-water-bottle',
        name: 'Ceremonial Water Bottle',
        printfulVariantId: null,
        shippable: true,
        variants: {
            '32oz': 5154151476,
            '17oz': 5154152044,
        },
    },
    'membership-certificate': {
        snipcartId: 'membership-certificate',
        name: 'Lifetime Membership Certificate',
        printfulVariantId: 5154119508,
        shippable: true,
    },
    'conviction-minimization-magnet': {
        snipcartId: 'conviction-minimization-magnet',
        name: 'Conviction Minimization Car Magnet',
        printfulVariantId: 5154114209,
        shippable: true,
    },
};
