// What differs between effects, transitions and audio effects, declared once per kind.
import type { Kind } from "./types"

export interface KindInfo {
  label: string
  /** "an effect": for sentences */
  withArticle: string
  /** what a new document is called */
  defaultName: string
  defaultCategory: string
  categories: string[]
  /** package folder, and Drift's user folder it installs into */
  packageRoot: "effects" | "transitions" | "audio-effects"
  /** the package's Drift manifest */
  manifestFile: string
  previewFile: string
  /** what Drift's browser for this kind is called */
  browserName: string
  /** the node graph's sink */
  outputNode: string
  /** what drives animation: seconds into the clip, or 0..1 through the transition */
  clock: "time" | "progress"
}

export const KIND_INFO: Record<Kind, KindInfo> = {
  effect: {
    label: "Effect",
    withArticle: "an effect",
    defaultName: "My effect",
    defaultCategory: "artistic",
    categories: ["color", "glitch", "retro", "dreamy", "impact", "artistic", "funny", "blurs"],
    packageRoot: "effects",
    manifestFile: "effect.json",
    previewFile: "thumbnail.png",
    browserName: "effects",
    outputNode: "effect_output",
    clock: "time",
  },
  transition: {
    label: "Transition",
    withArticle: "a transition",
    defaultName: "My transition",
    defaultCategory: "basic",
    categories: ["basic", "geometric", "distortion", "liquid", "stylized", "glitch", "cinematic"],
    packageRoot: "transitions",
    manifestFile: "transition.json",
    previewFile: "preview_strip.png",
    browserName: "transitions",
    outputNode: "transition_output",
    clock: "progress",
  },
  audio: {
    label: "Audio effect",
    withArticle: "an audio effect",
    defaultName: "My audio effect",
    defaultCategory: "space",
    categories: ["space", "texture", "transmission", "utility", "voice"],
    packageRoot: "audio-effects",
    manifestFile: "audio-effect.json",
    previewFile: "preview_strip.png",
    browserName: "audio effects",
    outputNode: "transition_output",
    clock: "progress",
  },
}
