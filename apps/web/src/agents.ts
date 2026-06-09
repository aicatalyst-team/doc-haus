// The legal agents this web app surfaces to lawyers. OpenCode also ships upstream
// built-ins (build, plan, general, title, compaction, triage, ...) and the engine
// uses some of them internally — we never expose those. We filter the agent list
// to this registry rather than disabling core agents, so upstream merges stay
// clean. Names must match the agent ids defined in dochaus/agent/*.md.

export type AssistantMeta = { name: string; label: string; description: string }
// `scope` decides which conversation a workflow runs in: "matter" routines span
// every document and open as their own new chat; "document" routines act on the
// thread you are already in and run in the current chat.
export type WorkflowMeta = AssistantMeta & { prompt: string; scope: "matter" | "document" }

// Conversational assistants offered in the chat picker.
export const CHAT_ASSISTANTS: AssistantMeta[] = [
  {
    name: "qa",
    label: "Q&A",
    description: "Answers questions about this matter's documents, always with citations.",
  },
  {
    name: "redliner",
    label: "Redline",
    description: "Edits and redlines this matter's documents as tracked changes you accept or reject in Word.",
  },
]

// Multi-step routines launched from the Workflows control. Each runs as its own
// session and renders into the artifact panel.
export const WORKFLOWS: WorkflowMeta[] = [
  {
    name: "legal-review",
    label: "Full review",
    description: "A reviewer, a challenger, and a summarizer read every document and return one combined report.",
    scope: "matter",
    prompt:
      "Run a complete legal review of the documents in this matter. Coordinate the reviewer, challenger, and summarizer subagents and return the combined report.",
  },
]
