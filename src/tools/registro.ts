// Registro y ejecutor de herramientas: validación zod de argumentos, nombre `<archivo>_<export>`,
// bitácora out/log.jsonl y resumen corto para el chat. Lo usan el servidor y demo.ts por igual.
import { z } from "zod/v4"

// Mensajes de validación en español para todo el proyecto (herramientas y API).
z.config(z.locales.es())
import { registrarLog } from "../dominio/bitacoras.ts"
import * as oc from "./oc.ts"
import type { Contexto } from "./oc.ts"

type Herramienta = {
  description: string
  args: Record<string, z.ZodType>
  execute(args: never, ctx: Contexto): Promise<string>
}

function esHerramienta(valor: unknown): valor is Herramienta {
  return typeof valor === "object" && valor !== null && "description" in valor && "args" in valor && "execute" in valor
}

/** Archivo → módulo. Agregar un archivo de herramientas es agregar una línea aquí. */
const MODULOS: Record<string, Record<string, unknown>> = { oc }

export const HERRAMIENTAS: Record<string, Herramienta> = Object.fromEntries(
  Object.entries(MODULOS).flatMap(([archivo, modulo]) =>
    Object.entries(modulo).filter(([, valor]) => esHerramienta(valor)).map(([exportado, valor]) => [`${archivo}_${exportado}`, valor as Herramienta]),
  ),
)

export type DefinicionHerramienta = { nombre: string; descripcion: string; esquema: Record<string, unknown> }

export function definiciones(): DefinicionHerramienta[] {
  return Object.entries(HERRAMIENTAS).map(([nombre, h]) => {
    const { $schema: _omitido, ...esquema } = z.toJSONSchema(z.object(h.args)) as Record<string, unknown>
    return { nombre, descripcion: h.description, esquema }
  })
}

export type ResultadoEjecucion = { nombre: string; argumentos: Record<string, unknown>; ok: boolean; resumen: string; salida: string }

function resumir(nombre: string, data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>
  switch (nombre) {
    case "oc_leer_paquete": {
      const s = d["solicitud"] as Record<string, unknown> | undefined
      const faltantes = (d["faltantes"] as string[] | undefined) ?? []
      return `${String(s?.["solicitud_id"])} · ${String(s?.["proveedor_nombre"])} · total ${String(s?.["valor_total"])}${faltantes.length ? ` · faltan: ${faltantes.join(", ")}` : ""}`
    }
    case "oc_validar": {
      const codigos = (k: string): string => ((d[k] as { codigo: string }[] | undefined) ?? []).map((h) => h.codigo).join(", ") || "ninguna"
      return `apta=${String(d["apta"])} · bloqueos: ${codigos("bloqueos")} · confirmaciones: ${codigos("confirmaciones")} · retroactiva=${String(d["retroactiva"])}`
    }
    case "oc_construir_payload":
      return `payload válido · trazabilidad en ${String(d["ruta_trazabilidad"])}`
    case "oc_generar_evidencia":
      return `${String(d["ruta"])} · sha256 ${String(d["sha256"]).slice(0, 12)}…`
    case "oc_crear":
      return d["idempotente"] ? `OC ${String(d["numero_oc"])} ya existía (idempotente)` : `OC ${String(d["numero_oc"])} creada`
    default:
      return "ok"
  }
}

/** Ejecuta una herramienta por nombre. Nunca lanza: todo error vuelve como { ok: false, error }. */
export async function ejecutarHerramienta(nombre: string, argumentos: Record<string, unknown>, ctx: Contexto): Promise<ResultadoEjecucion> {
  const herramienta = HERRAMIENTAS[nombre]
  let salida: string
  if (!herramienta) {
    salida = JSON.stringify({ ok: false, error: `herramienta desconocida: ${nombre}` })
  } else {
    const validados = z.object(herramienta.args).safeParse(argumentos)
    if (!validados.success) {
      const detalle = validados.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")
      salida = JSON.stringify({ ok: false, error: `argumentos inválidos: ${detalle}` })
    } else {
      salida = await herramienta.execute(validados.data as never, ctx)
    }
  }
  const parseado = JSON.parse(salida) as { ok: boolean; data?: unknown; error?: string }
  const resumen = parseado.ok ? resumir(nombre, parseado.data) : `error: ${String(parseado.error)}`
  // Se registran los argumentos escalares (caso, confirmado); payloads grandes se resumen por tamaño.
  const argumentosLog = Object.fromEntries(Object.entries(argumentos).map(([k, v]) => [k, typeof v === "object" && v !== null ? `<${k}: ${JSON.stringify(v).length} caracteres>` : v]))
  await registrarLog(ctx.directory, { sessionId: ctx.sessionId, herramienta: nombre, argumentos: argumentosLog, ok: parseado.ok, resumen: resumen.slice(0, 300) }).catch(() => undefined)
  return { nombre, argumentos, ok: parseado.ok, resumen, salida }
}
