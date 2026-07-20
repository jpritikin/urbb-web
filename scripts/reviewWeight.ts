// Display weight derived from Goodreads like count, used as the default
// odds multiplier when a review has no manual weightOverride (review-odds.ts).
export function likesToWeight(likes: number): number {
    return 1 + Math.log(1 + likes);
}
