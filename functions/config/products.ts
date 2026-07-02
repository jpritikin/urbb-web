export type Fulfillment = 'acutrack' | 'lulu' | 'printful';

export interface ProductConfig {
    name: string;
    fulfillment: Fulfillment;
    stripePriceId: string;
    shippable: boolean;
    printfulVariantId?: number | null;
    variants?: Record<string, number>; // custom field value → printful variant ID
}

export const PRODUCTS: Record<string, ProductConfig> = {
    'cipher-lottery-ticket': {
        name: 'Cipher Lottery Ticket',
        fulfillment: 'printful',
        stripePriceId: '',
        printfulVariantId: 5154146194,
        shippable: true,
    },
    'inquiry-journal': {
        name: 'Official Way of Open Inquiry Journal',
        fulfillment: 'printful',
        stripePriceId: '',
        printfulVariantId: 5154151126,
        shippable: true,
    },
    'ceremonial-water-bottle': {
        name: 'Ceremonial Water Bottle',
        fulfillment: 'printful',
        stripePriceId: '',
        printfulVariantId: null,
        shippable: true,
        variants: {
            '32oz': 5154151476,
            '17oz': 5154152044,
        },
    },
    'membership-certificate': {
        name: 'Lifetime Membership Certificate',
        fulfillment: 'printful',
        stripePriceId: '',
        printfulVariantId: 5154119508,
        shippable: true,
    },
    'conviction-minimization-magnet': {
        name: 'Conviction Minimization Car Magnet',
        fulfillment: 'printful',
        stripePriceId: '',
        printfulVariantId: 5154114209,
        shippable: true,
    },
    'paperback': {
        name: 'Religion Unburdened by Belief (Softcover)',
        fulfillment: 'acutrack',
        stripePriceId: '',
        shippable: true,
    },
    'hardcover': {
        name: 'Religion Unburdened by Belief (Hardcover)',
        fulfillment: 'lulu',
        stripePriceId: '',
        shippable: true,
    },
};
