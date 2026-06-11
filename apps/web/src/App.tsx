import { useEffect, useState } from "react"
import { Route, Routes } from "react-router-dom"
import Matters from "./pages/Matters"
import Templates from "./pages/Templates"
import Workflows from "./pages/Workflows"
import MatterDetail from "./pages/MatterDetail"
import Settings from "./components/Settings"
import Onboarding from "./components/Onboarding"
import Sidebar from "./components/Sidebar"
import { ToastProvider } from "./components/Toast"
import { getConfig } from "./api/opencode"

export default function App() {
  const [settings, setSettings] = useState(false)
  const [firstRun, setFirstRun] = useState(false)
  // First launch with no default model picked yet: there is no hard-coded default
  // (a client may run Vertex, Anthropic, a local model...), so open the focused
  // onboarding modal — it auto-detects connected providers and asks only for the
  // primary + fast models, falling back to a connect step when none are found.
  const [onboarding, setOnboarding] = useState(false)
  useEffect(() => {
    let cancelled = false
    // The engine ('opencode serve') may still be booting when the web app loads,
    // so getConfig rejects until it's reachable. Poll until it answers, then gate
    // onboarding on the real config rather than silently skipping it on the first
    // failed call.
    async function check() {
      while (!cancelled) {
        try {
          const cfg = await getConfig()
          if (!cancelled && !cfg.model) setOnboarding(true)
          return
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])
  // Bumped when a matter mints a new conversation, so the sidebar re-lists its
  // chats the instant one starts rather than waiting for the turn to settle.
  const [sessionsVersion, setSessionsVersion] = useState(0)
  return (
    <ToastProvider>
      <div className="shell">
        <Sidebar onOpenSettings={() => setSettings(true)} sessionsVersion={sessionsVersion} />
        <main className="content">
          <div className="container">
            <Routes>
              <Route path="/" element={<Matters />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/workflows" element={<Workflows />} />
              <Route
                path="/matter/:id"
                element={<MatterDetail onSessionsChanged={() => setSessionsVersion((v) => v + 1)} />}
              />
            </Routes>
          </div>
        </main>
        {onboarding && (
          <Onboarding
            onClose={() => setOnboarding(false)}
            onOpenSettings={() => {
              setOnboarding(false)
              setFirstRun(true)
              setSettings(true)
            }}
          />
        )}
        {settings && (
          <Settings
            firstRun={firstRun}
            onClose={() => {
              setSettings(false)
              setFirstRun(false)
            }}
          />
        )}
      </div>
    </ToastProvider>
  )
}
