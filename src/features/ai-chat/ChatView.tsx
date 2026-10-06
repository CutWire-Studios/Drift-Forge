import { signIn } from "@/services/account/client"
import { PlanCard, QuestionsCard } from "./cards"
import type { Line } from "./lines"

const SUGGESTIONS = [
  "Make it look like an old VHS tape with a slight wobble",
  "A dreamy glow with warm highlights",
  "A glitch that gets stronger on the beat of a pulse",
]

const AUDIO_SUGGESTIONS = [
  "Make a voice sound like it's on an old radio in another room",
  "A slow, wide shimmer that swells behind the sound",
  "Punchy drums: squash them, but keep the dry hit underneath",
]

interface Props {
  lines: Line[]
  busy: string | null
  isAudio: boolean
  needsSignIn: boolean
  send: (text: string) => void
}

export function ChatView({ lines, busy, isAudio, needsSignIn, send }: Props) {
  if (needsSignIn) {
    return (
      <div className="ai-empty">
        <p>The built-in AI is free with a CutWire account (a daily allowance per person).</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={signIn}>
          Sign in with CutWire account
        </button>
        <p className="meta small">Or pick your own AI provider above.</p>
      </div>
    )
  }
  if (!lines.length) {
    return (
      <div className="ai-empty">
        <p className="meta">Describe what you want and the AI builds it with {isAudio ? "pedals" : "blocks"} you can then tweak.</p>
        {(isAudio ? AUDIO_SUGGESTIONS : SUGGESTIONS).map((s) => (
          <button key={s} type="button" className="ai-suggestion" onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>
    )
  }
  return lines.map((l, i) => <LineView key={i} line={l} active={i === lines.length - 1 && !busy} send={send} />)
}

function LineView({ line: l, active, send }: { line: Line; active: boolean; send: (text: string) => void }) {
  switch (l.role) {
    case "thinking":
      return (
        <details className="ai-thinking" open={l.live || undefined}>
          <summary>{l.live ? "Thinking…" : "Thinking"}</summary>
          <div>{l.text}</div>
        </details>
      )
    case "tool":
      return <div className={`ai-tool${l.error ? " ai-tool-error" : ""}`}>{l.text}</div>
    case "pending":
      if (l.pending.kind === "questions") return <QuestionsCard questions={l.pending.questions} active={active} onAnswer={send} />
      return <PlanCard plan={l.pending.plan} active={active} onAnswer={send} />
    default:
      return <div className={`ai-line ai-${l.role}`}>{l.text}</div>
  }
}
