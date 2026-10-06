#!/usr/bin/env bash
# Builds Drift's audio DSP to WebAssembly from a Drift checkout (its wasm/ project) and copies the
# result into Forge. The preview then runs exactly the code Drift runs.
#
#   scripts/build-audio-wasm.sh <drift checkout> [extra cmake args, e.g. -DDRIFT_JUCE_DIR=...]
#
# Needs emsdk on PATH (source emsdk_env.sh). Writes, all committed:
#   public/audio/drift-audio.wasm   the module
#   src/services/audio-preview/wasm/drift-audio.mjs  Emscripten's loader for it
#   src/core/audio/pedals.json           the pedal and modulator catalog, read from the module itself
#   public/audio/build.json         what it was built from
set -euo pipefail

drift=$(cd "${1:?usage: $0 <drift checkout> [cmake args]}" && pwd)
shift
forge=$(cd "$(dirname "$0")/.." && pwd)
command -v emcmake >/dev/null || { echo "emcmake not found: install emsdk and source emsdk_env.sh" >&2; exit 1; }

build="$drift/build-wasm"
emcmake cmake -S "$drift/wasm" -B "$build" -G Ninja "$@"
cmake --build "$build"

install -Dm644 "$build/drift-audio.wasm" "$forge/public/audio/drift-audio.wasm"
install -Dm644 "$build/drift-audio.mjs" "$forge/src/services/audio-preview/wasm/drift-audio.mjs"
node "$forge/scripts/dump-pedals.mjs" > "$forge/src/core/audio/pedals.json"

commit=$(git -C "$drift" rev-parse HEAD)
[ -z "$(git -C "$drift" status --porcelain -- src/engine/audio wasm)" ] || commit="$commit-dirty"
cache() { sed -n "s/^$1:[A-Z]*=//p" "$build/CMakeCache.txt"; }
cat > "$forge/public/audio/build.json" <<JSON
{
  "driftCommit": "$commit",
  "emscripten": "$(emcc --version | head -1 | sed -E 's/.* ([0-9]+\.[0-9]+\.[0-9]+).*/\1/')",
  "juce": "$(cache DRIFT_JUCE_TAG)",
  "soundtouch": "$(cache DRIFT_SOUNDTOUCH_TAG)"
}
JSON
echo "drift-audio.wasm: $(gzip -9c "$forge/public/audio/drift-audio.wasm" | wc -c | awk '{printf "%.0f KB gzipped", $1/1024}') from $commit"
