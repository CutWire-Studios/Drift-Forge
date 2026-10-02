import { Link } from "react-router"
import { AppHeader } from "./AppHeader"

export function NotFound() {
  return (
    <>
      <AppHeader />
      <main className="page empty-page">
        <h1>Nothing here</h1>
        <p className="meta">That page doesn't exist.</p>
        <Link className="btn btn-primary" to="/">
          Back to Drift Forge
        </Link>
      </main>
    </>
  )
}
