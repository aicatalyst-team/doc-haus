import ReactMarkdown from "react-markdown"

// Subagent results arrive wrapped by the task tool as
// <task id="..." state="completed"><task_result>…markdown…</task_result></task>.
// Strip that envelope so only the model's markdown reaches the renderer.
function unwrapTaskResult(text: string) {
  const match = text.match(/<task_result>([\s\S]*?)<\/task_result>/)
  return (match ? match[1] : text).trim()
}

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown>{unwrapTaskResult(children)}</ReactMarkdown>
    </div>
  )
}
