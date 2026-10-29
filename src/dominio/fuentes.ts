// Lectura y normalización de fuentes: paquete del caso (correo, solicitud, cotización,
// aprobación, factura) y maestros. Todo es de solo lectura sobre fixtures/.
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod/v4"
import { fechaLocal, normalizarNit, parsearMonto, sumarDias } from "./normalizar.ts"

export const RAIZ_FIXTURES = join("fixtures", "reto-03")

const montoEsquema = z.union([z.number(), z.string()]).transform((valor, ctx) => {
  const monto = parsearMonto(valor)
  if (monto === null) {
    ctx.addIssue({ code: "custom", message: `monto no numérico: "${String(valor)}"` })
    return z.NEVER
  }
  if (monto <= 0) {
    ctx.addIssue({ code: "custom", message: `el monto debe ser mayor que cero (recibido ${String(valor)})` })
    return z.NEVER
  }
  return monto
})

export const SolicitudEsquema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: montoEsquema,
  valor_unitario: montoEsquema,
  valor_total: montoEsquema,
  moneda: z.string().min(3),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string().refine((v) => fechaLocal(v) !== null, "fecha_solicitud inválida"),
})
export type Solicitud = z.infer<typeof SolicitudEsquema>

const CorreoEsquema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
})

export const AprobacionCrudaEsquema = z.object({
  de: z.string(),
  para: z.string(),
  cc: z.array(z.string()).optional(),
  fecha: z.string(),
  asunto: z.string(),
  cuerpo: z.string(),
})
export type AprobacionCruda = z.infer<typeof AprobacionCrudaEsquema>

export type Cotizacion = {
  referencia: string | null
  proveedor: string
  nit: string | null
  total: number
  moneda: string
  fecha: string | null
  validez_hasta: string | null
  texto: string
}

export type Aprobacion = {
  de: string
  fecha: string
  aprobado: boolean
  monto_mencionado: number | null
  texto: string
}

export type Factura = { numero: string; fecha: string; total: number }

export type Paquete = {
  correo: { id: string; de: string; asunto: string; fecha: string }
  solicitud: Solicitud
  cotizacion: Cotizacion | null
  aprobacion: Aprobacion | null
  factura: Factura | null
  faltantes: string[]
}

const ProveedorEsquema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})
const CentroCostoEsquema = z.object({
  centro_costo: z.string(),
  nombre: z.string(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string(), tope: z.number() })),
})
const IndicadorEsquema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() })
const CondicionEsquema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() })

export type Proveedor = z.infer<typeof ProveedorEsquema>
export type CentroCosto = z.infer<typeof CentroCostoEsquema>
export type Maestros = {
  proveedores: Proveedor[]
  centros: CentroCosto[]
  indicadoresIva: z.infer<typeof IndicadorEsquema>[]
  condicionesPago: z.infer<typeof CondicionEsquema>[]
}

async function leerTextoOpcional(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8")
  } catch {
    return null
  }
}

/** JSON.parse con mensaje en español y nombre del archivo, apto para mostrar a la analista. */
function parsearJson(texto: string, archivo: string): unknown {
  try {
    return JSON.parse(texto) as unknown
  } catch {
    throw new Error(`el archivo ${archivo} no es un JSON válido: pida al solicitante que lo reenvíe`)
  }
}

async function leerMaestro<T>(ruta: string, esquema: z.ZodType<T>): Promise<T> {
  const archivo = ruta.split(/[\\/]/).pop() ?? ruta
  const resultado = esquema.safeParse(parsearJson(await readFile(ruta, "utf8"), archivo))
  if (!resultado.success) throw new Error(`el maestro ${archivo} no tiene la estructura esperada`)
  return resultado.data
}

function campo(texto: string, etiqueta: RegExp): string | null {
  const coincide = etiqueta.exec(texto)
  return coincide?.[1]?.trim() ?? null
}

export function parsearCotizacion(texto: string): Cotizacion | { error: string } {
  const totalCrudo = campo(texto, /TOTAL[^:\n]*:\s*([A-Z]{3}\s*[\d.,]+)/i)
  const total = parsearMonto(totalCrudo)
  if (total === null || !totalCrudo) return { error: "la cotización no tiene un TOTAL legible" }
  const fecha = fechaLocal(campo(texto, /^Fecha:\s*(\S+)/im))
  const dias = Number(campo(texto, /Validez[^:\n]*:\s*(\d+)\s*d[ií]as/i) ?? Number.NaN)
  return {
    referencia: campo(texto, /^COTIZACI[OÓ]N\s+(\S+)/im),
    proveedor: campo(texto, /^Proveedor:\s*(.+)$/im) ?? "",
    nit: normalizarNit(campo(texto, /^NIT:\s*(\S+)/im)),
    total,
    moneda: totalCrudo.slice(0, 3).toUpperCase(),
    fecha,
    validez_hasta: fecha && Number.isFinite(dias) ? sumarDias(fecha, dias) : null,
    texto,
  }
}

export function parsearFactura(texto: string): Factura | { error: string } {
  const numero = campo(texto, /FACTURA[^\n]*No\.?\s*(\S+)/i)
  const fecha = fechaLocal(campo(texto, /Fecha de emisi[oó]n:\s*(\S+)/i))
  const total = parsearMonto(campo(texto, /^TOTAL:\s*([A-Z]{3}\s*[\d.,]+)/im))
  if (!numero || !fecha || total === null) return { error: "la factura no tiene número, fecha o total legibles" }
  return { numero, fecha, total }
}

/** "Aprobado por 25 millones" → 25000000. Detecta un monto explícito en el texto de aprobación. */
export function montoMencionado(texto: string): number | null {
  const millones = /(\d+(?:[.,]\d+)?)\s*millones/i.exec(texto)
  if (millones?.[1]) return Math.round(Number(millones[1].replace(",", ".")) * 1_000_000)
  const explicito = /\$\s*([\d.]{5,})/.exec(texto)
  return explicito?.[1] ? parsearMonto(explicito[1]) : null
}

export function normalizarAprobacion(cruda: AprobacionCruda): Aprobacion {
  const negada = /\bno\s+aprobad[oa]\b/i.test(cruda.cuerpo)
  return {
    de: cruda.de,
    fecha: cruda.fecha,
    aprobado: !negada && /\baprobad[oa]\b/i.test(cruda.cuerpo),
    monto_mencionado: montoMencionado(cruda.cuerpo),
    texto: cruda.cuerpo,
  }
}

export function rutaCaso(directorio: string, caso: string): string {
  return join(directorio, RAIZ_FIXTURES, "solicitudes", caso)
}

export async function leerAprobacionCruda(directorio: string, caso: string): Promise<AprobacionCruda | null> {
  const texto = await leerTextoOpcional(join(rutaCaso(directorio, caso), "aprobacion.json"))
  if (texto === null) return null
  const resultado = AprobacionCrudaEsquema.safeParse(parsearJson(texto, "aprobacion.json"))
  if (!resultado.success) throw new Error("aprobacion.json no tiene los campos de, para, fecha, asunto y cuerpo")
  return resultado.data
}

/** Lee y normaliza el paquete completo. Lanza solo errores de estructura; el llamador los envuelve. */
export async function cargarPaquete(directorio: string, caso: string): Promise<Paquete> {
  const base = rutaCaso(directorio, caso)
  const correoTexto = await leerTextoOpcional(join(base, "correo.json"))
  const solicitudTexto = await leerTextoOpcional(join(base, "solicitud.json"))
  if (correoTexto === null && solicitudTexto === null) throw new Error(`el caso "${caso}" no existe`)
  if (solicitudTexto === null) throw new Error("falta la solicitud (solicitud.json): pídala al solicitante")

  const faltantes: string[] = []
  const correoParseado = correoTexto ? CorreoEsquema.safeParse(parsearJson(correoTexto, "correo.json")) : null
  if (correoParseado && !correoParseado.success) throw new Error("correo.json no tiene los campos id, de, asunto y fecha")
  const correo = correoParseado?.data ?? { id: `${caso}-correo`, de: "", asunto: "", fecha: "" }
  if (!correoTexto) faltantes.push("correo")

  const solicitudParseada = SolicitudEsquema.safeParse(parsearJson(solicitudTexto, "solicitud.json"))
  if (!solicitudParseada.success) {
    const detalle = solicitudParseada.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`solicitud inválida: ${detalle}`)
  }

  const cotizacionTexto = await leerTextoOpcional(join(base, "cotizacion.txt"))
  let cotizacion: Cotizacion | null = null
  if (cotizacionTexto === null) faltantes.push("cotizacion")
  else {
    const parseada = parsearCotizacion(cotizacionTexto)
    if ("error" in parseada) faltantes.push(`cotizacion (${parseada.error})`)
    else cotizacion = parseada
  }

  const aprobacionCruda = await leerAprobacionCruda(directorio, caso)
  if (!aprobacionCruda) faltantes.push("aprobacion")

  const facturaTexto = await leerTextoOpcional(join(base, "factura.txt"))
  let factura: Factura | null = null
  if (facturaTexto !== null) {
    const parseada = parsearFactura(facturaTexto)
    if ("error" in parseada) faltantes.push(`factura (${parseada.error})`)
    else factura = parseada
  }

  return {
    correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
    solicitud: solicitudParseada.data,
    cotizacion,
    aprobacion: aprobacionCruda ? normalizarAprobacion(aprobacionCruda) : null,
    factura,
    faltantes,
  }
}

export async function cargarMaestros(directorio: string): Promise<Maestros> {
  const base = join(directorio, RAIZ_FIXTURES, "maestros")
  return {
    proveedores: await leerMaestro(join(base, "proveedores.json"), z.array(ProveedorEsquema)),
    centros: await leerMaestro(join(base, "centros-costo.json"), z.array(CentroCostoEsquema)),
    indicadoresIva: await leerMaestro(join(base, "indicadores-iva.json"), z.array(IndicadorEsquema)),
    condicionesPago: await leerMaestro(join(base, "condiciones-pago.json"), z.array(CondicionEsquema)),
  }
}
