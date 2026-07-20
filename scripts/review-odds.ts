#!/usr/bin/env npx ts-node
// Adjusts the odds that a Goodreads review gets featured on the site, by
// setting a `weightOverride` field on the review in reviews.json (R2), which
// takes precedence over the like-count-derived `weight` set by fetch-goodreads-reviews.ts.
// Usage:
//   ts-node review-odds.ts list                    print all reviews with reviewer key and weight
//   ts-node review-odds.ts set <reviewer> <weight>  set the odds multiplier for a review (e.g. 0.2 to reduce)
//   ts-node review-odds.ts clear <reviewer>         remove the override, reverting to the like-derived weight
// Env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

import * as fs from "fs";
import { execSync } from "child_process";
import { likesToWeight } from "./reviewWeight";

const R2_BUCKET = "goodreads";
const R2_OBJECT_KEY = "reviews.json";
const CACHE_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

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

interface ReviewsData {
    reviews: Review[];
    fetchedAt?: string;
}

function r2Env() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) {
        throw new Error("Missing R2 credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
    }
    return { accountId, accessKeyId, secretAccessKey };
}

function fetchFromR2(): ReviewsData {
    const { accountId, accessKeyId, secretAccessKey } = r2Env();
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    const tmpFile = `/tmp/${R2_OBJECT_KEY}.current`;
    execSync(
        `AWS_ACCESS_KEY_ID=${accessKeyId} AWS_SECRET_ACCESS_KEY=${secretAccessKey} AWS_REQUEST_CHECKSUM_CALCULATION=when_required ` +
        `aws s3 cp s3://${R2_BUCKET}/${R2_OBJECT_KEY} ${tmpFile} ` +
        `--endpoint-url ${endpoint} --region auto`,
        { stdio: "pipe" }
    );
    return JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
}

function uploadToR2(data: ReviewsData): void {
    const { accountId, accessKeyId, secretAccessKey } = r2Env();
    const tmpFile = `/tmp/${R2_OBJECT_KEY}`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    execSync(
        `AWS_ACCESS_KEY_ID=${accessKeyId} AWS_SECRET_ACCESS_KEY=${secretAccessKey} AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required ` +
        `aws s3 cp ${tmpFile} s3://${R2_BUCKET}/${R2_OBJECT_KEY} ` +
        `--endpoint-url ${endpoint} --region auto ` +
        `--content-type application/json --cache-control "public, max-age=${CACHE_MAX_AGE_SECONDS}"`,
        { stdio: "pipe" }
    );
}

function cmdList(): void {
    const data = fetchFromR2();
    if (data.reviews.length === 0) {
        console.log("No reviews stored.");
        return;
    }
    data.reviews.forEach((r) => {
        const note = r.weightOverride !== undefined ? "  (overridden)" : "";
        console.log(`${r.reviewer.padEnd(30)} weight=${r.weight} likes=${r.likes}${note}`);
    });
}

function findReview(data: ReviewsData, reviewer: string): Review {
    const matches = data.reviews.filter((r) => r.reviewer === reviewer);
    if (matches.length === 0) {
        throw new Error(`No review found for reviewer "${reviewer}"`);
    }
    if (matches.length > 1) {
        throw new Error(`Multiple reviews found for reviewer "${reviewer}"; refusing to guess which one`);
    }
    return matches[0];
}

function cmdSet(reviewer: string, weightArg: string): void {
    const weight = parseFloat(weightArg);
    if (isNaN(weight) || weight < 0) {
        throw new Error(`Invalid weight: ${weightArg} (must be a number >= 0)`);
    }
    const data = fetchFromR2();
    const review = findReview(data, reviewer);
    review.weightOverride = weight;
    review.weight = weight;
    uploadToR2(data);
    console.log(`Set weight=${weight} for ${reviewer}`);
}

function cmdClear(reviewer: string): void {
    const data = fetchFromR2();
    const review = findReview(data, reviewer);
    delete review.weightOverride;
    review.weight = likesToWeight(review.likes);
    uploadToR2(data);
    console.log(`Cleared override for ${reviewer}; weight=${review.weight} (from ${review.likes} likes)`);
}

function main() {
    const [cmd, ...args] = process.argv.slice(2);
    if (cmd === "list") {
        cmdList();
    } else if (cmd === "set") {
        const [reviewer, weight] = args;
        if (!reviewer || weight === undefined) {
            throw new Error("Usage: review-odds.ts set <reviewer> <weight>");
        }
        cmdSet(reviewer, weight);
    } else if (cmd === "clear") {
        const [reviewer] = args;
        if (!reviewer) {
            throw new Error("Usage: review-odds.ts clear <reviewer>");
        }
        cmdClear(reviewer);
    } else {
        console.error("Usage:\n  review-odds.ts list\n  review-odds.ts set <reviewer> <weight>\n  review-odds.ts clear <reviewer>");
        process.exit(1);
    }
}

main();
