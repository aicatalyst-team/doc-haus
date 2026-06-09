import { Link, Route, Routes } from "react-router-dom"
import Matters from "./pages/Matters"
import MatterDetail from "./pages/MatterDetail"
import logo from "./assets/dochaus-logo.svg"

export default function App() {
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
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Matters />} />
          <Route path="/matter/:id" element={<MatterDetail />} />
        </Routes>
      </main>
    </>
  )
}
