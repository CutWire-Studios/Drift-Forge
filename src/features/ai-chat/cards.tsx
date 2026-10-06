import { useState } from "react"
import type { Plan, Question } from "@/core/ai/agent"

export function QuestionsCard({ questions, active, onAnswer }: { questions: Question[]; active: boolean; onAnswer: (text: string) => void }) {
  const [picked, setPicked] = useState<string[]>(() => questions.map(() => ""))
  const pick = (i: number, v: string) => setPicked((p) => p.map((x, j) => (j === i ? v : x)))
  const toggle = (i: number, o: string) => pick(i, picked[i] === o ? "" : o)
  const answered = picked.filter(Boolean).length
  const answer = (i: number) => (questions.length > 1 ? `${questions[i].question} ${picked[i]}` : picked[i])
  const submit = () => onAnswer(picked.flatMap((p, i) => (p ? [answer(i)] : [])).join("\n"))
  return (
    <div className="ai-card">
      {questions.map((q, i) => (
        <div key={i} className="ai-question">
          <p>{q.question}</p>
          {q.options.length > 0 && (
            <div className="ai-options">
              {q.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  className={`ai-suggestion${picked[i] === o ? " selected" : ""}`}
                  disabled={!active}
                  onClick={() => (questions.length === 1 ? onAnswer(o) : toggle(i, o))}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {active && questions.length > 1 && (
        <button type="button" className="btn btn-primary btn-sm" disabled={!answered} onClick={submit}>
          Send answers
        </button>
      )}
      {active && <p className="meta small">Or type your own answer below.</p>}
    </div>
  )
}

const FEASIBILITY: Record<Plan["feasibility"], string> = {
  possible: "Can be built",
  partly: "Partly possible",
  not_possible: "Not possible in Forge",
}

export function PlanCard({ plan, active, onAnswer }: { plan: Plan; active: boolean; onAnswer: (text: string) => void }) {
  return (
    <div className="ai-card">
      <span className={`ai-feasibility ai-feasibility-${plan.feasibility}`}>{FEASIBILITY[plan.feasibility]}</span>
      <p>{plan.summary}</p>
      {plan.steps.length > 0 && (
        <ol className="ai-steps">
          {plan.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {plan.limitations.length > 0 && (
        <ul className="ai-limits">
          {plan.limitations.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      <p className="meta">{plan.question}</p>
      {active && plan.feasibility !== "not_possible" && (
        <div className="ai-options">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onAnswer("Yes, build it.")}>
            Build it
          </button>
          <span className="meta small">or type what to change below</span>
        </div>
      )}
    </div>
  )
}
