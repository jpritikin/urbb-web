#!/bin/bash
set -euo pipefail

ISBN_FILE="$HOME/urbb-2025/paper/hard-isbns.txt"
OUTPUT_DIR="$(dirname "$0")/../static/images/supplement/covers"
TMP_DIR="/tmp/cover-gen"

mkdir -p "$TMP_DIR" "$OUTPUT_DIR"

while IFS= read -r isbn; do
  [[ -z "$isbn" ]] && continue
  outfile="$OUTPUT_DIR/${isbn}.webp"
  [[ -f "$outfile" ]] && echo "Skipping $isbn (exists)" && continue

  echo "Rendering $isbn..."
  (cd "$HOME/urbb-2025" && blender4 --background -P ./gen-cover -- --isbn "$isbn" --height 9.5 --spine 1.17 --bleed 0 --no-pdf --output "$TMP_DIR/$isbn")

  pngfile="$TMP_DIR/${isbn}.png"
  if [[ -f "$pngfile" ]]; then
    magick "$pngfile" -resize 25% -quality 80 "$outfile"
    echo "Created $outfile"
  else
    echo "WARNING: No PNG output for $isbn" >&2
  fi
done < "$ISBN_FILE"

echo "Done. Generated $(ls "$OUTPUT_DIR"/*.webp 2>/dev/null | wc -l) covers."
