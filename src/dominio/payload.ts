// Construcción del payload de la OC (sección 7.4) con trazabilidad campo a campo.
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod/v4"
import { PARAMETROS, type ResultadoValidacion } from "./controles.ts"
import { contenidoEvidencia, sha256 } from "./evidencia.ts"
import type { AprobacionCruda, Paquete } from "./fuentes.ts"
import { derivarUnidad, fechaLocal, textoBreve } from "./normalizar.ts"

export const OrdenCompraEsquema = z.object({
  referencia: z.object({ solicitud_id: z.string(), correo_id: z.string(), cotizacion_ref: z.string().nullable() }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string().length(64) }),
  posiciones: z.array(z.object({
    numero: z.number().int().positive(),
    descripcion: z.string().max(PARAMETROS.longitud_texto_breve_sap),
    cantidad: z.number().positive(),
    unidad: z.enum(["UN", "H", "MES"]),
    precio_unitario: z.number().nonnegative(),
    centro_costo: z.string(),
    subarea: z.string(),
    indicador_iva: z.string(),
  })).min(1),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })),
})
export type OrdenCompra = z.infer<typeof OrdenCompraEsquema>

export type Trazabilidad = Record<string, { fuente: string; nota?: string }>

export type PayloadConstruido = { orden: OrdenCompra; trazabilidad: Trazabilidad; ruta_trazabilidad: string }

export function construirOrden(
  paquete: Paquete,
  validacion: ResultadoValidacion,
  aprobacionCruda: AprobacionCruda,
): { orden: OrdenCompra; trazabilidad: Trazabilidad } | { error: string } {
  if (!validacion.apta) {
    return { error: `no se construye el payload: hay bloqueos (${validacion.bloqueos.map((b) => b.codigo).join(", ")})` }
  }
  const { solicitud, cotizacion, aprobacion } = paquete
  const proveedor = validacion.derivados.proveedor
  if (!proveedor || !aprobacion) return { error: "faltan proveedor o aprobación válidos" }
  const moneda = solicitud.moneda.toUpperCase()
  if (moneda !== "COP" && moneda !== "USD") return { error: `moneda no soportada por SAP en este reto: ${solicitud.moneda}` }

  const indicadorIva = solicitud.indicador_iva ?? validacion.derivados.indicador_iva?.valor
  const condicionesPago = solicitud.condiciones_pago ?? validacion.derivados.condiciones_pago?.valor
  if (!indicadorIva || !condicionesPago) return { error: "no se pudo determinar indicador de IVA o condiciones de pago" }

  const descripcion = textoBreve(solicitud.descripcion, PARAMETROS.longitud_texto_breve_sap)
  const unidad = derivarUnidad(solicitud.descripcion)

  const orden: OrdenCompra = {
    referencia: { solicitud_id: solicitud.solicitud_id, correo_id: paquete.correo.id, cotizacion_ref: cotizacion?.referencia ?? null },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda,
    condiciones_pago: condicionesPago,
    aprobador: {
      email: aprobacion.de,
      fecha_aprobacion: fechaLocal(aprobacion.fecha) ?? aprobacion.fecha,
      evidencia_sha256: sha256(contenidoEvidencia(solicitud.solicitud_id, aprobacionCruda)),
    },
    posiciones: [{
      numero: 10,
      descripcion,
      cantidad: solicitud.cantidad,
      unidad,
      precio_unitario: solicitud.valor_unitario,
      centro_costo: solicitud.centro_costo,
      subarea: solicitud.subarea,
      indicador_iva: indicadorIva,
    }],
    excepciones: validacion.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  }

  const trazabilidad: Trazabilidad = {
    "referencia.solicitud_id": { fuente: "solicitud" },
    "referencia.correo_id": { fuente: "correo" },
    "referencia.cotizacion_ref": { fuente: cotizacion ? "cotizacion" : "derivado", ...(cotizacion ? {} : { nota: "sin cotización" }) },
    sociedad: { fuente: "maestro.controles", nota: "constante de la sección 7.4 (src/knowledge/controles.json)" },
    organizacion_compras: { fuente: "maestro.controles", nota: "constante de la sección 7.4 (src/knowledge/controles.json)" },
    "proveedor.codigo_sap": { fuente: "maestro.proveedores" },
    "proveedor.nit": { fuente: "maestro.proveedores" },
    "proveedor.nombre": { fuente: "maestro.proveedores" },
    moneda: { fuente: "solicitud" },
    condiciones_pago: solicitud.condiciones_pago ? { fuente: "solicitud" } : { fuente: "derivado", nota: "RC7: maestro.proveedores.condiciones_pago_default" },
    "aprobador.email": { fuente: "aprobacion" },
    "aprobador.fecha_aprobacion": { fuente: "aprobacion", nota: "fecha calendario local del correo" },
    "aprobador.evidencia_sha256": { fuente: "derivado", nota: "sha256 del contenido de out/<caso>/aprobacion.txt" },
    "posiciones[0].numero": { fuente: "derivado", nota: "numeración SAP 10, 20, 30…" },
    "posiciones[0].descripcion": descripcion === solicitud.descripcion
      ? { fuente: "solicitud" }
      : { fuente: "derivado", nota: `texto breve SAP (máx. ${PARAMETROS.longitud_texto_breve_sap}); texto completo: "${solicitud.descripcion}"` },
    "posiciones[0].cantidad": { fuente: "solicitud" },
    "posiciones[0].unidad": { fuente: "derivado", nota: "regla por descripción: horas → H, mensual → MES, otro → UN" },
    "posiciones[0].precio_unitario": { fuente: "solicitud", nota: "valor unitario IVA incluido, igual que la cotización" },
    "posiciones[0].centro_costo": { fuente: "solicitud" },
    "posiciones[0].subarea": { fuente: "solicitud" },
    "posiciones[0].indicador_iva": solicitud.indicador_iva ? { fuente: "solicitud" } : { fuente: "derivado", nota: "RC6: maestro.proveedores.indicador_iva_default (requiere confirmación)" },
    excepciones: { fuente: "derivado", nota: "confirmaciones de oc_validar" },
  }

  const validada = OrdenCompraEsquema.safeParse(orden)
  if (!validada.success) {
    const detalle = validada.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    return { error: `la OC no cumple el esquema SAP: ${detalle}` }
  }
  return { orden: validada.data, trazabilidad }
}

export async function guardarTrazabilidad(directorio: string, caso: string, trazabilidad: Trazabilidad): Promise<string> {
  const ruta = join("out", caso, "trazabilidad.json")
  await mkdir(join(directorio, "out", caso), { recursive: true })
  await writeFile(join(directorio, ruta), `${JSON.stringify(trazabilidad, null, 2)}\n`, "utf8")
  return ruta
}

/** Huella de los campos que el modelo nunca puede alterar. Se compara contra lo que envía el modelo. */
export function huellaCritica(orden: OrdenCompra): string {
  return JSON.stringify({
    solicitud: orden.referencia.solicitud_id,
    proveedor: orden.proveedor.codigo_sap,
    moneda: orden.moneda,
    condiciones: orden.condiciones_pago,
    aprobador: orden.aprobador.email,
    sha: orden.aprobador.evidencia_sha256,
    posiciones: orden.posiciones.map((p) => [p.cantidad, p.precio_unitario, p.centro_costo, p.subarea, p.indicador_iva]),
  })
}
