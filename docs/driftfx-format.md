# `.driftfx` — user-made effect and transition packages

Drift Forge exports one effect or transition per `.driftfx` file. The container is the official
`.driftpkg` layout (`drift-addons/packer/driftpkg.py`, `VideoEd/src/engine/AddonPackage.h`) with
two differences:

- the magic is `DRIFTFX\0` instead of `DRIFTPKG`, and
- there is **no Ed25519 signature trailer**: the file ends after the SHA-256 digest.

The distinct magic means a user package can never be mistaken for, or replayed as, an official
signed one, while `AddonPackage`'s reader can be reused almost unchanged.

## Byte layout (little-endian)

| Offset          | Size | Field                                                  |
| --------------- | ---- | ------------------------------------------------------ |
| 0               | 8    | magic `"DRIFTFX\0"`                                    |
| 8               | 4    | `formatVersion` u32, currently `1`                     |
| 12              | 4    | `metadataLength` u32                                   |
| 16              | n    | metadata: UTF-8 JSON manifest                          |
| 16+n            | 8    | `payloadCompressed` u64                                |
| 24+n            | 8    | `payloadRaw` u64                                       |
| 32+n            | m    | payload: one zstd frame, every file concatenated       |
| 32+n+m          | 32   | SHA-256 over every byte before it                      |

The payload is a single (solid) zstd frame at level 19 containing all files back to back, sorted
by path. The frame records its content size.

## Manifest

Same fields as a `.driftpkg` manifest, serialised with keys sorted and no whitespace, plus
`generator`:

```json
{
  "author": "",
  "description": "Highlights bloom into soft light.",
  "details": "Made with Drift Forge. Effect id: forge_dreamy_glow_k3x9.",
  "files": [
    { "offset": 0, "path": "effects/forge_dreamy_glow_k3x9/effect.json", "sha256": "…", "size": 1534 },
    { "offset": 1534, "path": "effects/forge_dreamy_glow_k3x9/forge.json", "sha256": "…", "size": 4210 }
  ],
  "generator": "drift-forge/0.1.0",
  "id": "user.forge_dreamy_glow_k3x9",
  "installedSize": 13311,
  "license": "",
  "minAppVersion": "0.7.0",
  "name": "Dreamy glow",
  "platform": "",
  "provides": [{ "items": 1, "kind": "effects", "root": "effects" }],
  "schema": 1,
  "version": "1.0.0"
}
```

- `id` is the effect/transition id prefixed with `user.`, so it can't collide with CutWire pack
  ids (`effects.core`, `transitions.core`, …).
- `provides[0].kind` is `effects` or `transitions`; `items` is always 1.
- `files[].offset` indexes the uncompressed payload; offsets are contiguous and in path order.

## Payload tree

Identical to a bundled Drift package folder, under the provides root:

```
effects/<id>/effect.json        (or transitions/<id>/transition.json)
effects/<id>/main.frag          final pass; extra passes are pass1.frag, pass2.frag, …
effects/<id>/thumbnail.png      256×256 (transitions: preview_strip.png, 1536×128, 12 frames)
effects/<id>/tex0.png …         images referenced by pipeline.textures
effects/<id>/forge.json         the Drift Forge source document; Drift can ignore it
```

`effect.json` / `transition.json` follow `GpuPackageParse` exactly. Packages made with the
**Next Drift** switch add parameter types and a top-level `nextFeatures` list described in
`drift-next-params.md`; the always-safe extras (`ui`, `showWhen`, `presets`) appear in every export. Shaders are `#version 330 core`, declare no precision, and only use engine uniforms Drift
binds (`u_currentTexture`, `u_textureN`, `u_resolution`, `u_time` for effects, `u_progress` for
transitions). Every intermediate buffer has `scale: 1.0`.

### Static texture orientation

`GlRuntime::staticTexture` uploads package images flipped vertically, while clip frames are not.
Forge's shaders therefore sample package images at `vec2(uv.x, 1.0 - uv.y)` so row 0 of the PNG is
the top of the frame, matching clip frames. If Drift ever changes `staticTexture`, Forge needs a
matching change (and documents written before then would need the flip toggled on import).

## Suggested import flow for Drift

1. Check the magic, `formatVersion == 1`, the header lengths and the trailing SHA-256.
2. Refuse `payloadRaw` above a sane cap (Forge itself refuses > 256 MB) before decompressing.
3. Verify each file's `sha256`, reject absolute paths and `..` segments, and require every path to
   sit under `provides[0].root/<one folder>/`.
4. Show an "unverified, made by a user" confirmation, since nothing vouches for the author.
5. Install into `<AppData>/effects` or `<AppData>/transitions` (the same roots unsigned folders
   already load from), or into `addons/<id>/` with an `installed.json` entry marked unsigned.
