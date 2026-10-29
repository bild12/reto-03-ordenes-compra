// Motor de controles RC1–RC10. Determinista: ninguna regla depende del modelo de lenguaje.
// El TIPO de cada regla (bloqueo / confirmacion / derivado), sus parámetros, acción sugerida y
// responsable se leen de src/knowledge/controles.json: cambiar RC8 de "confirmacion" a "bloqueo"
// es editar ese archivo, sin tocar código (lo prueba tests/controles.test.ts).
import matrizPorDefecto from "../knowledge/controles.json" with { type: "json" }
import type { CentroCosto, Maestros, Paquete, Proveedor } from "./fuentes.ts"
import { fechaLocal, formatearMonto, normalizarNit, normalizarNombreProveedor, normalizarTexto } from "./normalizar.ts"

export type CodigoRegla = keyof typeof matrizPorDefecto.reglas
export type TipoControl = "bloqueo" | "confirmacion" | "derivado"
export type Regla = { nombre: string; tipo: string; accion_sugerida: string; responsable: string }
export type Matriz = { parametros: typeof matrizPorDefecto.parametros; reglas: Record<CodigoRegla, Regla> }

export const MATRIZ: Matriz = matrizPorDefecto
export const PARAMETROS = MATRIZ.parametros

export type Hallazgo = {
  codigo: CodigoRegla
  regla: string
  detalle: string
  accion_sugerida: string
  responsable: string
  recomendacion?: string
}

export type Derivado = { valor: string; fuente: string; nota: string }

export type Derivados = {
  proveedor?: { codigo_sap: string; nit: string; nombre: string; fuente: string }
  indicador_iva?: Derivado
  condiciones_pago?: Derivado
}

export type ResultadoValidacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
  controles_aprobados: CodigoRegla[]
}

/** Matriz vigente como Markdown: se anexa al conocimiento del agente y al SKILL.md del módulo,
 *  para que el modelo siempre explique la regla configurada y no una copia desactualizada. */
export function matrizComoMarkdown(matriz: Matriz = MATRIZ): string {
  const p = matriz.parametros
  const filas = (Object.keys(matriz.reglas) as CodigoRegla[]).map((c) => {
    const r = matriz.reglas[c]
    return `| ${c} | ${r.nombre} | ${r.tipo} | ${r.accion_sugerida} | ${r.responsable} |`
  })
  return [
    "## Matriz de controles vigente (generada desde controles.json)",
    "",
    `Parámetros: tolerancia de cotización ${p.tolerancia_cotizacion * 100} %, tolerancia aritmética ±${p.tolerancia_aritmetica}, texto breve SAP ${p.longitud_texto_breve_sap} caracteres, monedas ${p.monedas_permitidas.join("/")}.`,
    "",
    "| Código | Control | Tipo | Acción sugerida | Responsable |",
    "|---|---|---|---|---|",
    ...filas,
    "",
  ].join("\n")
}

/** Proveedor por NIT de la solicitud; si falta, NIT de la cotización; si falta, nombre normalizado. */
export function buscarProveedor(paquete: Paquete, maestros: Maestros): { proveedor: Proveedor | null; criterio: string } {
  const nitSolicitud = normalizarNit(paquete.solicitud.proveedor_nit)
  const nit = nitSolicitud ?? paquete.cotizacion?.nit ?? null
  if (nit) {
    const criterio = nitSolicitud ? `NIT ${nit} de la solicitud` : `NIT ${nit} de la cotización (la solicitud no trae NIT)`
    return { proveedor: maestros.proveedores.find((p) => normalizarNit(p.nit) === nit) ?? null, criterio }
  }
  const nombre = normalizarNombreProveedor(paquete.solicitud.proveedor_nombre)
  return { proveedor: maestros.proveedores.find((p) => normalizarNombreProveedor(p.nombre) === nombre) ?? null, criterio: "nombre normalizado (no hay NIT)" }
}

/** Evalúa las 10 reglas y acumula TODOS los hallazgos (no se detiene en el primero). */
export function validarPaquete(paquete: Paquete, maestros: Maestros, matriz: Matriz = MATRIZ): ResultadoValidacion {
  const { solicitud, cotizacion, aprobacion, factura } = paquete
  const bloqueos: Hallazgo[] = []
  const confirmaciones: Hallazgo[] = []
  const derivados: Derivados = {}
  const aprobadas: CodigoRegla[] = []
  const parametros = matriz.parametros
  const total = solicitud.valor_total

  const ok = (codigo: CodigoRegla): void => {
    aprobadas.push(codigo)
  }
  /** Clasifica el hallazgo según el tipo declarado en la matriz. `siempreBloquea` se usa para
   *  datos estructuralmente inválidos (centro o código de IVA inexistente), que nunca se confirman. */
  const reportar = (codigo: CodigoRegla, detalle: string, opciones: { recomendacion?: string; siempreBloquea?: boolean } = {}): void => {
    const regla = matriz.reglas[codigo]
    const hallazgo: Hallazgo = {
      codigo,
      regla: regla.nombre,
      detalle,
      accion_sugerida: regla.accion_sugerida,
      responsable: regla.responsable,
      ...(opciones.recomendacion ? { recomendacion: opciones.recomendacion } : {}),
    }
    if (opciones.siempreBloquea || regla.tipo === "bloqueo") bloqueos.push(hallazgo)
    else if (regla.tipo === "confirmacion") confirmaciones.push(hallazgo)
    // tipo "derivado": solo informativo, el valor viaja en `derivados`.
  }

  // RC1 · proveedor existe y activo.
  const { proveedor, criterio } = buscarProveedor(paquete, maestros)
  if (!proveedor) reportar("RC1", `El proveedor ${solicitud.proveedor_nombre} no existe en el maestro (búsqueda por ${criterio}).`)
  else if (!proveedor.activo) reportar("RC1", `El proveedor ${proveedor.nombre} (${proveedor.codigo_sap}) está inactivo en el maestro.`)
  else {
    ok("RC1")
    derivados.proveedor = { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre, fuente: "maestro.proveedores" }
  }

  // RC2 · aprobación válida del centro de costo.
  const centro: CentroCosto | undefined = maestros.centros.find((c) => c.centro_costo === solicitud.centro_costo)
  if (!centro) reportar("RC4", `El centro de costo ${solicitud.centro_costo} no existe en el maestro.`, { siempreBloquea: true })
  const aprobadorValido = centro && aprobacion
    ? centro.aprobadores.find((a) => normalizarTexto(a.email) === normalizarTexto(aprobacion.de))
    : undefined
  if (!aprobacion) reportar("RC2", "No hay correo de aprobación en el paquete.")
  else if (!aprobacion.aprobado) reportar("RC2", `El correo de ${aprobacion.de} no contiene la palabra "Aprobado".`)
  else if (centro && !aprobadorValido) {
    reportar("RC2", `${aprobacion.de} no es aprobador del ${centro.centro_costo} (${centro.nombre}). Aprobadores válidos: ${centro.aprobadores.map((a) => a.email).join(", ")}.`)
  } else if (centro) ok("RC2")

  // RC3 · tope. Si el aprobador no es válido, anticipa si algún aprobador del centro alcanzaría.
  if (centro) {
    const topeMaximo = Math.max(...centro.aprobadores.map((a) => a.tope))
    if (aprobadorValido && total > aprobadorValido.tope) {
      reportar("RC3", `Valor ${formatearMonto(total)} supera el tope de ${aprobadorValido.nombre} (${formatearMonto(aprobadorValido.tope)}).`)
    } else if (!aprobadorValido && total > topeMaximo) {
      reportar("RC3", `Ningún aprobador del ${centro.centro_costo} tiene atribución para ${formatearMonto(total)} (tope máximo ${formatearMonto(topeMaximo)}).`, {
        recomendacion: "Escalar a la dirección: la matriz de delegación del centro no cubre este monto.",
      })
    } else if (aprobadorValido) ok("RC3")
  }

  // RC4 · subárea dentro del centro.
  if (centro) {
    if (centro.subareas.includes(solicitud.subarea)) ok("RC4")
    else reportar("RC4", `La subárea "${solicitud.subarea}" no pertenece al ${centro.centro_costo}. Subáreas válidas: ${centro.subareas.join(", ")}.`)
  }

  // RC10 · consistencia aritmética de la solicitud.
  const calculado = solicitud.cantidad * solicitud.valor_unitario
  if (Math.abs(calculado - total) <= parametros.tolerancia_aritmetica) ok("RC10")
  else reportar("RC10", `${solicitud.cantidad} × ${formatearMonto(solicitud.valor_unitario)} = ${formatearMonto(calculado)}, distinto del total ${formatearMonto(total)}.`)

  const fechaSolicitud = fechaLocal(solicitud.fecha_solicitud) ?? solicitud.fecha_solicitud

  // RC5 · la cotización respalda la solicitud: mismo proveedor, misma moneda, vigente y valor dentro de la tolerancia.
  if (!cotizacion) {
    reportar("RC5", "No hay cotización legible en el paquete; no se puede contrastar el valor.")
  } else {
    let rc5Ok = true
    if (proveedor && cotizacion.nit && normalizarNit(proveedor.nit) !== cotizacion.nit) {
      rc5Ok = false
      reportar("RC5", `La cotización es del NIT ${cotizacion.nit} (${cotizacion.proveedor}), distinto del proveedor de la solicitud (${proveedor.nit}).`)
    }
    if (cotizacion.moneda !== solicitud.moneda.toUpperCase()) {
      rc5Ok = false
      reportar("RC5", `La cotización está en ${cotizacion.moneda} y la solicitud en ${solicitud.moneda}.`)
    }
    const desviacion = Math.abs(cotizacion.total - total) / total
    if (desviacion > parametros.tolerancia_cotizacion) {
      rc5Ok = false
      const montoAprobado = aprobacion?.monto_mencionado ?? null
      const superaAprobado = montoAprobado !== null && cotizacion.total > montoAprobado
      const pct = (desviacion * 100).toFixed(2).replace(".", ",")
      reportar("RC5", `Cotización ${formatearMonto(cotizacion.total)} vs solicitud ${formatearMonto(total)}: desviación ${pct} % (tolerancia ${parametros.tolerancia_cotizacion * 100} %).`, superaAprobado ? {
        recomendacion: `El líder aprobó explícitamente ${formatearMonto(montoAprobado)}. Si se confirma, la OC sale por ${formatearMonto(total)} y la factura llegará por ${formatearMonto(cotizacion.total)}: la diferencia de ${formatearMonto(cotizacion.total - total)} no estará aprobada. Recomendado: actualizar la solicitud y pedir re-aprobación, o negociar el precio con el proveedor.`,
      } : {})
    }
    if (cotizacion.validez_hasta && cotizacion.validez_hasta < fechaSolicitud) {
      rc5Ok = false
      const referencia = cotizacion.referencia ? ` ${cotizacion.referencia}` : ""
      reportar("RC5", `La cotización${referencia} venció el ${cotizacion.validez_hasta}, antes de la solicitud (${fechaSolicitud}): el precio puede no estar vigente.`)
    }
    if (rc5Ok) ok("RC5")
  }

  // RC6 · indicador de IVA (derivado + confirmación). Un código inexistente nunca se confirma.
  if (solicitud.indicador_iva) {
    if (maestros.indicadoresIva.some((i) => i.codigo === solicitud.indicador_iva)) ok("RC6")
    else reportar("RC6", `El indicador de IVA "${solicitud.indicador_iva}" no existe en el maestro.`, { siempreBloquea: true })
  } else if (proveedor) {
    const indicador = maestros.indicadoresIva.find((i) => i.codigo === proveedor.indicador_iva_default)
    derivados.indicador_iva = { valor: proveedor.indicador_iva_default, fuente: "maestro.proveedores.indicador_iva_default", nota: indicador?.descripcion ?? "" }
    reportar("RC6", `La solicitud no informa indicador de IVA. Se propone ${proveedor.indicador_iva_default} (${indicador?.descripcion ?? "sin descripción"}) desde el maestro del proveedor.`)
  } else {
    reportar("RC6", "La solicitud no informa indicador de IVA y no hay proveedor válido del cual derivarlo.")
  }

  // RC7 · condiciones de pago (derivado informativo).
  if (solicitud.condiciones_pago) ok("RC7")
  else if (proveedor) {
    const condicion = maestros.condicionesPago.find((c) => c.codigo === proveedor.condiciones_pago_default)
    derivados.condiciones_pago = { valor: proveedor.condiciones_pago_default, fuente: "maestro.proveedores.condiciones_pago_default", nota: condicion?.descripcion ?? "" }
    reportar("RC7", `Condiciones de pago derivadas del proveedor: ${proveedor.condiciones_pago_default} (${condicion?.descripcion ?? ""}).`)
    ok("RC7")
  }

  // RC8 · OC retroactiva. Una factura adjunta pero ilegible no permite descartarla: se pide confirmación.
  const fechaFactura = factura ? fechaLocal(factura.fecha) : null
  const retroactiva = fechaFactura !== null && fechaFactura < fechaSolicitud
  const facturaIlegible = paquete.faltantes.some((f) => f.startsWith("factura"))
  if (retroactiva && factura) {
    reportar("RC8", `La factura ${factura.numero} (${fechaFactura}) es anterior a la solicitud (${fechaSolicitud}). La OC sería retroactiva.`)
  } else if (facturaIlegible) {
    reportar("RC8", "Hay una factura adjunta que no se pudo leer: no es posible descartar que la OC sea retroactiva.")
  } else ok("RC8")

  // RC9 · aprobación posterior o igual a la solicitud.
  const fechaAprobacion = aprobacion ? fechaLocal(aprobacion.fecha) : null
  if (fechaAprobacion && fechaAprobacion < fechaSolicitud) {
    reportar("RC9", `La aprobación (${fechaAprobacion}) es anterior a la solicitud (${fechaSolicitud}).`)
  } else if (fechaAprobacion) ok("RC9")
  else if (aprobacion) reportar("RC9", `La fecha de la aprobación ("${aprobacion.fecha}") no es legible; no se puede verificar que sea posterior a la solicitud.`)

  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva, controles_aprobados: aprobadas }
}
