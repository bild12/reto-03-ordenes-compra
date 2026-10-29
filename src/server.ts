// API HTTP del chat. Rutas: POST /api/chat · GET /api/sessions/:id · GET /api/health · GET / (front).
import { timingSafeEqual } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Hono } from "hono"
import { z } from "zod/v4"
import { ejecutarTurno } from "./agent/ciclo.ts"
import { ConsumoDiario } from "./agent/consumo.ts"
import { AlmacenSesiones, PATRON_SESION } from "./agent/sesiones.ts"
import { config } from "./config.ts"
import { ErrorProveedor, type ProveedorLLM } from "./llm/adapter.ts"
import { crearProveedor } from "./llm/index.ts"

const directorio = process.cwd()
const sesiones = new AlmacenSesiones(directorio)

let llm: ProveedorLLM | null = null
let errorConfiguracion = ""
try {
  llm = crearProveedor()
} catch (error) {
  errorConfiguracion = error instanceof ErrorProveedor ? error.message : "Configuración del modelo inválida."
}

const CuerpoChat = z.object({
  sessionId: z.string().regex(PATRON_SESION).optional(),
  message: z.string().trim().min(1, "el mensaje está vacío").max(4000, "el mensaje supera 4000 caracteres"),
  /** Confirmación estructurada desde el front: casos que el usuario confirmó con el botón. */
  confirmar: z.array(z.string().regex(/^[a-z0-9-]{1,64}$/)).max(20).optional(),
})

// Tope global diario de tokens (persistido en out/): abrir sesiones nuevas o reiniciar el servidor
// no permite saltarse el control de costo.
const consumoDiario = new ConsumoDiario(directorio, config.maxTokensDia)

function claveValida(recibida: string | undefined): boolean {
  const a = Buffer.from(recibida ?? "")
  const b = Buffer.from(config.claveAcceso)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const app = new Hono()

// Protección opcional del link público: si ACCESS_KEY está definida, se exige en /api/chat y /api/sessions.
app.use("/api/*", async (c, next) => {
  if (!config.claveAcceso || c.req.path === "/api/health") return next()
  if (!claveValida(c.req.header("x-access-key"))) return c.json({ ok: false, error: "clave de acceso inválida" }, 401)
  return next()
})

app.get("/api/health", (c) =>
  c.json({ ok: llm !== null, provider: config.proveedor, model: config.modelo, requiere_clave_acceso: Boolean(config.claveAcceso), ...(llm ? {} : { error: errorConfiguracion }) }),
)

app.post("/api/chat", async (c) => {
  const cuerpo = CuerpoChat.safeParse(await c.req.json().catch(() => null))
  if (!cuerpo.success) return c.json({ ok: false, error: cuerpo.error.issues.map((i) => i.message).join("; ") }, 400)
  if (!llm) return c.json({ ok: false, error: errorConfiguracion }, 503)
  if (consumoDiario.alcanzado()) return c.json({ ok: false, error: "se alcanzó el tope diario de uso del modelo configurado para este servicio; intenta mañana" }, 429)
  const sessionId = cuerpo.data.sessionId ?? crypto.randomUUID()
  const sesion = await sesiones.obtener(sessionId)
  if (sesion.ocupada) return c.json({ ok: false, error: "la sesión está procesando otro mensaje" }, 409)
  sesion.ocupada = true
  try {
    const turno = await ejecutarTurno(sesion, cuerpo.data.message, llm, {
      directorio,
      maxIteraciones: config.maxIteraciones,
      maxTokensSesion: config.maxTokensSesion,
    }, cuerpo.data.confirmar)
    await consumoDiario.sumar(turno.uso.tokens_turno).catch(() => undefined)
    return c.json({ ok: true, sessionId, ...turno })
  } catch {
    return c.json({ ok: true, sessionId, reply: "⚠️ Ocurrió un error interno procesando el turno. La sesión sigue activa.", toolCalls: [], needsConfirmation: false, pendientes: sesion.pendientes, confirmados: [] })
  } finally {
    sesion.ocupada = false
    await sesiones.guardar(sesion).catch(() => undefined)
  }
})

app.get("/api/sessions/:id", async (c) => {
  const id = c.req.param("id")
  if (!PATRON_SESION.test(id)) return c.json({ ok: false, error: "id de sesión inválido" }, 400)
  const sesion = await sesiones.existe(id)
  if (!sesion) return c.json({ ok: false, error: "sesión no encontrada" }, 404)
  return c.json({ ok: true, sessionId: id, creada: sesion.creada, tokens: sesion.tokens, pendientes: sesion.pendientes, historial: sesion.historial })
})

app.get("/", async (c) => c.html(await readFile(join(directorio, "web", "index.html"), "utf8")))

export default { port: config.puerto, fetch: app.fetch }

console.log(`Agente de órdenes de compra en http://localhost:${config.puerto} · proveedor ${config.proveedor} · modelo ${config.modelo}${llm ? "" : ` · ⚠️ ${errorConfiguracion}`}`)
