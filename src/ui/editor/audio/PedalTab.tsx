import { knobSpec, modulatorSpec, pedalColor, pedalSpec } from "@/audio/pedals"
import { findItem, rackOf, type ValuePath } from "@/audio/rack"
import { isSplit, type AudioRack, type ModRoute, type Modulator, type Pedal, type SplitBlock } from "@/doc/types"
import { useEditor } from "@/state/editor"
import { toast } from "../../toast"
import { ScrubNumber, Toggle } from "../widgets"
import { useRackValue } from "./Board"
import { IrPicker } from "./IrPicker"
import { modColor, modLabel } from "./mods"

/** One control as a settings row: its value, and the way to make it a slider in Drift. */
function ValueRow({ path, label }: { path: ValuePath; label?: string }) {
  const { spec, value, bound, set } = useRackValue(path)
  const { exposeRackValue, unexposeRackValue } = useEditor.getState()
  if (!spec) return null
  return (
    <div className="nd-input">
      <div className="nd-input-head">
        <span>{label ?? spec.label}</span>
        {bound ? (
          <span className="param-chip" title="This is a slider in Drift. Click × to turn it back into a fixed value.">
            <span className="param-dot" aria-hidden="true" />
            <span className="param-chip-label">{bound}</span>
            <button type="button" aria-label="Stop exposing" onClick={() => unexposeRackValue(path)}>
              ×
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="expose-btn"
            title="Make this a slider people can change in Drift"
            onClick={() => {
              const err = exposeRackValue(path)
              if (err) toast(err, "error")
            }}
          >
            <span className="param-dot" aria-hidden="true" /> Slider in Drift
          </button>
        )}
      </div>
      {spec.scale === "toggle" ? (
        <Toggle value={value >= 0.5} onChange={(on) => set(on ? 1 : 0)} label={spec.label} />
      ) : spec.scale === "choice" ? (
        <select className="input input-sm" value={Math.round(value)} onChange={(e) => set(Number(e.target.value))}>
          {(spec.options ?? []).map((o, i) => (
            <option key={o} value={i}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <ScrubNumber value={value} min={spec.min} max={spec.max} onChange={set} label={spec.unit ? `${spec.label} (${spec.unit})` : spec.label} />
      )}
    </div>
  )
}

/** One route as a row: who moves what, how far, and a way to drop it. */
function RouteRow({ rack, route, from }: { rack: AudioRack; route: ModRoute; from: "pedal" | "modulator" }) {
  const removeRoute = useEditor((s) => s.removeRoute)
  const target = findItem(rack, route.to)
  const tSpec = target && !isSplit(target.item) ? pedalSpec(target.item.type) : undefined
  const knob = tSpec && knobSpec(tSpec, route.knob)
  const label = from === "pedal" ? `Moved by ${modLabel(rack, route.from)}` : `${tSpec?.label ?? "Pedal"}: ${knob?.label ?? route.knob}`
  return (
    <div className="route-row" style={{ "--cat": modColor(rack, route.from) } as React.CSSProperties}>
      <ValueRow path={{ kind: "depth", route: route.id }} label={`${label} (depth)`} />
      <button type="button" className="mini-btn" aria-label={`Remove: ${label}`} onClick={() => removeRoute(route.id)}>
        ×
      </button>
    </div>
  )
}

const MOD_BLURB: Record<string, string> = {
  lfo: "Sweeps the knobs it's on up and down, over and over. Depth sets how far either way.",
  envelope: "Follows how loud the sound is: louder pushes the knobs it's on further. Use it for auto-wah or ducking.",
  steps: "Steps through a pattern you draw, pushing the knobs it's on by each step's height.",
}

function ModulatorDetails({ rack, mod }: { rack: AudioRack; mod: Modulator }) {
  const spec = modulatorSpec(mod.type)
  const routes = rack.routes.filter((r) => r.from === mod.id)
  return (
    <div className="node-details">
      <div className="nd-head" style={{ "--cat": modColor(rack, mod.id) } as React.CSSProperties}>
        <span className="pill">Modulator</span>
        <h3>{modLabel(rack, mod.id)}</h3>
        <p className="meta">{MOD_BLURB[mod.type]}</p>
      </div>
      <h4 className="section-title">Settings</h4>
      {spec?.knobs.map((k) => (
        <ValueRow key={k.id} path={{ kind: "modKnob", mod: mod.id, knob: k.id }} />
      ))}
      <h4 className="section-title">Moves</h4>
      {routes.length ? (
        routes.map((r) => <RouteRow key={r.id} rack={rack} route={r} from="modulator" />)
      ) : (
        <p className="meta small">Nothing yet. Drag the ⊕ on its card onto any knob on the board.</p>
      )}
    </div>
  )
}

function PedalDetails({ pedal }: { pedal: Pedal }) {
  const rack = rackOf(useEditor((s) => s.doc!))
  const spec = pedalSpec(pedal.type)
  if (!spec) return <p className="meta">Drift has no pedal called “{pedal.type}”. Remove it to export.</p>
  return (
    <div className="node-details">
      <div className="nd-head" style={{ "--cat": pedalColor(spec) } as React.CSSProperties}>
        <span className="pill">{spec.category}</span>
        <h3>{spec.label}</h3>
        <p className="meta">Turn the knobs on the pedal or here. Make any of them a slider and people can set it per clip in Drift.</p>
      </div>
      {pedal.type === "convolution" && (
        <>
          <h4 className="section-title">Space</h4>
          <IrPicker pedal={pedal} />
          <p className="meta small">
            The sound of a real or imagined space. To capture your own, record a clap or a balloon pop in a room and upload it: everything
            after the bang is the room.
          </p>
        </>
      )}
      <h4 className="section-title">Settings</h4>
      {spec.knobs.map((k) => (
        <div key={k.id}>
          <ValueRow path={{ kind: "knob", item: pedal.id, knob: k.id }} />
          {rack.routes
            .filter((r) => r.to === pedal.id && r.knob === k.id)
            .map((r) => (
              <RouteRow key={r.id} rack={rack} route={r} from="pedal" />
            ))}
        </div>
      ))}
      <h4 className="section-title">Footswitch</h4>
      <ValueRow path={{ kind: "bypass", item: pedal.id }} label="Bypassed" />
    </div>
  )
}

function SplitDetails({ split }: { split: SplitBlock }) {
  const { setSplitMode, setCrossfade, setLaneGain, removeLane } = useEditor.getState()
  const fail = (err: string | null) => err && toast(err, "error")
  return (
    <div className="node-details">
      <div className="nd-head" style={{ "--cat": "var(--accent)" } as React.CSSProperties}>
        <span className="pill">Split</span>
        <h3>{split.mode === "bands" ? "Band split" : "Parallel split"}</h3>
        <p className="meta">
          {split.mode === "bands"
            ? "Cuts the sound into frequency bands, runs each through its own lane, and puts them back together. Untouched lanes add back up to the original."
            : "Sends the same sound down every lane and adds what comes out. Leave a lane empty to keep some of the dry sound."}
        </p>
      </div>
      <label className="field">
        <span>How it splits</span>
        <select className="input input-sm" value={split.mode} onChange={(e) => setSplitMode(split.id, e.target.value as SplitBlock["mode"])}>
          <option value="parallel">Same sound in every lane</option>
          <option value="bands">One frequency band per lane</option>
        </select>
      </label>
      {split.mode === "parallel" && split.lanes.length === 2 && (
        <div className="field-inline">
          <span>Blend between the two lanes</span>
          <Toggle value={!!split.crossfade} onChange={(on) => fail(setCrossfade(split.id, on))} label="Blend between the two lanes" />
        </div>
      )}
      {split.crossfade && <ValueRow path={{ kind: "blend", item: split.id }} label="Blend (0 = first lane, 1 = second)" />}
      {split.mode === "bands" &&
        split.crossovers?.map((_, i) => <ValueRow key={i} path={{ kind: "crossover", item: split.id, index: i }} label={`Crossover ${i + 1}`} />)}
      <h4 className="section-title">Lanes</h4>
      {split.lanes.map((lane, i) => (
        <div className="row gap-2" key={lane.id}>
          <span className="lane-name">Lane {i + 1}</span>
          <ScrubNumber compact value={lane.gain} min={0} max={2} onChange={(g) => setLaneGain(split.id, lane.id, g)} label="Level" />
          <button type="button" className="mini-btn" aria-label={`Remove lane ${i + 1}`} disabled={split.lanes.length <= 2} onClick={() => fail(removeLane(split.id, lane.id))}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export function PedalTab() {
  const doc = useEditor((s) => s.doc!)
  const selected = useEditor((s) => s.selected[0])
  const at = selected ? findItem(rackOf(doc), selected) : undefined
  const mod = rackOf(doc).modulators.find((m) => m.id === selected)
  if (mod) return <ModulatorDetails rack={rackOf(doc)} mod={mod} />
  if (!at) {
    return (
      <div className="inspector-tips">
        <h4>Select a pedal or modulator</h4>
        <p>Click one on the board to see all its settings and choose which ones people can change in Drift.</p>
        <p>
          Settings marked <span className="param-dot inline" /> are sliders in Drift. Their values here are only for trying out; set their
          defaults in the Sliders tab.
        </p>
      </div>
    )
  }
  return isSplit(at.item) ? <SplitDetails split={at.item} /> : <PedalDetails pedal={at.item} />
}

