import { useSyncExternalStore } from "react"
import { getEngine, type EngineStatus } from "@/services/preview/engine"

const INITIAL: EngineStatus = { playing: true, position: 0, duration: 1, fps: 0, error: null, nodeErrors: {}, sources: ["", "", ""] }
let latest: EngineStatus = INITIAL

function subscribe(cb: () => void) {
  return getEngine().subscribe((s) => {
    latest = s
    cb()
  })
}

export function useEngineStatus<T>(select: (s: EngineStatus) => T): T {
  return useSyncExternalStore(subscribe, () => select(latest))
}
