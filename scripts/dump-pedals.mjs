// Prints the pedal catalog compiled into public/audio/drift-audio.wasm, as pretty JSON.
import { readFileSync } from "node:fs"
import createDriftAudio from "../src/services/audio-preview/wasm/drift-audio.mjs"

const module = await WebAssembly.compile(readFileSync(new URL("../public/audio/drift-audio.wasm", import.meta.url)))
const M = await createDriftAudio({
  instantiateWasm: (imports, done) => {
    WebAssembly.instantiate(module, imports).then((instance) => done(instance, module))
    return {}
  },
})
console.log(JSON.stringify(JSON.parse(M.UTF8ToString(M._dg_pedal_catalog())), null, 2))
