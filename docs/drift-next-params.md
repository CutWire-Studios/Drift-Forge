# Next-Drift parameters

Drift Forge can export controls that today's Drift doesn't understand, behind the **Next Drift**
switch (Details tab). This file is the contract for implementing them in Drift
(`GpuPackageParse`, `setPackageUniforms`/`runPipeline` in `GlRuntime.cpp`, and the inspector).

Today's Drift refuses these packages, because an unknown parameter `type` is a parse error
(`GpuPackageParse.cpp:140-160`). Every package that uses them lists what it needs in a top-level
`"nextFeatures"` array, e.g. `["param:point", "param:gradient", "uniform:audio"]`, so a future
Drift can refuse with a clear message if it only implements some of them.

## Always safe (written for every target)

Today's parser reads only the keys it knows, so these are written into every export.

| Where | Key | Meaning |
| --- | --- | --- |
| parameter | `ui.control` | `"angle"` shows a dial; `"seed"` shows a number with a shuffle button |
| parameter | `ui.unit` | suffix after the value: `"px"`, `"°"`, `"%"`, `"s"` |
| parameter | `ui.step` | snap step; `1` for counts |
| parameter | `ui.precision` | decimals shown |
| parameter | `showWhen` | `{ "param": "<bool param id>", "equals": true }`: hide unless that switch matches |
| top level | `presets` | `[{ "name": "Subtle", "values": { "<id>": <value in that param's JSON form> } }]` |

## Parameter types

All parameters are still bound by uniform name = `identifier`, as today.

| `type` | JSON | GLSL uniform | Inspector |
| --- | --- | --- | --- |
| `int` | `minValue`, `maxValue`, `defaultValue` (whole numbers) | `float` holding a whole number | integer slider; keyframable |
| `point` | `minValue: [x, y]`, `maxValue: [x, y]`, `defaultValue: [x, y]` (0..1 of the frame, y down) | `vec2` | draggable handle on the preview; keyframable |
| `choice` | `options: ["Left", "Right", …]`, `defaultValue: index` | `float` index | dropdown |
| `seed` | `defaultValue` | `float` | number + shuffle |
| `color` + `"alpha": true` | `defaultValue: "#rrggbbaa"` | `vec4` (straight alpha) | swatch with opacity |
| `region` | `shape: "rect"\|"ellipse"`, `defaultValue: [x, y, w, h]` (0..1 of the frame, y down) | `vec4` | box/oval drawn on the preview |
| `image` | `defaultValue: "param_<id>.png"` (file in the package) | `sampler2D` | picture picker |
| `clip` | (no default) | `sampler2D` | timeline clip picker |
| `gradient` | `defaultValue: [{ "position": 0..1, "color": "#rrggbbaa" }, …]` | `sampler2D` (256×1) | gradient editor |
| `curve` | `defaultValue: [{ "x": 0..1, "y": 0..1, "ease": "linear"\|"smooth"\|"in"\|"out"\|"hold" }, …]` | `sampler2D` (256×1, value in `.r`) | curve editor |

### Sampler parameters (`image`, `clip`, `gradient`, `curve`)

- A pass that declares `uniform sampler2D <identifier>;` gets it bound by Drift. Use the texture
  units **after** the pass's `inputs` (unit `inputs.length`, then `+1`…), in the order the
  parameters appear in `parameters`.
- `image` and `clip` textures are oriented like clip frames: row 0 at v = 0 (the top). This is
  unlike `pipeline.textures`, which `staticTexture` uploads flipped.
- `image`: CLAMP_TO_EDGE, LINEAR. The default file is resolved relative to the package folder.
- `clip`: the chosen clip's frame at the same timeline time, rendered canvas-sized with its own
  transform and effects, the same way a transition's inputs are. Bind a transparent texture when
  no clip is chosen or the clip has no frame at that time.
- `gradient`/`curve`: rebuild a 256×1 RGBA8 texture whenever the value changes. Texel `i` holds the
  value at `t = i / 255`. Evaluate exactly like Forge: stops/keys sorted by position; before the
  first or after the last, hold that end's value; between two keys, interpolate linearly after
  applying the *left* key's ease to the 0..1 fraction (`smooth` = k²(3−2k), `in` = k³,
  `out` = 1−(1−k)³, `hold` = 0). Curves store y in the red channel, clamped to 0..1; shaders
  sample at `t * (255/256) + 0.5/256`.

### Keyframing

`int`, `point` and alpha `color` should be keyframable (a point as two tracks).

## Engine uniforms

Bound when a shader declares them; 0 when there's no audio.

| Uniform | Meaning |
| --- | --- |
| `u_audioLevel` | smoothed loudness of the timeline's mixed audio at the current time, 0..1 |
| `u_audioBass` | energy below ~150 Hz, 0..1 |
| `u_audioBeat` | jumps to 1 on a detected beat/onset, decays to 0 over ~250 ms |

Drift already detects onsets for effect templates (`AppController.cpp:20040-20090`); the beat
pulse can reuse them. Transitions may read these too: they are a function of timeline time, not
of `u_time`, so they don't break the determinism rule for transitions. Forge's preview
approximates them with WebAudio (`src/runtime/audio.ts`).
