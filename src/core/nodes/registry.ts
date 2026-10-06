import { KIND_INFO } from "@/core/doc/kinds"
import type { ForgeNode, InputValue, Kind } from "@/core/doc/types"
import { uid } from "@/core/doc/util"
import { advancedNodes, outputNodes } from "./advanced"
import { animateNodes } from "./animate"
import { blurNodes } from "./blur"
import { colorNodes } from "./color"
import { controlNodes } from "./controls"
import { gradeNodes } from "./grade"
import { kitBlurNodes, kitDistortNodes, kitOverlayNodes, kitTransitionNodes } from "./kit"
import { threeNodes } from "./three"
import { distortNodes } from "./distort"
import { generateNodes } from "./generate"
import { inputNodes } from "./input"
import { mathNodes } from "./math"
import { mixNodes } from "./mix"
import { stylizeNodes } from "./stylize"
import { transitionNodes } from "./transition"
import type { Category, NodeDef } from "./types"

const CATEGORY_INFO = {
  input: { label: "Inputs", color: "#38bdf8" },
  color: { label: "Color", color: "#f472b6" },
  distort: { label: "Distort", color: "#a78bfa" },
  three: { label: "3D", color: "#818cf8" },
  blur: { label: "Blur & Light", color: "#60a5fa" },
  stylize: { label: "Stylize", color: "#fb923c" },
  generate: { label: "Patterns", color: "#34d399" },
  mix: { label: "Mix & Mask", color: "#facc15" },
  transition: { label: "Transition", color: "#f87171" },
  animate: { label: "Animate", color: "#2dd4bf" },
  math: { label: "Math", color: "#94a3b8" },
  advanced: { label: "Advanced", color: "#e879f9" },
  output: { label: "Output", color: "#ffc107" },
} satisfies Record<Category, { label: string; color: string }>

/** In palette order. */
export const CATEGORIES: { id: Category; label: string; color: string }[] = (Object.keys(CATEGORY_INFO) as Category[]).map((id) => ({
  id,
  ...CATEGORY_INFO[id],
}))

export const NODE_DEFS: NodeDef[] = [
  ...inputNodes,
  ...controlNodes,
  ...colorNodes,
  ...gradeNodes,
  ...distortNodes,
  ...kitDistortNodes,
  ...threeNodes,
  ...blurNodes,
  ...kitBlurNodes,
  ...stylizeNodes,
  ...generateNodes,
  ...kitOverlayNodes,
  ...mixNodes,
  ...transitionNodes,
  ...kitTransitionNodes,
  ...animateNodes,
  ...mathNodes,
  ...advancedNodes,
  ...outputNodes,
]

const BY_TYPE = new Map(NODE_DEFS.map((d) => [d.type, d]))

export function nodeDef(type: string): NodeDef | undefined {
  return BY_TYPE.get(type)
}

/** For types the document already holds, which were checked when they were added. */
export function requireNodeDef(type: string): NodeDef {
  const def = BY_TYPE.get(type)
  if (!def) throw new Error(`unknown node type ${type}`)
  return def
}

export function categoryColor(cat: Category): string {
  return CATEGORY_INFO[cat].color
}

export function availableFor(def: NodeDef, kind: Kind): boolean {
  return !def.kinds || def.kinds.includes(kind)
}

export function createNode(type: string, x: number, y: number): ForgeNode {
  const def = requireNodeDef(type)
  const inputs: Record<string, InputValue> = {}
  for (const i of def.inputs) inputs[i.id] = structuredClone(i.default)
  const data: Record<string, unknown> = {}
  for (const o of def.options ?? []) {
    if (o.kind !== "asset") data[o.id] = structuredClone(o.default)
  }
  return { id: uid("n"), type, x, y, inputs, data }
}

export function outputType(kind: Kind): string {
  return KIND_INFO[kind].outputNode
}
