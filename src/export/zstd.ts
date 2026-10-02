import { compress, decompress, init } from "@bokuweb/zstd-wasm"

let ready: Promise<void> | null = null

export async function zstdCompress(data: Uint8Array, level = 19): Promise<Uint8Array> {
  await (ready ??= init())
  return compress(data, level)
}

export async function zstdDecompress(data: Uint8Array): Promise<Uint8Array> {
  await (ready ??= init())
  return decompress(data)
}
