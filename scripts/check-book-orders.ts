#!/usr/bin/env npx ts-node
// Polls Stripe for checkout.session.completed events containing Acutrack/Lulu
// book line items and prints new orders to stdout (cron emails stdout output).
// Usage: ts-node check-book-orders.ts [--dry-run]
//   --dry-run  print new orders without advancing the cursor
// Env vars: STRIPE_SECRET_KEY (env or .env file)
//
// Cron entry:
//   */15 * * * * cd /home/joshua/urbb-web && npx ts-node scripts/check-book-orders.ts

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PRODUCTS, resolveStripeProductId } from "../functions/config/products";

const CURSOR_FILE = path.join(os.homedir(), ".urbb-book-orders-cursor");

interface StripeEvent {
    id: string;
    created: number;
    type: string;
    data: { object: { id: string } };
}

interface StripeAddress {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
}

interface StripeSession {
    id: string;
    created: number;
    customer_details: { name: string; email: string; address: StripeAddress };
    shipping_details?: { name: string; address: StripeAddress };
}

interface StripeLineItem {
    quantity: number;
    price: { product: { id: string; name: string } };
}

// Live orders only; this cron script never watches test-mode purchases.
const BOOK_STRIPE_PRODUCT_IDS = new Map<string, { productKey: string; fulfillment: "acutrack" | "lulu" }>();
for (const [productKey, product] of Object.entries(PRODUCTS)) {
    if (product.fulfillment === "acutrack" || product.fulfillment === "lulu") {
        BOOK_STRIPE_PRODUCT_IDS.set(resolveStripeProductId(product.stripeProductId, "production"), { productKey, fulfillment: product.fulfillment });
    }
}

function loadEnvFile() {
    const envPath = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
}

function getSecretKey(): string {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("Missing STRIPE_SECRET_KEY (set in environment or .env file)");
    return key;
}

function readCursor(): number {
    if (!fs.existsSync(CURSOR_FILE)) return 0;
    const raw = fs.readFileSync(CURSOR_FILE, "utf-8").trim();
    return raw ? parseInt(raw, 10) : 0;
}

function writeCursor(timestamp: number) {
    fs.writeFileSync(CURSOR_FILE, String(timestamp));
}

async function stripeGet<T>(url: string, secretKey: string): Promise<T> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${secretKey}` } });
    if (!res.ok) throw new Error(`Stripe API error ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
}

async function fetchCompletedSessionsSince(sinceTimestamp: number, secretKey: string): Promise<StripeEvent[]> {
    const events: StripeEvent[] = [];
    let startingAfter: string | undefined;

    for (;;) {
        const params = new URLSearchParams({
            type: "checkout.session.completed",
            "created[gt]": String(sinceTimestamp),
            limit: "100",
        });
        if (startingAfter) params.set("starting_after", startingAfter);

        const page = await stripeGet<{ data: StripeEvent[]; has_more: boolean }>(
            `https://api.stripe.com/v1/events?${params}`,
            secretKey
        );
        events.push(...page.data);
        if (!page.has_more) break;
        startingAfter = page.data[page.data.length - 1].id;
    }

    return events.sort((a, b) => a.created - b.created);
}

async function fetchLineItems(sessionId: string, secretKey: string): Promise<StripeLineItem[]> {
    const data = await stripeGet<{ data: StripeLineItem[] }>(
        `https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?expand[]=data.price.product&limit=100`,
        secretKey
    );
    return data.data;
}

function formatAddress(address: StripeAddress): string {
    const line2 = address.line2 ? `, ${address.line2}` : "";
    return `${address.line1}${line2}, ${address.city}, ${address.state} ${address.postal_code}, ${address.country}`;
}

async function main() {
    loadEnvFile();
    const dryRun = process.argv.includes("--dry-run");
    const secretKey = getSecretKey();

    const since = readCursor();
    const events = await fetchCompletedSessionsSince(since, secretKey);

    let latestTimestamp = since;
    const reports: string[] = [];

    for (const event of events) {
        latestTimestamp = Math.max(latestTimestamp, event.created);

        const session = await stripeGet<StripeSession>(
            `https://api.stripe.com/v1/checkout/sessions/${event.data.object.id}`,
            secretKey
        );
        const lineItems = await fetchLineItems(session.id, secretKey);

        const bookItems = lineItems
            .map((li) => {
                const match = BOOK_STRIPE_PRODUCT_IDS.get(li.price.product.id);
                if (!match) return null;
                return { name: li.price.product.name, quantity: li.quantity, fulfillment: match.fulfillment };
            })
            .filter((item): item is { name: string; quantity: number; fulfillment: "acutrack" | "lulu" } => item !== null);

        if (bookItems.length === 0) continue;

        const address = session.shipping_details?.address ?? session.customer_details.address;
        const name = session.shipping_details?.name ?? session.customer_details.name;
        const date = new Date(session.created * 1000).toISOString();

        for (const provider of new Set(bookItems.map((i) => i.fulfillment))) {
            const items = bookItems.filter((i) => i.fulfillment === provider);
            reports.push(
                [
                    `Order ID: ${session.id}`,
                    `Date: ${date}`,
                    `Customer: ${name}`,
                    `Email: ${session.customer_details.email}`,
                    `Shipping address: ${formatAddress(address)}`,
                    `Items: ${items.map((i) => `${i.name} x${i.quantity}`).join(", ")}`,
                    `Fulfillment: ${provider}`,
                ].join("\n")
            );
        }
    }

    if (reports.length > 0) {
        console.log(reports.join("\n\n---\n\n"));
    }

    if (!dryRun) writeCursor(latestTimestamp);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
