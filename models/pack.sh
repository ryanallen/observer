#!/bin/sh
# Each model as the page loads it: meshopt-compressed and quantized, named nodes and materials kept
cd "$(dirname "$0")"
for f in boat box buoy seabed; do
  [ -f "$f.glb" ] && npx -y gltfpack@0.24.0 -i "$f.glb" -o "web/$f.glb" -cc -kn -km -vp 14 2>/dev/null >/dev/null
done
ls -la web
