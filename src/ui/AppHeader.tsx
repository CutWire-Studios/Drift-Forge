import type { ReactNode } from "react"
import { Link } from "react-router"
import driftIcon from "@/lib/drift-icon.png"
import logo from "@/lib/cutwire-logo.svg?raw"
import { ThemeToggle } from "./ThemeToggle"

export function Brand() {
  return (
    <div className="brand">
      <a className="mark" href="https://cutwire.org" rel="noopener" aria-label="Cutwire" dangerouslySetInnerHTML={{ __html: logo }} />
      <span className="divider" aria-hidden="true" />
      <Link className="drift" to="/">
        <img src={driftIcon} alt="" width="28" height="28" />
        <span>
          Drift <b>Forge</b>
        </span>
      </Link>
    </div>
  )
}

export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="header">
      <div className="page header-inner">
        <Brand />
        <div className="header-actions">
          {children}
          <a className="btn btn-tertiary btn-sm hide-sm" href="https://cutwire.org/drift" rel="noopener">
            Get Drift
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
