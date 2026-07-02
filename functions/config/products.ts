export type Fulfillment = 'acutrack' | 'lulu' | 'printful';

export interface StripeProductIds {
    live: string;
    test: string;
}

export interface ProductConfig {
    name: string;
    fulfillment: Fulfillment;
    stripeProductId: StripeProductIds;
    shippable: boolean;
    printfulVariantId?: number | null;
    variants?: Record<string, { printfulVariantId: number; stripeProductId: StripeProductIds }>;
}

export function resolveStripeProductId(ids: StripeProductIds, environment: string | undefined): string {
    return environment === 'production' ? ids.live : ids.test;
}

export const PRODUCTS: Record<string, ProductConfig> = {
    'cipher-lottery-ticket': {
        name: 'Cipher Lottery Ticket',
        fulfillment: 'printful',
        stripeProductId: { live: 'prod_UoUvpsKkDemIhA', test: 'prod_UoWIGifoLj0r2A' },
        printfulVariantId: 5154146194,
        shippable: true,
    },
    'inquiry-journal': {
        name: 'Official Way of Open Inquiry Journal',
        fulfillment: 'printful',
        stripeProductId: { live: 'prod_UoUv4TPznIErsx', test: 'prod_UoWIaIn8se5kVp' },
        printfulVariantId: 5154151126,
        shippable: true,
    },
    'ceremonial-water-bottle': {
        name: 'Ceremonial Water Bottle',
        fulfillment: 'printful',
        stripeProductId: { live: '', test: '' }, // variant-specific, see variants below
        printfulVariantId: null,
        shippable: true,
        variants: {
            '32oz': {
                printfulVariantId: 5154151476,
                stripeProductId: { live: 'prod_UoUwdH6RMRLYbA', test: 'prod_UoWItm8PrpdSyJ' },
            },
            '17oz': {
                printfulVariantId: 5154152044,
                stripeProductId: { live: 'prod_UoUwG2eEUC0bdg', test: 'prod_UoWItzP5fxA1Ij' },
            },
        },
    },
    'membership-certificate': {
        name: 'Lifetime Membership Certificate',
        fulfillment: 'printful',
        stripeProductId: { live: 'prod_UoUw58s51VErpx', test: 'prod_UoWHn0xfYvkwjZ' },
        printfulVariantId: 5154119508,
        shippable: true,
    },
    'conviction-minimization-magnet': {
        name: 'Conviction Minimization Car Magnet',
        fulfillment: 'printful',
        stripeProductId: { live: 'prod_UoUxOynLhrAhvi', test: 'prod_UoWHw6VcQkiv3q' },
        printfulVariantId: 5154114209,
        shippable: true,
    },
    'paperback': {
        name: 'Religion Unburdened by Belief (Softcover)',
        fulfillment: 'acutrack',
        stripeProductId: { live: 'prod_UoUuGZgkHdAU4l', test: 'prod_UoWJYLR17Vrvds' },
        shippable: true,
    },
    'hardcover': {
        name: 'Religion Unburdened by Belief (Hardcover)',
        fulfillment: 'lulu',
        stripeProductId: { live: 'prod_UoUuNLTAN9PtG3', test: 'prod_UoWJNnAb7TdaNL' },
        shippable: true,
    },
};
