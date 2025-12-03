#!/bin/bash

# Extract front and back cover images from composite cover files
# Layout: [back cover] [spine] [front cover]
# We need to extract the left and right portions, avoiding the spine in the middle

set -e

COVER1="$HOME/urbb-2025/cover1.png"
COVER2="$HOME/urbb-2025/cover2.png"
COVER_COMMON="$HOME/urbb-2025/cover-common.png"
OUTPUT_DIR="$HOME/urbb-web/static"
TEMP_DIR=$(mktemp -d)

# Get image dimensions
WIDTH=$(identify -format "%w" "$COVER1")
HEIGHT=$(identify -format "%h" "$COVER1")

echo "Image dimensions: ${WIDTH}x${HEIGHT}"

# Calculate DPI from known page height
PAGE_HEIGHT_INCHES=9.21
DPI=$(echo "$HEIGHT / $PAGE_HEIGHT_INCHES" | bc -l)

echo "Calculated DPI: $DPI"

# Calculate page width in pixels
PAGE_WIDTH_INCHES=6.14
PAGE_WIDTH_PIXELS=$(echo "$PAGE_WIDTH_INCHES * $DPI" | bc | awk '{print int($1+0.5)}')

echo "Page width: ${PAGE_WIDTH_PIXELS}px"

# Calculate spine width (total width - 2 pages)
SPINE_PIXELS=$(echo "$WIDTH - (2 * $PAGE_WIDTH_PIXELS)" | bc)

echo "Spine width: ${SPINE_PIXELS}px"

COVER_WIDTH=$PAGE_WIDTH_PIXELS

# Maximum height for display (80vh on typical screens ~1080-1440px)
MAX_HEIGHT=1200

# Composite cover-common.png on top of both covers
echo "Compositing cover-common.png on top of covers..."
COMPOSITE1="$TEMP_DIR/cover1-composite.png"
COMPOSITE2="$TEMP_DIR/cover2-composite.png"

convert "$COVER1" "$COVER_COMMON" -composite "$COMPOSITE1"
convert "$COVER2" "$COVER_COMMON" -composite "$COMPOSITE2"

# Extract back cover (left side)
FRONT_OFFSET=$(echo "$COVER_WIDTH + $SPINE_PIXELS" | bc)

echo "Extracting and converting back-ordinary.webp..."
convert "$COMPOSITE1" -crop "${COVER_WIDTH}x${HEIGHT}+0+0" -resize "x${MAX_HEIGHT}>" "$OUTPUT_DIR/back-ordinary.webp"

echo "Extracting and converting back-cathedral.webp..."
convert "$COMPOSITE2" -crop "${COVER_WIDTH}x${HEIGHT}+0+0" -resize "x${MAX_HEIGHT}>" "$OUTPUT_DIR/back-cathedral.webp"

echo "Extracting and converting front-ordinary.webp..."
convert "$COMPOSITE1" -crop "${COVER_WIDTH}x${HEIGHT}+${FRONT_OFFSET}+0" -resize "x${MAX_HEIGHT}>" "$OUTPUT_DIR/front-ordinary.webp"

echo "Extracting and converting front-cathedral.webp..."
convert "$COMPOSITE2" -crop "${COVER_WIDTH}x${HEIGHT}+${FRONT_OFFSET}+0" -resize "x${MAX_HEIGHT}>" "$OUTPUT_DIR/front-cathedral.webp"

# Cleanup
rm -rf "$TEMP_DIR"

echo "Done! Extracted and converted images to $OUTPUT_DIR"
