import { lazy, Suspense } from "react"
import { createBrowserRouter, RouterProvider } from "react-router"
import { Home } from "@/features/home"
import { NotFound } from "./NotFound"
import { Toasts } from "@/shared/ui/toast"

const Editor = lazy(() => import("@/features/editor").then((m) => ({ default: m.Editor })))

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  {
    path: "/edit/:id",
    element: (
      <Suspense fallback={<main className="page empty-page" />}>
        <Editor />
      </Suspense>
    ),
  },
  { path: "*", element: <NotFound /> },
])

export function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toasts />
    </>
  )
}
