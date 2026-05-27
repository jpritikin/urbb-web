#!/usr/bin/env npx ts-node
// Fetches reviews from a GoodReads book page, filters to 4+ stars,
// and uploads the result as JSON to Cloudflare R2.
// Usage: ts-node fetch-goodreads-reviews.ts [--dry-run] [--list]
//   --dry-run  print fetched reviews without uploading
//   --list     print currently stored reviews from R2 (or view https://data.unburdened.biz/reviews.json)
// Env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

import * as https from "https";
import * as http from "http";
import * as fs from "fs";
import { execSync } from "child_process";

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
}

function fetch(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith("https") ? https : http;
        lib
            .get(
                url,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
                        Accept:
                            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    },
                },
                (res) => {
                    if (
                        res.statusCode &&
                        res.statusCode >= 300 &&
                        res.statusCode < 400 &&
                        res.headers.location
                    ) {
                        fetch(res.headers.location).then(resolve).catch(reject);
                        return;
                    }
                    const chunks: Buffer[] = [];
                    res.on("data", (c: Buffer) => chunks.push(c));
                    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
                    res.on("error", reject);
                }
            )
            .on("error", reject);
    });
}

function parseReviews(html: string): Review[] {
    const reviews: Review[] = [];
    const articleRe =
        /<article class="ReviewCard" aria-label="Review by ([^"]+)">([\s\S]*?)(?=<article class="ReviewCard"|<\/div><\/div><div class="ReviewsList__listContext"|$)/g;

    let m: RegExpExecArray | null;
    while ((m = articleRe.exec(html)) !== null) {
        const reviewer = m[1].trim();
        const body = m[2];

        const ratingMatch = body.match(/aria-label="Rating (\d+) out of 5"/);
        if (!ratingMatch) continue;
        const stars = parseInt(ratingMatch[1], 10);

        const reviewerUrlMatch = body.match(
            /href="(https:\/\/www\.goodreads\.com\/user\/show\/[^"]+)"/
        );
        const reviewerUrl = reviewerUrlMatch ? reviewerUrlMatch[1] : "";

        const reviewUrlMatch = body.match(
            /href="(https:\/\/www\.goodreads\.com\/review\/show\/[^"]+)"/
        );
        const reviewUrl = reviewUrlMatch ? reviewUrlMatch[1] : "";

        const dateMatch = body.match(
            /goodreads\.com\/review\/show\/[^"]+">([^<]+)<\/a>/
        );
        const date = dateMatch ? dateMatch[1].trim() : "";

        const textMatch = body.match(
            /<span class="Formatted">([\s\S]*?)<\/span>/
        );
        const text = textMatch
            ? textMatch[1].replace(/<[^>]+>/g, "").trim()
            : "";

        reviews.push({ reviewer, reviewerUrl, stars, date, reviewUrl, text });
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
            `AWS_ACCESS_KEY_ID=${accessKeyId} AWS_SECRET_ACCESS_KEY=${secretAccessKey} ` +
            `aws s3 cp s3://${R2_BUCKET}/${R2_OBJECT_KEY} ${tmpFile} ` +
            `--endpoint-url ${endpoint} --region auto`,
            { stdio: "pipe" }
        );
        const data = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
        return data.reviews ?? [];
    } catch {
        return [];
    }
}

async function uploadToR2(json: string): Promise<void> {
    const creds = r2Env();
    if (!creds) throw new Error("Missing R2 credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
    const { accountId, accessKeyId, secretAccessKey } = creds;
    const tmpFile = `/tmp/${R2_OBJECT_KEY}`;
    fs.writeFileSync(tmpFile, json);
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    execSync(
        `AWS_ACCESS_KEY_ID=${accessKeyId} AWS_SECRET_ACCESS_KEY=${secretAccessKey} ` +
        `aws s3 cp ${tmpFile} s3://${R2_BUCKET}/${R2_OBJECT_KEY} ` +
        `--endpoint-url ${endpoint} --region auto`,
        { stdio: "pipe" }
    );
}

async function main() {
    const dryRun = process.argv.includes("--dry-run");
    const listStored = process.argv.includes("--list");

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
    const existingUrls = new Set(existing.map((r) => r.reviewUrl));
    const newReviews = filtered.filter((r) => !existingUrls.has(r.reviewUrl));

    if (newReviews.length === 0) return;

    console.log(`${newReviews.length} new review(s): ${newReviews.map((r) => r.reviewer).join(", ")}`);
    const output = JSON.stringify({ reviews: filtered, fetchedAt: new Date().toISOString() }, null, 2);
    await uploadToR2(output);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
