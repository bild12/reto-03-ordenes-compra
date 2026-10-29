// Normalizadores puros. Cada uno resuelve una trampa de formato de los fixtures
// y está aislado para poder probarlo y explicarlo línea por línea.

/** "COP 11.400.000" | "11.400.000,50" | 11400000 → 11400000 (null si no es un monto). */
export function parsearMonto(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null
  if (typeof valor !== "string") return null
  const limpio = valor.replace(/[A-Za-z$\s]/g, "")
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(limpio)) return null
  const numero = Number(limpio.replace(/\./g, "").replace(",", "."))
  return Number.isFinite(numero) ? numero : null
}

/** "900.555.111-2" → "900555111". Elimina puntos y dígito de verificación. */
export function normalizarNit(nit: string | null | undefined): string | null {
  if (!nit) return null
  const sinDv = nit.split("-")[0] ?? ""
  const digitos = sinDv.replace(/\D/g, "")
  return digitos.length > 0 ? digitos : null
}

/** Minúsculas, sin tildes, sin espacios dobles. Para comparar nombres y correos. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Nombre de proveedor comparable: sin tildes ni puntuación ni sufijo societario. */
export function normalizarNombreProveedor(nombre: string): string {
  return normalizarTexto(nombre)
    .replace(/[.,]/g, "")
    .replace(/\b(s ?a ?s|s ?a|ltda|sas|sa)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Fecha local "YYYY-MM-DD" desde "2026-08-26T18:45:00-05:00" o "2026-08-26".
 *  Se toma la fecha calendario del documento (hora local de Bogotá), sin convertir a UTC:
 *  convertir 18:45 -05:00 a UTC no cambia el día, pero 20:00 -05:00 sí lo haría. */
export function fechaLocal(valor: string | null | undefined): string | null {
  if (!valor) return null
  const coincide = /^(\d{4}-\d{2}-\d{2})/.exec(valor.trim())
  if (!coincide || !coincide[1]) return null
  const fecha = coincide[1]
  return Number.isNaN(Date.parse(`${fecha}T00:00:00Z`)) ? null : fecha
}

export function sumarDias(fecha: string, dias: number): string {
  const base = new Date(`${fecha}T00:00:00Z`)
  base.setUTCDate(base.getUTCDate() + dias)
  return base.toISOString().slice(0, 10)
}

/** Texto breve SAP: corta en el último espacio antes del límite, sin dejar palabras partidas. */
export function textoBreve(texto: string, limite: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim()
  if (limpio.length <= limite) return limpio
  const corte = limpio.slice(0, limite + 1)
  const ultimoEspacio = corte.lastIndexOf(" ")
  let recortado = ultimoEspacio > limite / 2 ? corte.slice(0, ultimoEspacio) : limpio.slice(0, limite)
  // No terminar en conectores ("Bolsa de 100 horas de arquitectura de" → "…de arquitectura").
  const conector = /[\s,;:.\-]+(de|del|la|las|el|los|y|e|o|para|con|en|a|al|por|un|una)$/i
  while (conector.test(recortado)) recortado = recortado.replace(conector, "")
  return recortado.replace(/[\s,;:.\-]+$/, "")
}

/** Unidad SAP derivada de la descripción. Regla documentada en SUPUESTOS. */
export function derivarUnidad(descripcion: string): "UN" | "H" | "MES" {
  const texto = normalizarTexto(descripcion)
  if (/\bhoras?\b/.test(texto)) return "H"
  if (/\b(mensual|mensualidad|por mes)\b/.test(texto)) return "MES"
  return "UN"
}

/** Formato de moneda colombiano para mensajes al usuario. */
export function formatearMonto(valor: number): string {
  return valor.toLocaleString("es-CO", { maximumFractionDigits: 2 })
}

/** Identificador seguro de caso: evita rutas tipo "../../". */
export const PATRON_CASO = /^[a-z0-9][a-z0-9-]{0,63}$/
