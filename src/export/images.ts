import type { ForgeAsset, ForgeDoc } from "@/doc/types"
import { base64ToBytes, bytesToBase64 } from "@/doc/util"

async function canvasBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), type, quality),
  )
}

export async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer())
}

export function assetBlob(a: ForgeAsset): Blob {
  return new Blob([base64ToBytes(a.data) as Uint8Array<ArrayBuffer>], { type: a.mime })
}

/** Reads an uploaded picture into an asset, capped to 2048 px so documents stay manageable. */
export async function assetFromFile(file: File, id: string): Promise<ForgeAsset> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height))
  if (scale === 1 && (file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp")) {
    return {
      id,
      name: file.name,
      mime: file.type,
      data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      width: bmp.width,
      height: bmp.height,
    }
  }
  const c = document.createElement("canvas")
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height)
  const blob = await canvasBlob(c, "image/png")
  return { id, name: file.name, mime: "image/png", data: bytesToBase64(await blobBytes(blob)), width: c.width, height: c.height }
}

/**
 * Re-encodes every asset to at most `maxSide` px, as WebP where the browser can encode it
 * (older Safari can't, and silently hands back PNG — then JPEG for opaque images).
 */
export async function shrinkAssets(doc: ForgeDoc, maxSide = 256): Promise<ForgeDoc> {
  const d = structuredClone(doc)
  for (const a of d.assets) {
    const bmp = await createImageBitmap(assetBlob(a))
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const c = document.createElement("canvas")
    c.width = Math.max(1, Math.round(bmp.width * scale))
    c.height = Math.max(1, Math.round(bmp.height * scale))
    const g = c.getContext("2d")!
    g.drawImage(bmp, 0, 0, c.width, c.height)
    let blob = await canvasBlob(c, "image/webp", 0.8)
    if (blob.type !== "image/webp") {
      const px = g.getImageData(0, 0, c.width, c.height).data
      let opaque = true
      for (let i = 3; i < px.length && opaque; i += 4) opaque = px[i] === 255
      blob = await canvasBlob(c, opaque ? "image/jpeg" : "image/png", 0.8)
    }
    a.mime = blob.type
    a.data = bytesToBase64(await blobBytes(blob))
    a.width = c.width
    a.height = c.height
  }
  return d
}

export async function imageDataToPng(img: ImageData): Promise<Uint8Array> {
  const c = document.createElement("canvas")
  c.width = img.width
  c.height = img.height
  c.getContext("2d")!.putImageData(img, 0, 0)
  return blobBytes(await canvasBlob(c, "image/png"))
}

export function download(name: string, data: Uint8Array | string, type: string) {
  const blob = new Blob([data as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
