#!/usr/bin/env npx ts-node
// Fetches reviews from a GoodReads book page, filters to 4+ stars, merges any
// new ones into the stored set (existing entries, including odds overrides
// from review-odds.ts, are kept as-is), and uploads the result as JSON to
// Cloudflare R2.
// Usage: ts-node fetch-goodreads-reviews.ts [--dry-run] [--list]
//   --dry-run  print freshly scraped reviews without uploading or merging
//   --list     print currently stored reviews from R2 (or view https://data.unburdened.biz/reviews.json)
//   --force    upload even if no new reviews were found
// Env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

import * as fs from "fs";
import { execSync } from "child_process";
import { chromium } from "playwright";
import { likesToWeight } from "./reviewWeight";

const BOOK_URL =
    "https://www.goodreads.com/book/show/249868833-religion-unburdened-by-belief";
const R2_BUCKET = "goodreads";
const R2_OBJECT_KEY = "reviews.json";
const MIN_STARS = 4;

interface Review {
    reviewer: string;
    reviewerUrl: string;
    stars: number;
    date: string;
    reviewUrl: string;
    text: string;
    likes: number;
    weight: number;
    weightOverride?: number;
}

async function fetch(url: string): Promise<string> {
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage({
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector("article.ReviewCard", { timeout: 60000 });
        return await page.content();
    } finally {
        await browser.close();
    }
}

interface ApolloReview {
    __typename?: string;
    text?: string;
    rating?: number;
    createdAt?: number;
    likeCount?: number;
    creator?: { __ref?: string };
    shelving?: { webUrl?: string };
}

interface ApolloUser {
    __typename?: string;
    name?: string;
    webUrl?: string;
}

function formatDate(epochMillis: number): string {
    return new Date(epochMillis).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    });
}

// Reviews, ratings, like counts, and reviewer info are all embedded as
// Apollo cache state in the page's __NEXT_DATA__ script tag, so we read
// structured data directly rather than parsing rendered DOM markup.
function parseReviews(html: string): Review[] {
    const nextDataMatch = html.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (!nextDataMatch) return [];

    const apolloState: Record<string, ApolloReview | ApolloUser> =
        JSON.parse(nextDataMatch[1])?.props?.pageProps?.apolloState ?? {};

    const reviews: Review[] = [];
    for (const value of Object.values(apolloState)) {
        if (value.__typename !== "Review") continue;
        const r = value as ApolloReview;
        const reviewUrl = r.shelving?.webUrl ?? "";
        if (!reviewUrl || r.rating == null || !r.creator?.__ref) continue;

        const user = apolloState[r.creator.__ref] as ApolloUser | undefined;
        const text = (r.text ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
        const likes = r.likeCount ?? 0;

        reviews.push({
            reviewer: (user?.name ?? "").trim(),
            reviewerUrl: user?.webUrl ?? "",
            stars: r.rating,
            date: r.createdAt != null ? formatDate(r.createdAt) : "",
            reviewUrl,
            text,
            likes,
            weight: likesToWeight(likes),
        });
    }

    return reviews;
}

function r2Env() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) return null;
    return { accountId, accessKeyId, secretAccessKey };
}

async function fetchFromR2(): Promise<Review[]> {
    const creds = r2Env();
    if (!creds) throw new Error("Missing R2 credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
    const { accountId, accessKeyId, secretAccessKey } = creds;
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    const tmpFile = `/tmp/${R2_OBJECT_KEY}.current`;
    try {
        execSync(
            `AWS_ACCESS_KEY_ID=${accessKeyId} AWS_SECRET_ACCESS_KEY=${secretAccessKey} AWS_REQUEST_CHECKSUM_CALCULATION=when_required ` +
            `aws s3 cp s3://${R2_BUCKET}/${R2_OBJECT_KEY} ${tmpFile} ` +
            `--endpoint-url ${endpoint} --region auto`,
            { stdio: "pipe" }
        );
    } catch (e) {
        const stderr = (e as { stderr?: Buffer }).stderr?.toString() ?? "";
        if (stderr.includes("does not exist")) return [];
        throw e;
    }
    const data = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
    return data.reviews ?? [];
}

const CACHE_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

async function uploadToR2(json: string): Promise<void> {
    const creds = r2Env();
    if (!creds) throw new Error("Missing R2 credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
    const { accountId, accessKeyId, secretAccessKey } = creds;
    const tmpFile = `/tmp/${R2_OBJECT_KEY}`;
    fs.writeFileSync(tmpFile, json);
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    execSync(
        `AWS_ACCESS_KEY_ID=${accessKeyId} AWS_SECRET_ACCESS_KEY=${secretAccessKey} AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required ` +
        `aws s3 cp ${tmpFile} s3://${R2_BUCKET}/${R2_OBJECT_KEY} ` +
        `--endpoint-url ${endpoint} --region auto ` +
        `--content-type application/json --cache-control "public, max-age=${CACHE_MAX_AGE_SECONDS}"`,
        { stdio: "pipe" }
    );
}

async function main() {
    const dryRun = process.argv.includes("--dry-run");
    const listStored = process.argv.includes("--list");
    const force = process.argv.includes("--force");

    if (listStored) {
        const existing = await fetchFromR2();
        if (existing.length === 0) {
            console.log("No reviews stored.");
        } else {
            existing.forEach((r) =>
                console.log(`${r.stars}★  ${r.reviewer}  (${r.date})  ${r.reviewUrl}`)
            );
        }
        return;
    }

    const html = await fetch(BOOK_URL);
    const filtered = parseReviews(html).filter((r) => r.stars >= MIN_STARS);

    if (dryRun) {
        console.log(JSON.stringify({ reviews: filtered, fetchedAt: new Date().toISOString() }, null, 2));
        return;
    }

    const existing = await fetchFromR2();
    const scrapedByUrl = new Map(filtered.map((r) => [r.reviewUrl, r]));

    const newReviews = filtered.filter(
        (r) => !existing.some((e) => e.reviewUrl === r.reviewUrl)
    );
    const removedReviews = existing.filter((e) => !scrapedByUrl.has(e.reviewUrl));
    const updatedReviews: { before: Review; after: Review }[] = [];

    const kept = existing
        .filter((e) => scrapedByUrl.has(e.reviewUrl))
        .map((e) => {
            const scraped = scrapedByUrl.get(e.reviewUrl)!;
            const changed =
                scraped.reviewer !== e.reviewer ||
                scraped.stars !== e.stars ||
                scraped.date !== e.date ||
                scraped.text !== e.text ||
                scraped.likes !== e.likes;
            if (changed) {
                updatedReviews.push({ before: e, after: scraped });
                return {
                    ...scraped,
                    weight: e.weightOverride ?? scraped.weight,
                    weightOverride: e.weightOverride,
                };
            }
            return e;
        });

    const hasChanges = newReviews.length > 0 || removedReviews.length > 0 || updatedReviews.length > 0;
    if (!hasChanges && !force) return;

    if (newReviews.length > 0) {
        console.log(`${newReviews.length} new review(s): ${newReviews.map((r) => r.reviewer).join(", ")}`);
    }
    if (updatedReviews.length > 0) {
        console.log(`${updatedReviews.length} review(s) edited on Goodreads: ${updatedReviews.map((u) => u.after.reviewer).join(", ")}`);
    }
    if (removedReviews.length > 0) {
        console.log(`${removedReviews.length} review(s) removed/hidden on Goodreads: ${removedReviews.map((r) => r.reviewer).join(", ")}`);
    }
    if (force && !hasChanges) {
        console.log(`Force uploading ${kept.length} review(s), no changes detected.`);
    }

    const merged = [...kept, ...newReviews];
    const output = JSON.stringify({ reviews: merged, fetchedAt: new Date().toISOString() }, null, 2);
    await uploadToR2(output);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
