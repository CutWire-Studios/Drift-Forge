// Tools the built-in assistant ends its turn with to wait for the user. Not offered over MCP, where
// the calling app talks to its own user. Their arguments are read leniently: whatever a model
// manages to ask is still shown.
import { z } from "zod"
import { jsonSchema, type ToolSpec } from "./define"

export interface Question {
  question: string
  options: string[]
}

export interface Plan {
  feasibility: "possible" | "partly" | "not_possible"
  summary: string
  steps: string[]
  limitations: string[]
  question: string
}

/** The run is waiting for the user: questions to answer, or a plan to confirm. */
export type Pending = { kind: "questions"; questions: Question[] } | { kind: "plan"; plan: Plan }

export interface ConversationTool {
  spec: ToolSpec
  /** what to show the user, or why the call can't be shown */
  pending(args: Record<string, unknown>): Pending | { error: string }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const list = (v: unknown, n: number, max: number) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n)

function parseQuestions(args: Record<string, unknown>): Question[] {
  return (Array.isArray(args.questions) ? args.questions : [])
    .slice(0, 3)
    .map((q) => {
      const o = (q && typeof q === "object" ? q : { question: q }) as Record<string, unknown>
      return { question: str(o.question, 300), options: list(o.options, 5, 80) }
    })
    .filter((q) => q.question)
}

const FEASIBILITY: Plan["feasibility"][] = ["possible", "partly", "not_possible"]

function parsePlan(args: Record<string, unknown>): Plan {
  return {
    feasibility: FEASIBILITY.find((f) => f === args.feasibility) ?? "possible",
    summary: str(args.summary, 600),
    steps: list(args.steps, 12, 160),
    limitations: list(args.limitations, 6, 200),
    question: str(args.question, 200) || "Shall I build it?",
  }
}

export const CONVERSATION_TOOLS: ConversationTool[] = [
  {
    spec: {
      name: "ask_user",
      description:
        "Ask the user up to 3 short clarifying questions, each with 2–5 suggested answers they can click. Ends your turn; their answers come in the next message.",
      parameters: jsonSchema(
        z.strictObject({
          questions: z.array(z.strictObject({ question: z.string(), options: z.array(z.string()).max(5).optional() })).max(3),
        }),
      ),
    },
    pending: (args) => {
      const questions = parseQuestions(args)
      return questions.length ? { kind: "questions", questions } : { error: "Give at least one question." }
    },
  },
  {
    spec: {
      name: "propose_plan",
      description:
        "Before building, tell the user whether their idea can be made with Forge's blocks (possible / partly / not_possible), how you'd build it, and what won't match, then ask them to confirm. Ends your turn.",
      parameters: jsonSchema(
        z.strictObject({
          feasibility: z.enum(FEASIBILITY),
          summary: z.string().describe("One or two sentences: what you'll make"),
          steps: z.array(z.string()).max(12).describe("The blocks and wiring, in plain words"),
          limitations: z.array(z.string()).max(6).describe("What can't be done or will differ, and why").optional(),
          question: z.string().describe("e.g. Shall I build it?").optional(),
        }),
      ),
    },
    pending: (args) => ({ kind: "plan", plan: parsePlan(args) }),
  },
]

export const conversationTool = (name: string) => CONVERSATION_TOOLS.find((t) => t.spec.name === name)
