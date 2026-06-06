// The two backends apps/web talks to. Override via Vite env at build/dev time.
export const OPENCODE_URL = import.meta.env.VITE_OPENCODE_URL ?? "http://localhost:4096"
export const INGEST_URL = import.meta.env.VITE_INGEST_URL ?? "http://localhost:4500"
