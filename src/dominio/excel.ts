// Lectura de .xlsx reales (P1 del PRD): la solicitud llega en producción como Excel.
// Seguridad: solo lee dentro de fixtures/ u out/ del proyecto, solo .xlsx y hasta 5 MB.
import { stat } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import ExcelJS from "exceljs"

const CARPETAS_PERMITIDAS = ["fixtures", "out"]
const TAMANO_MAXIMO = 5 * 1024 * 1024

export type Celda = string | number | boolean | null
export type HojaLeida = { hoja: string; encabezados: string[]; filas: Record<string, Celda>[] }

/** Resuelve la ruta y rechaza cualquier intento de salir de las carpetas permitidas. */
export function rutaSegura(directorio: string, ruta: string): string {
  const absoluta = resolve(directorio, ruta)
  const relativa = relative(resolve(directorio), absoluta)
  const carpeta = relativa.split(/[\\/]/)[0] ?? ""
  if (isAbsolute(ruta) || relativa.startsWith("..") || !CARPETAS_PERMITIDAS.includes(carpeta)) {
    throw new Error(`ruta no permitida: solo se leen archivos dentro de ${CARPETAS_PERMITIDAS.join("/ o ")}/`)
  }
  if (!absoluta.toLowerCase().endsWith(".xlsx")) throw new Error("solo se leen archivos .xlsx")
  return absoluta
}

/** Convierte el valor de ExcelJS (texto enriquecido, fórmula, fecha, hipervínculo) a un valor simple. */
function valorSimple(valor: ExcelJS.CellValue): Celda {
  if (valor === null || valor === undefined) return null
  if (valor instanceof Date) return valor.toISOString().slice(0, 10)
  if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") return valor
  if (typeof valor === "object") {
    if ("richText" in valor) return valor.richText.map((t) => t.text).join("")
    if ("result" in valor) return valorSimple(valor.result as ExcelJS.CellValue)
    if ("text" in valor && typeof valor.text === "string") return valor.text
    if ("error" in valor) return null
  }
  return String(valor)
}

/** Lee la primera hoja: la fila 1 son los encabezados y cada fila siguiente es un objeto. */
export async function leerExcel(directorio: string, ruta: string): Promise<HojaLeida> {
  const absoluta = rutaSegura(directorio, ruta)
  const info = await stat(absoluta).catch(() => null)
  if (!info) throw new Error(`no existe el archivo ${ruta}`)
  if (info.size > TAMANO_MAXIMO) throw new Error("el archivo supera 5 MB")

  const libro = new ExcelJS.Workbook()
  try {
    await libro.xlsx.readFile(absoluta)
  } catch {
    throw new Error(`el archivo ${ruta} no es un Excel válido: pida al solicitante que lo reenvíe`)
  }
  const hoja = libro.worksheets[0]
  if (!hoja) throw new Error("el Excel no tiene hojas")

  const encabezados: string[] = []
  hoja.getRow(1).eachCell({ includeEmpty: false }, (celda, columna) => {
    encabezados[columna - 1] = String(valorSimple(celda.value) ?? `columna_${columna}`).trim()
  })
  if (encabezados.length === 0) throw new Error("la primera fila del Excel no tiene encabezados")

  const filas: Record<string, Celda>[] = []
  hoja.eachRow({ includeEmpty: false }, (fila, numero) => {
    if (numero === 1) return
    const registro: Record<string, Celda> = {}
    encabezados.forEach((encabezado, i) => {
      if (encabezado) registro[encabezado] = valorSimple(fila.getCell(i + 1).value)
    })
    if (Object.values(registro).some((v) => v !== null && v !== "")) filas.push(registro)
  })
  return { hoja: hoja.name, encabezados: encabezados.filter(Boolean), filas }
}
