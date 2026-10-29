// Bitácoras: out/control.csv (auditoría, una fila por intento de creación) y out/log.jsonl (herramientas).
import { appendFile, mkdir, stat } from "node:fs/promises"
import { join } from "node:path"

export type ResultadoControl = "creada" | "idempotente" | "bloqueada" | "pendiente_confirmacion" | "rechazada_integridad" | "error"

export type FilaControl = {
  solicitud_id: string
  resultado: ResultadoControl
  numero_oc: string
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

const ENCABEZADO = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n"

function csv(valor: string): string {
  return /[",\n;]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta)
    return true
  } catch {
    return false
  }
}

export async function registrarControl(directorio: string, fila: FilaControl): Promise<void> {
  const ruta = join(directorio, "out", "control.csv")
  await mkdir(join(directorio, "out"), { recursive: true })
  if (!(await existe(ruta))) await appendFile(ruta, ENCABEZADO, "utf8")
  const linea = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc,
    String(fila.retroactiva),
    fila.bloqueos.join(";"),
    fila.confirmaciones.join(";"),
    new Date().toISOString(),
  ].map(csv).join(",")
  await appendFile(ruta, `${linea}\n`, "utf8")
}

export type EntradaLog = { sessionId: string; herramienta: string; argumentos: Record<string, unknown>; ok: boolean; resumen: string }

export async function registrarLog(directorio: string, entrada: EntradaLog): Promise<void> {
  await mkdir(join(directorio, "out"), { recursive: true })
  const linea = JSON.stringify({ ts: new Date().toISOString(), ...entrada })
  await appendFile(join(directorio, "out", "log.jsonl"), `${linea}\n`, "utf8")
}
