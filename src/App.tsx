import { lazy, Suspense } from "react"
import { createBrowserRouter, RouterProvider } from "react-router"
import { Home } from "./ui/Home"
import { NotFound } from "./ui/NotFound"
import { Toasts } from "./ui/toast"

const Editor = lazy(() => import("./ui/editor/Editor").then((m) => ({ default: m.Editor })))

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
