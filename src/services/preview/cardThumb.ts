import { compile } from "@/core/compiler/compile"
import type { ForgeDoc } from "@/core/doc/types"
import { base64ToBytes } from "@/core/doc/util"
import { paramTextures, previewClip, usesClipMask } from "./bindings"
import { getEngine } from "./engine"
import { FrameCanvas, loadMedia, sample } from "./media"

const CARD_JPEG_QUALITY = 0.8

/** A still of `doc` on the sample photos, for cards that aren't open in the editor. */
export async function renderCardThumb(doc: ForgeDoc, width = 320, height = 180): Promise<string | null> {
  const e = getEngine()
  const compiled = compile(doc, { mode: "export" })
  if (!compiled.ok) return null
  const preview = previewClip(doc)
  const [a, b, m] = await Promise.all([
    loadMedia(preview ?? sample("landscape")),
    loadMedia(sample("city-night")),
    preview?.matte ? loadMedia(sample(preview.matte)) : null,
  ])
  for (const asset of doc.assets) {
    if (!e.renderer.hasAsset(asset.id)) {
      const blob = new Blob([base64ToBytes(asset.data) as Uint8Array<ArrayBuffer>], { type: asset.mime })
      const bmp = await createImageBitmap(blob)
      e.renderer.setAsset(asset.id, bmp)
      e.renderer.setUprightAsset(asset.id, bmp)
    }
  }
  const fa = new FrameCanvas()
  const fb = new FrameCanvas()
  e.renderer.setSource(0, fa.draw(a, width, height))
  e.renderer.setSource(1, fb.draw(b, width, height))
  if (m) e.renderer.setSource(2, new FrameCanvas().draw(m, width, height))
  const img = e.renderer.readPixels(
    compiled,
    {
      width,
      height,
      time: 0.6,
      progress: 0.5,
      params: doc.params,
      paramValues: {},
      literals: {},
      paramTexture: paramTextures(e.renderer, doc, {}),
      clipMask: m && usesClipMask(doc) ? e.renderer.sourceTexture(2) : null,
    },
    (texId) => compiled.textures.find((t) => t.id === texId)?.assetId ?? "",
  )
  if (typeof img === "string") return null
  const c = document.createElement("canvas")
  c.width = width
  c.height = height
  c.getContext("2d")!.putImageData(img, 0, 0)
  return c.toDataURL("image/jpeg", CARD_JPEG_QUALITY)
}
