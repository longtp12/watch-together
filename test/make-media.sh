#!/usr/bin/env bash
# Creates the fake movie (5 min) and ad (30 s) used by the test site. Needs ffmpeg.
set -e
cd "$(dirname "$0")/site" && mkdir -p media
ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=160x90:rate=5" -t 300 -c:v libvpx -b:v 50k -g 10 media/movie.webm
ffmpeg -loglevel error -y -f lavfi -i "color=c=red:size=160x90:rate=5" -t 30 -c:v libvpx -b:v 20k media/ad.webm
echo "media ready in test/site/media"
