#!/usr/bin/env bash
# Renders every src/__tests__/golden/*.json through Drift's native DSP (tools/audiograph_render in a
# Drift build) into the matching .f32, which audio-golden.test.ts compares the wasm build against.
#
#   scripts/update-audio-goldens.sh <drift build dir>
#
# Run it after scripts/build-audio-wasm.sh, from the same Drift commit: the test refuses to compare
# a module and goldens built from different sources.
set -euo pipefail

build=$(cd "${1:?usage: $0 <drift build dir>}" && pwd)
forge=$(cd "$(dirname "$0")/.." && pwd)
golden="$forge/src/__tests__/golden"
render="$build/tools/audiograph_render"
[ -x "$render" ] || { echo "$render not found: build the audiograph_render target" >&2; exit 1; }
drift=$(sed -n 's/^CMAKE_HOME_DIRECTORY:INTERNAL=//p' "$build/CMakeCache.txt")

rate=32000
for manifest in "$golden"/*.json; do
  [ "$(basename "$manifest")" = golden.json ] && continue
  # 1000-frame chunks against the test's 128: the two builds must also agree across chunkings.
  "$render" "$manifest" "$golden/input.f32" "${manifest%.json}.f32" --rate "$rate" --chunk 1000
done

commit=$(git -C "$drift" rev-parse HEAD)
[ -z "$(git -C "$drift" status --porcelain -- src/engine/audio wasm)" ] || commit="$commit-dirty"
printf '{\n  "driftCommit": "%s",\n  "rate": %d\n}\n' "$commit" "$rate" > "$golden/golden.json"
