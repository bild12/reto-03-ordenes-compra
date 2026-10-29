// SAP simulado sobre archivos: out/sap/ordenes.jsonl. Numeración secuencial desde 4500000001.
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { PARAMETROS } from "../dominio/controles.ts"
import { cargarMaestros } from "../dominio/fuentes.ts"
import { normalizarNit } from "../dominio/normalizar.ts"
import type { OrdenCompra } from "../dominio/payload.ts"
import type { SapAdapter } from "./adapter.ts"

type Registro = { numero_oc: string; fecha: string; solicitud_id: string; orden: OrdenCompra }

/** Serializa las escrituras dentro del proceso: dos creaciones simultáneas no toman el mismo número. */
let cola: Promise<unknown> = Promise.resolve()
function enSerie<T>(tarea: () => Promise<T>): Promise<T> {
  const siguiente = cola.then(tarea, tarea)
  cola = siguiente.catch(() => undefined)
  return siguiente
}

export class SapMock implements SapAdapter {
  private readonly archivo: string

  constructor(private readonly directorio: string) {
    this.archivo = join(directorio, "out", "sap", "ordenes.jsonl")
  }

  private async leer(): Promise<Registro[]> {
    try {
      const texto = await readFile(this.archivo, "utf8")
      return texto.split("\n").filter(Boolean).map((linea) => JSON.parse(linea) as Registro)
    } catch {
      return []
    }
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const { proveedores } = await cargarMaestros(this.directorio)
    const encontrado = proveedores.find((p) => normalizarNit(p.nit) === normalizarNit(nit))
    return encontrado ? { codigo_sap: encontrado.codigo_sap, activo: encontrado.activo } : null
  }

  /** Devuelve también la fecha (campo adicional compatible con la interfaz) para respuestas idempotentes. */
  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha: string } | null> {
    const existente = (await this.leer()).find((r) => r.solicitud_id === solicitud_id)
    return existente ? { numero_oc: existente.numero_oc, fecha: existente.fecha } : null
  }

  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    return enSerie(() => this.crearEnSerie(orden))
  }

  private async crearEnSerie(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    // Idempotencia también en el adaptador: un reintento con la misma referencia no duplica.
    const previa = await this.buscarOrdenPorReferencia(orden.referencia.solicitud_id)
    if (previa) return previa
    const registros = await this.leer()
    const numero_oc = String(PARAMETROS.primer_numero_oc + registros.length)
    const fecha = new Date().toISOString().slice(0, 10)
    await mkdir(join(this.directorio, "out", "sap"), { recursive: true })
    const registro: Registro = { numero_oc, fecha, solicitud_id: orden.referencia.solicitud_id, orden }
    await appendFile(this.archivo, `${JSON.stringify(registro)}\n`, "utf8")
    return { numero_oc, fecha }
  }
}
