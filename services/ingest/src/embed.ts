// Local embedding model, shared shape with dochaus/tool/search-document.ts.
// Both sides MUST use the same model id so query and chunk vectors are comparable.

export const MODEL = "Xenova/all-MiniLM-L6-v2"
export const DIM = 384

let extractor: any

export async function embed(text: string): Promise<Float32Array> {
  if (!extractor) {
    const { pipeline } = await import("@xenova/transformers")
    extractor = await pipeline("feature-extraction", MODEL)
  }
  const output = await extractor(text, { pooling: "mean", normalize: true })
  return output.data as Float32Array
}
