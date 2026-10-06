// The built-in starting points, in the order the home page lists them.
import type { Starter } from "./builder"
import { classicEffects } from "./effects/classic"
import { mathEffects } from "./effects/math"
import { personEffects } from "./effects/person"
import { classicTransitions } from "./transitions/classic"
import { personTransitions } from "./transitions/person"
import { stylizedTransitions } from "./transitions/stylized"

export type { Starter }

export const STARTERS: Starter[] = [
  ...classicEffects,
  ...mathEffects,
  ...personEffects,
  ...classicTransitions,
  ...personTransitions,
  ...stylizedTransitions,
]
