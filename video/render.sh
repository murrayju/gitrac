#!/bin/bash
# Render the promo and export it for the website (www/video, www/images).
set -euo pipefail
cd "$(dirname "$0")"

npx remotion render Promo out/promo.mp4 --crf=18 "$@"
ffmpeg -v error -y -i out/promo.mp4 -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p \
  -movflags +faststart -an ../www/video/gitrac-demo.mp4
# The poster is a frame from the agent scene, with every issue done.
ffmpeg -v error -y -ss 47 -i out/promo.mp4 -frames:v 1 -q:v 3 ../www/images/demo-poster.jpg
echo "Wrote ../www/video/gitrac-demo.mp4 and ../www/images/demo-poster.jpg"
