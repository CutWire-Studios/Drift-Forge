const PRECISION: [atLeast: number, digits: number][] = [
  [100, 0],
  [10, 1],
  [1, 2],
]

/** Decimals worth showing for a number of this size: fewer as it grows. */
export function precisionFor(magnitude: number): number {
  return PRECISION.find(([atLeast]) => magnitude >= atLeast)?.[1] ?? 3
}
