import { Hono } from "hono"
import { cors } from "hono/cors"
import { openDb, listDocuments } from "./db"
import { ingestDocx } from "./ingest"
import { listMatters, createMatter, getMatter, matterDir } from "./matter"
import { existsSync } from "node:fs"
import path from "node:path"

const app = new Hono()
app.use("*", cors())

app.get("/matters", (c) => c.json(listMatters()))

app.post("/matters", async (c) => {
  const { title } = await c.req.json<{ title: string }>()
  return c.json(createMatter(title))
})

app.get("/matters/:id", (c) => {
  const matter = getMatter(c.req.param("id"))
  const dbPath = path.join(matter.dir, ".dochaus", "legal.db")
  const documents = existsSync(dbPath) ? listDocuments(openDb(matter.dir)) : []
  return c.json({ ...matter, documents })
})

app.post("/matters/:id/documents", async (c) => {
  const dir = matterDir(c.req.param("id"))
  const body = await c.req.parseBody()
  const file = body["file"] as File
  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await ingestDocx(dir, file.name, buffer)
  return c.json(result)
})

const port = Number(process.env.INGEST_PORT ?? 4500)
console.log(`doc.haus ingest service listening on http://localhost:${port}`)
export default { port, fetch: app.fetch }
