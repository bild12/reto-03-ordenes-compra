// Implementación del adaptador para Anthropic (Claude). Única pieza que conoce el SDK.
import Anthropic from "@anthropic-ai/sdk"
import { ErrorProveedor, type DefinicionHerramienta, type Mensaje, type ProveedorLLM, type RespuestaModelo } from "./adapter.ts"

type BloqueEntrada =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string }

type MensajeAnthropic = { role: "user" | "assistant"; content: BloqueEntrada[] }

export class ProveedorAnthropic implements ProveedorLLM {
  readonly nombre = "anthropic"
  private readonly cliente: Anthropic

  constructor(clave: string, readonly modelo: string, timeoutMs: number) {
    if (!clave) throw new ErrorProveedor("Falta ANTHROPIC_API_KEY en el entorno del servidor.")
    this.cliente = new Anthropic({ apiKey: clave, timeout: timeoutMs, maxRetries: 1 })
  }

  private convertir(mensajes: Mensaje[]): { sistema: string; conversacion: MensajeAnthropic[] } {
    const sistema = mensajes.filter((m) => m.rol === "sistema").map((m) => m.texto).join("\n\n")
    const conversacion: MensajeAnthropic[] = []
    for (const m of mensajes) {
      if (m.rol === "usuario") conversacion.push({ role: "user", content: [{ type: "text", text: m.texto }] })
      if (m.rol === "asistente") {
        const bloques: BloqueEntrada[] = m.texto ? [{ type: "text", text: m.texto }] : []
        for (const l of m.llamadas) bloques.push({ type: "tool_use", id: l.id, name: l.nombre, input: l.argumentos })
        conversacion.push({ role: "assistant", content: bloques.length > 0 ? bloques : [{ type: "text", text: "(sin texto)" }] })
      }
      if (m.rol === "resultados") {
        conversacion.push({ role: "user", content: m.resultados.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.contenido })) })
      }
    }
    return { sistema, conversacion }
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaModelo> {
    const { sistema, conversacion } = this.convertir(mensajes)
    try {
      const respuesta = await this.cliente.messages.create({
        model: this.modelo,
        max_tokens: 4096,
        // Prompt caching: el prompt de sistema y las herramientas no cambian entre iteraciones,
        // así que se cachean y las lecturas siguientes se cobran a una fracción del precio de entrada.
        system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
        messages: conversacion,
        tools: herramientas.map((h, i) => ({
          name: h.nombre,
          description: h.descripcion,
          input_schema: { ...h.esquema, type: "object" as const },
          ...(i === herramientas.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
        })),
      })
      const texto = respuesta.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim()
      const llamadas = respuesta.content.flatMap((b) =>
        b.type === "tool_use" ? [{ id: b.id, nombre: b.name, argumentos: (b.input ?? {}) as Record<string, unknown> }] : [],
      )
      const u = respuesta.usage
      const entrada = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      return { texto, llamadas, uso: { entrada, salida: u.output_tokens, cache_leido: u.cache_read_input_tokens ?? 0 } }
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) throw new ErrorProveedor("El modelo no respondió a tiempo. Intenta de nuevo en unos segundos.")
      if (error instanceof Anthropic.AuthenticationError) throw new ErrorProveedor("La clave del proveedor no es válida. Revisa la configuración del servidor.")
      if (error instanceof Anthropic.RateLimitError) throw new ErrorProveedor("El proveedor del modelo limitó las solicitudes. Espera un momento y reintenta.")
      if (error instanceof Anthropic.APIError) throw new ErrorProveedor(`El proveedor del modelo devolvió un error (${String(error.status ?? "sin código")}).`)
      throw new ErrorProveedor("No fue posible comunicarse con el modelo.")
    }
  }
}
