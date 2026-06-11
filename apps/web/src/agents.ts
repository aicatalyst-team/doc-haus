// The legal agents this web app surfaces to lawyers. OpenCode also ships upstream
// built-ins (build, plan, general, title, compaction, triage, ...) and the engine
// uses some of them internally — we never expose those. We filter the agent list
// to this registry rather than disabling core agents, so upstream merges stay
// clean. Names must match the agent ids defined in dochaus/agent/*.md.

export type AssistantMeta = { name: string; label: string; description: string }
// `scope` decides which conversation a workflow runs in: "matter" routines span
// every document and open as their own new chat; "document" routines act on the
// thread you are already in and run in the current chat.
export type WorkflowMeta = AssistantMeta & { prompt: string; scope: "matter" | "document"; custom?: boolean }

// Conversational assistants offered in the chat picker. Every name here MUST be a
// real agent id in dochaus/agent/*.md — these are sent to the engine verbatim.
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
  {
    name: "research",
    label: "Research",
    description:
      "Researches legal questions across the matter's documents and U.S. case law, always with citations to real sources.",
  },
  {
    name: "drafter",
    label: "Draft",
    description: "Drafts new documents into this matter — from a firm template or from scratch.",
  },
]

// The Templates page's pinned assistant. Kept out of CHAT_ASSISTANTS on purpose:
// it runs in the template library directory rather than a matter, so the matter
// chat picker and Auto routing never offer it.
export const TEMPLATE_BUILDER: AssistantMeta = {
  name: "template-builder",
  label: "Template Builder",
  description: "Builds and maintains the firm's reusable template library.",
}

// The Workflows page's pinned assistant. Kept out of CHAT_ASSISTANTS on purpose:
// it runs in the workflow library directory rather than a matter, so the matter
// chat picker and Auto routing never offer it.
export const WORKFLOW_BUILDER: AssistantMeta = {
  name: "workflow-builder",
  label: "Workflow Builder",
  description: "Builds and maintains the firm's custom multi-agent review workflows.",
}

// The Skills page's pinned assistant. Kept out of CHAT_ASSISTANTS on purpose: it
// runs in the skill library directory rather than a matter, so the matter chat
// picker and Auto routing never offer it.
export const SKILL_BUILDER: AssistantMeta = {
  name: "skill-builder",
  label: "Skill Builder",
  description: "Builds and maintains the firm's skill library — knowledge the specialist agents apply.",
}

// The Agents page's pinned assistant. Kept out of CHAT_ASSISTANTS on purpose: it
// runs in the agent library directory rather than a matter, so the matter chat
// picker and Auto routing never offer it.
export const AGENT_BUILDER: AssistantMeta = {
  name: "agent-builder",
  label: "Agent Builder",
  description: "Builds and maintains the firm's custom specialist subagents.",
}

// "Auto" is a pseudo-assistant, not a real agent: when it is selected each message
// is first routed by a cheap model to one of the CHAT_ASSISTANTS, and only that
// resolved real agent is ever sent to the engine. AUTO stays out of CHAT_ASSISTANTS
// so the "names match dochaus/agent ids" invariant above holds, and is surfaced at
// the top of the picker separately. isAuto guards the one place that matters — the
// send path — so AUTO can never leak to the engine as an agent.
export const AUTO = "auto"
export const AUTO_ASSISTANT: AssistantMeta = {
  name: AUTO,
  label: "Auto",
  description: "Picks the best assistant for each message automatically.",
}
export const isAuto = (name: string) => name === AUTO

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
