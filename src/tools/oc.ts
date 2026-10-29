// Herramientas del agente. Cada export se expone al modelo como `oc_<export>`.
// Regla de diseño: las herramientas son la única fuente de valores. Siempre releen la fuente
// por `caso`; lo que envía el modelo (paquete, derivados, payload) solo se acepta si coincide.
import { z } from "zod/v4"
import { validarPaquete, type ResultadoValidacion } from "../dominio/controles.ts"
import { registrarControl, type ResultadoControl } from "../dominio/bitacoras.ts"
import { generarEvidencia } from "../dominio/evidencia.ts"
import { cargarMaestros, cargarPaquete, leerAprobacionCruda, type Paquete } from "../dominio/fuentes.ts"
import { formatearMonto, PATRON_CASO } from "../dominio/normalizar.ts"
import { construirOrden, guardarTrazabilidad, huellaCritica, OrdenCompraEsquema } from "../dominio/payload.ts"
import { SapMock } from "../sap/mock.ts"
import type { SapAdapter } from "../sap/adapter.ts"

/** `confirmados`: casos que el HOST (servidor o plataforma que integre el módulo) registró como
 *  confirmados explícitamente por el usuario. `oc_crear` solo honra `confirmado: true` para ellos,
 *  así la confirmación humana no depende de que el modelo diga la verdad, tampoco fuera de este servidor. */
export type Contexto = { directory: string; sessionId: string; confirmados?: readonly string[] }

const casoArg = z.string().regex(PATRON_CASO, "caso inválido").describe("Carpeta del caso en fixtures/reto-03/solicitudes/, p. ej. sol-001")

type Resultado = { ok: true; data: unknown } | { ok: false; error: string }

/** Envuelve la ejecución: ninguna herramienta lanza hacia el agente. */
async function seguro(cuerpo: () => Promise<Resultado>): Promise<string> {
  try {
    return JSON.stringify(await cuerpo())
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    return JSON.stringify({ ok: false, error: mensaje })
  }
}

let fabricaSap: (directorio: string) => SapAdapter = (directorio) => new SapMock(directorio)
/** Punto de inyección para la implementación real (OData/BAPI) sin tocar las herramientas. */
export function configurarSap(fabrica: (directorio: string) => SapAdapter): void {
  fabricaSap = fabrica
}

async function cargarTodo(ctx: Contexto, caso: string): Promise<{ paquete: Paquete; validacion: ResultadoValidacion }> {
  const paquete = await cargarPaquete(ctx.directory, caso)
  const maestros = await cargarMaestros(ctx.directory)
  return { paquete, validacion: validarPaquete(paquete, maestros) }
}

/** Compara los campos de dinero e imputación que el modelo envía contra la fuente. */
function difiereDeLaFuente(enviado: unknown, fuente: Paquete): string | null {
  if (typeof enviado !== "object" || enviado === null || !("solicitud" in enviado)) return null
  const solicitud = (enviado as { solicitud: unknown }).solicitud
  if (typeof solicitud !== "object" || solicitud === null) return null
  const campos = ["solicitud_id", "valor_total", "cantidad", "valor_unitario", "centro_costo", "subarea"] as const
  for (const campo of campos) {
    const valor = (solicitud as Record<string, unknown>)[campo]
    if (valor !== undefined && String(valor) !== String(fuente.solicitud[campo])) {
      return `el paquete enviado difiere de la fuente en "${campo}" (${String(valor)} ≠ ${String(fuente.solicitud[campo])}); se usa siempre la fuente`
    }
  }
  return null
}

export const leer_paquete = {
  description: "Lee y normaliza el paquete de una solicitud de compra: correo, solicitud, cotización, aprobación y factura si existe.",
  args: { caso: casoArg },
  async execute(args: { caso: string }, ctx: Contexto): Promise<string> {
    return seguro(async () => {
      const paquete = await cargarPaquete(ctx.directory, args.caso)
      return { ok: true, data: paquete }
    })
  },
}

export const validar = {
  description: "Aplica los controles RC1–RC10 a una solicitud y devuelve si es apta, los bloqueos, las confirmaciones requeridas y los valores derivados de maestros.",
  args: {
    caso: casoArg,
    paquete: z.unknown().optional().describe("Opcional. Paquete devuelto por oc_leer_paquete; la herramienta relee la fuente y rechaza diferencias."),
  },
  async execute(args: { caso: string; paquete?: unknown }, ctx: Contexto): Promise<string> {
    return seguro(async () => {
      const { paquete, validacion } = await cargarTodo(ctx, args.caso)
      const diferencia = difiereDeLaFuente(args.paquete, paquete)
      if (diferencia) return { ok: false, error: diferencia }
      return { ok: true, data: validacion }
    })
  },
}

export const generar_evidencia = {
  description: "Genera la evidencia de aprobación del líder (aprobacion.txt y aprobacion.pdf) con su huella sha256 en out/<caso>/.",
  args: { caso: casoArg },
  async execute(args: { caso: string }, ctx: Contexto): Promise<string> {
    return seguro(async () => {
      const paquete = await cargarPaquete(ctx.directory, args.caso)
      const cruda = await leerAprobacionCruda(ctx.directory, args.caso)
      if (!cruda) return { ok: false, error: "no hay correo de aprobación: pídalo al solicitante" }
      const evidencia = await generarEvidencia(ctx.directory, args.caso, paquete.solicitud.solicitud_id, cruda)
      return { ok: true, data: { ruta: evidencia.ruta_txt, ruta_pdf: evidencia.ruta_pdf, sha256: evidencia.sha256 } }
    })
  },
}

export const construir_payload = {
  description: "Construye la orden de compra exactamente como quedaría en SAP, valida su esquema y guarda la trazabilidad de cada campo.",
  args: {
    caso: casoArg,
    paquete: z.unknown().optional().describe("Opcional. Paquete de oc_leer_paquete; se contrasta contra la fuente."),
    derivados: z.unknown().optional().describe("Opcional. Derivados de oc_validar; se recalculan desde los maestros."),
  },
  async execute(args: { caso: string; paquete?: unknown; derivados?: unknown }, ctx: Contexto): Promise<string> {
    return seguro(async () => {
      const { paquete, validacion } = await cargarTodo(ctx, args.caso)
      const diferencia = difiereDeLaFuente(args.paquete, paquete)
      if (diferencia) return { ok: false, error: diferencia }
      const cruda = await leerAprobacionCruda(ctx.directory, args.caso)
      if (!cruda) return { ok: false, error: "no hay correo de aprobación" }
      const construido = construirOrden(paquete, validacion, cruda)
      if ("error" in construido) return { ok: false, error: construido.error }
      const ruta = await guardarTrazabilidad(ctx.directory, args.caso, construido.trazabilidad)
      const posicion = construido.orden.posiciones[0]
      return {
        ok: true,
        data: {
          orden: construido.orden,
          ruta_trazabilidad: ruta,
          valor_total: paquete.solicitud.valor_total,
          // Montos ya formateados para que el agente los muestre sin recalcular ni reformatear.
          montos_legibles: {
            precio_unitario: posicion ? formatearMonto(posicion.precio_unitario) : null,
            valor_total: formatearMonto(paquete.solicitud.valor_total),
            moneda: construido.orden.moneda,
          },
          descripcion_completa: paquete.solicitud.descripcion,
        },
      }
    })
  },
}

export const crear = {
  description: "Crea la orden de compra en SAP (simulado) solo si la solicitud es apta y, cuando hay confirmaciones pendientes, solo con confirmado=true tras la confirmación explícita del usuario; registra cada intento en el log de control.",
  args: {
    caso: casoArg,
    payload: z.unknown().optional().describe("Opcional. Orden de oc_construir_payload; se rechaza si sus montos o imputación difieren de la fuente."),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente las excepciones en su último mensaje."),
  },
  async execute(args: { caso: string; payload?: unknown; confirmado?: boolean }, ctx: Contexto): Promise<string> {
    return seguro(async () => {
      const { paquete, validacion } = await cargarTodo(ctx, args.caso)
      const sap = fabricaSap(ctx.directory)
      const id = paquete.solicitud.solicitud_id
      const base = {
        solicitud_id: id,
        retroactiva: validacion.retroactiva,
        bloqueos: validacion.bloqueos.map((b) => b.codigo),
        confirmaciones: validacion.confirmaciones.map((c) => c.codigo),
      }
      const registrar = (resultado: ResultadoControl, numero_oc = ""): Promise<void> =>
        registrarControl(ctx.directory, { ...base, resultado, numero_oc })

      // 1. Idempotencia: si ya existe una OC para la solicitud, se devuelve la misma.
      const existente = await sap.buscarOrdenPorReferencia(id)
      if (existente) {
        await registrar("idempotente", existente.numero_oc)
        const fecha = "fecha" in existente && typeof existente.fecha === "string" ? existente.fecha : null
        return { ok: true, data: { numero_oc: existente.numero_oc, fecha, idempotente: true, mensaje: "la OC ya existía; no se creó una segunda" } }
      }
      // 2. Bloqueos: nunca se crea.
      if (!validacion.apta) {
        await registrar("bloqueada")
        const motivos = validacion.bloqueos.map((b) => `${b.codigo}: ${b.detalle} Acción: ${b.accion_sugerida}`).join(" | ")
        return { ok: false, error: `bloqueado, no se crea la OC. ${motivos}` }
      }
      // 3. Confirmaciones: solo con confirmado = true.
      const confirmadoPorUsuario = args.confirmado === true && (ctx.confirmados ?? []).includes(args.caso)
      if (validacion.confirmaciones.length > 0 && !confirmadoPorUsuario) {
        await registrar("pendiente_confirmacion")
        const pendientes = validacion.confirmaciones.map((c) => `${c.codigo}: ${c.detalle}`).join(" | ")
        const motivo = args.confirmado === true ? " (se recibió confirmado=true, pero el host no registró la confirmación del usuario para este caso)" : ""
        return { ok: false, error: `requiere confirmación explícita${motivo}: ${pendientes}` }
      }
      // 4. Verificación previa contra el sistema de registro: el proveedor debe seguir activo en SAP
      //    (el maestro local puede estar desactualizado; en producción esta consulta va a SAP real).
      const nitProveedor = validacion.derivados.proveedor?.nit
      const enSap = nitProveedor ? await sap.consultarProveedor(nitProveedor) : null
      if (!enSap || !enSap.activo) {
        await registrar("bloqueada")
        return { ok: false, error: `bloqueado, no se crea la OC. RC1: el proveedor no está activo en SAP al momento de crear. Acción: verificar el maestro con Compras.` }
      }
      // 5. Integridad: el payload se reconstruye desde la fuente; el del modelo solo se acepta si coincide.
      const cruda = await leerAprobacionCruda(ctx.directory, args.caso)
      if (!cruda) return { ok: false, error: "no hay correo de aprobación" }
      const construido = construirOrden(paquete, validacion, cruda)
      if ("error" in construido) {
        await registrar("error")
        return { ok: false, error: construido.error }
      }
      if (args.payload !== undefined) {
        const enviado = OrdenCompraEsquema.safeParse(args.payload)
        if (!enviado.success || huellaCritica(enviado.data) !== huellaCritica(construido.orden)) {
          await registrar("rechazada_integridad")
          return { ok: false, error: "el payload enviado no coincide con la fuente (montos, proveedor o imputación); vuelva a llamar sin payload o con el de oc_construir_payload" }
        }
      }
      const orden = {
        ...construido.orden,
        excepciones: construido.orden.excepciones.map((e) => ({ ...e, confirmado_por: `analista (sesión ${ctx.sessionId})` })),
      }
      const evidencia = await generarEvidencia(ctx.directory, args.caso, id, cruda)
      await guardarTrazabilidad(ctx.directory, args.caso, construido.trazabilidad)
      const creada = await sap.crearOrden(orden)
      await registrar("creada", creada.numero_oc)
      return {
        ok: true,
        data: {
          numero_oc: creada.numero_oc,
          fecha: creada.fecha,
          idempotente: false,
          retroactiva: validacion.retroactiva,
          valor_total: formatearMonto(paquete.solicitud.valor_total),
          evidencia: evidencia.ruta_txt,
          evidencia_pdf: evidencia.ruta_pdf,
          excepciones_confirmadas: orden.excepciones.map((e) => e.codigo),
        },
      }
    })
  },
}
