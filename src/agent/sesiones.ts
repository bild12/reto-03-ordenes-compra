// Sesiones en memoria con respaldo en archivo (out/sesiones/<id>.json). Sin base de datos.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Mensaje } from "../llm/adapter.ts"
import type { LlamadaVisible } from "./ciclo.ts"

export type EntradaHistorial = {
  rol: "usuario" | "asistente"
  texto: string
  ts: string
  toolCalls?: LlamadaVisible[]
  needsConfirmation?: boolean
}

export type Sesion = {
  id: string
  creada: string
  mensajes: Mensaje[]
  historial: EntradaHistorial[]
  pendientes: string[]
  tokens: number
  ocupada: boolean
}

export const PATRON_SESION = /^[A-Za-z0-9_-]{6,64}$/

export class AlmacenSesiones {
  private readonly sesiones = new Map<string, Sesion>()
  /** Cargas en curso: dos requests simultáneos con el mismo id comparten el mismo objeto Sesion. */
  private readonly cargando = new Map<string, Promise<Sesion>>()

  constructor(private readonly directorio: string) {}

  private ruta(id: string): string {
    return join(this.directorio, "out", "sesiones", `${id}.json`)
  }

  obtener(id: string): Promise<Sesion> {
    const enMemoria = this.sesiones.get(id)
    if (enMemoria) return Promise.resolve(enMemoria)
    const enCurso = this.cargando.get(id)
    if (enCurso) return enCurso
    const carga = this.cargar(id).finally(() => this.cargando.delete(id))
    this.cargando.set(id, carga)
    return carga
  }

  private async cargar(id: string): Promise<Sesion> {
    try {
      const guardada = JSON.parse(await readFile(this.ruta(id), "utf8")) as Sesion
      const sesion = { ...guardada, ocupada: false }
      this.sesiones.set(id, sesion)
      return sesion
    } catch {
      const nueva: Sesion = { id, creada: new Date().toISOString(), mensajes: [], historial: [], pendientes: [], tokens: 0, ocupada: false }
      this.sesiones.set(id, nueva)
      return nueva
    }
  }

  async existe(id: string): Promise<Sesion | null> {
    if (this.sesiones.has(id)) return this.sesiones.get(id) ?? null
    try {
      return JSON.parse(await readFile(this.ruta(id), "utf8")) as Sesion
    } catch {
      return null
    }
  }

  async guardar(sesion: Sesion): Promise<void> {
    await mkdir(join(this.directorio, "out", "sesiones"), { recursive: true })
    await writeFile(this.ruta(sesion.id), JSON.stringify({ ...sesion, ocupada: false }), "utf8")
  }
}
