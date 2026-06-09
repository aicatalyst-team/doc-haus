import { useState } from "react"
import { Route, Routes } from "react-router-dom"
import Matters from "./pages/Matters"
import MatterDetail from "./pages/MatterDetail"
import Settings from "./components/Settings"
import Sidebar from "./components/Sidebar"
import { ToastProvider } from "./components/Toast"

export default function App() {
  const [settings, setSettings] = useState(false)
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
        {settings && <Settings onClose={() => setSettings(false)} />}
      </div>
    </ToastProvider>
  )
}
