import type { ForgeNode, InputValue, Kind } from "@/doc/types"
import { uid } from "@/doc/util"
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

export const CATEGORIES: { id: Category; label: string; color: string }[] = [
  { id: "input", label: "Inputs", color: "#38bdf8" },
  { id: "color", label: "Color", color: "#f472b6" },
  { id: "distort", label: "Distort", color: "#a78bfa" },
  { id: "three", label: "3D", color: "#818cf8" },
  { id: "blur", label: "Blur & Light", color: "#60a5fa" },
  { id: "stylize", label: "Stylize", color: "#fb923c" },
  { id: "generate", label: "Patterns", color: "#34d399" },
  { id: "mix", label: "Mix & Mask", color: "#facc15" },
  { id: "transition", label: "Transition", color: "#f87171" },
  { id: "animate", label: "Animate", color: "#2dd4bf" },
  { id: "math", label: "Math", color: "#94a3b8" },
  { id: "advanced", label: "Advanced", color: "#e879f9" },
  { id: "output", label: "Output", color: "#ffc107" },
]

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

export function categoryColor(cat: Category): string {
  return CATEGORIES.find((c) => c.id === cat)?.color ?? "#999"
}

export function availableFor(def: NodeDef, kind: Kind): boolean {
  return !def.kinds || def.kinds.includes(kind)
}

export function createNode(type: string, x: number, y: number): ForgeNode {
  const def = nodeDef(type)
  if (!def) throw new Error(`unknown node type ${type}`)
  const inputs: Record<string, InputValue> = {}
  for (const i of def.inputs) inputs[i.id] = structuredClone(i.default)
  const data: Record<string, unknown> = {}
  for (const o of def.options ?? []) {
    if (o.kind !== "asset") data[o.id] = structuredClone(o.default)
  }
  return { id: uid("n"), type, x, y, inputs, data }
}

export function outputType(kind: Kind): string {
  return kind === "effect" ? "effect_output" : "transition_output"
}
