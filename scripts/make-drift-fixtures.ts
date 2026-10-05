// Writes the Forge-exported packages Drift's tests install (tests/data/forge_fixture_*.driftfx), so
// the contract between Forge's exporter and Drift's loader is checked from Drift's side too.
//
//   npx vite-node scripts/make-drift-fixtures.ts <drift checkout>/tests/data
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { irFiles } from "@/audio/irs"
import * as rack from "@/audio/rack"
import { isOpError, updateParam, type OpResult } from "@/doc/ops"
import type { ForgeDoc, SplitBlock } from "@/doc/types"
import { emptyDoc } from "@/doc/util"
import { exportDriftfx } from "@/export/archive"

const out = process.argv[2]
if (!out) throw new Error("usage: make-drift-fixtures.ts <drift tests/data dir>")

function must<T extends object>(r: OpResult<T>): { doc: ForgeDoc } & T {
  if (isOpError(r)) throw new Error(r.error)
  return r
}

/** A filter swept by an LFO, then a blend into a convolution room and a switchable delay. */
function rackFixture(): ForgeDoc {
  let doc = emptyDoc("audio", "Fixture rack")
  doc.meta.id = "forge_fixture_rack"
  const filter = must(rack.addPedal(doc, "filter"))
  doc = rack.setValue(filter.doc, { kind: "knob", item: filter.id, knob: "mode" }, 2)
  const tone = must(rack.exposeValue(doc, { kind: "knob", item: filter.id, knob: "cutoff" }))
  doc = must(updateParam(tone.doc, tone.param, { identifier: "tone", displayName: "Tone", default: 1500 })).doc
  const lfo = must(rack.addModulator(doc, "lfo"))
  doc = must(rack.addRoute(lfo.doc, lfo.id, filter.id, "cutoff", 0.3)).doc
  const env = must(rack.addModulator(doc, "envelope"))
  doc = rack.setModulatorSource(env.doc, env.id, filter.id)

  const split = must(rack.addSplit(doc, "parallel"))
  doc = must(rack.setCrossfade(split.doc, split.id, true)).doc
  const space = must(rack.exposeValue(doc, { kind: "blend", item: split.id }))
  doc = must(updateParam(space.doc, space.param, { identifier: "space", displayName: "Space", default: 0.4 })).doc
  const wet = (rack.findItem(rack.rackOf(doc), split.id)!.item as SplitBlock).lanes[1].id
  const room = must(rack.addPedal(doc, "convolution", { lane: wet }))
  doc = rack.setIr(room.doc, room.id, "builtin:room")
  const delay = must(rack.addPedal(doc, "delay", { lane: wet }))
  const off = must(rack.exposeValue(delay.doc, { kind: "bypass", item: delay.id }))
  doc = must(updateParam(off.doc, off.param, { identifier: "echo_off", displayName: "No echo" })).doc
  return doc
}

const fromDisk = async (name: string) => new Uint8Array(readFileSync(new URL(`../public/audio/ir/${name}.wav`, import.meta.url)))
const doc = rackFixture()
const bytes = await exportDriftfx(doc, { png: null, irs: await irFiles(doc, fromDisk) })
writeFileSync(join(out, "forge_fixture_rack.driftfx"), bytes)
console.log(`forge_fixture_rack.driftfx: ${bytes.length} bytes`)
