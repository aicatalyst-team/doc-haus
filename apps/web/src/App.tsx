import { useState } from "react"
import { Link, Route, Routes } from "react-router-dom"
import Matters from "./pages/Matters"
import MatterDetail from "./pages/MatterDetail"
import Settings from "./components/Settings"
import logo from "./assets/dochaus-logo.svg"

export default function App() {
  const [settings, setSettings] = useState(false)
  return (
    <>
      <header className="app-header">
        <h1>
          <Link to="/">
            <img src={logo} className="app-logo" alt="" />
            <span className="wordmark">Doc.Haus</span>
          </Link>
        </h1>
        <span className="tag">legal agent workspace</span>
        <button className="settings-gear" onClick={() => setSettings(true)} aria-label="Settings" title="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>
      {settings && <Settings onClose={() => setSettings(false)} />}
      <main className="container">
        <Routes>
          <Route path="/" element={<Matters />} />
          <Route path="/matter/:id" element={<MatterDetail />} />
        </Routes>
      </main>
    </>
  )
}
