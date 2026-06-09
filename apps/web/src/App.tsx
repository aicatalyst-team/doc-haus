import { useEffect, useState } from "react"
import { Route, Routes } from "react-router-dom"
import Matters from "./pages/Matters"
import MatterDetail from "./pages/MatterDetail"
import Settings from "./components/Settings"
import Sidebar from "./components/Sidebar"
import { ToastProvider } from "./components/Toast"
import { getConfig } from "./api/opencode"

export default function App() {
  const [settings, setSettings] = useState(false)
  // First launch with no default model picked yet: there is no hard-coded default
  // (a client may run Vertex, Anthropic, a local model...), so open Settings in
  // first-run mode and let them connect a provider and choose their model.
  const [firstRun, setFirstRun] = useState(false)
  useEffect(() => {
    getConfig()
      .then((cfg) => {
        if (cfg.model) return
        setFirstRun(true)
        setSettings(true)
      })
      .catch(() => {})
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
              <Route
                path="/matter/:id"
                element={<MatterDetail onSessionsChanged={() => setSessionsVersion((v) => v + 1)} />}
              />
            </Routes>
          </div>
        </main>
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
