import { cycleTheme, useResolvedTheme } from "@/lib/theme"

export function ThemeToggle() {
  const dark = useResolvedTheme() === "dark"
  return (
    <button
      className="icon-btn"
      type="button"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      onClick={cycleTheme}
    >
      {dark ? (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 2.6v2.4M12 19v2.4M2.6 12h2.4M19 12h2.4" />
            <path d="M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7" />
          </g>
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M20.2 14.2A8.4 8.4 0 0 1 9.8 3.8a8.4 8.4 0 1 0 10.4 10.4Z" fill="currentColor" />
        </svg>
      )}
    </button>
  )
}
