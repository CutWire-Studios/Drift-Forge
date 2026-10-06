import { useState } from "react"

function webgl2Available(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2")
  } catch {
    return false
  }
}

export function useWebgl2(): boolean {
  const [ok] = useState(webgl2Available)
  return ok
}
