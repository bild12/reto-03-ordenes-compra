// Evidencia de aprobación: el correo del líder convertido en documento auditable con huella sha256.
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { PDFDocument, StandardFonts } from "pdf-lib"
import type { AprobacionCruda } from "./fuentes.ts"

/** Contenido canónico. El sha256 se calcula sobre este texto exacto, sin la línea del hash. */
export function contenidoEvidencia(solicitudId: string, aprobacion: AprobacionCruda): string {
  return [
    `EVIDENCIA DE APROBACIÓN · ${solicitudId}`,
    `De: ${aprobacion.de}`,
    `Para: ${aprobacion.para}`,
    `CC: ${(aprobacion.cc ?? []).join(", ")}`,
    `Fecha: ${aprobacion.fecha}`,
    `Asunto: ${aprobacion.asunto}`,
    "",
    aprobacion.cuerpo,
    "",
  ].join("\n")
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex")
}

/** pdf-lib con fuentes estándar solo codifica WinAnsi: se reemplazan los caracteres fuera de rango. */
function aWinAnsi(texto: string): string {
  return texto.replace(/·/g, "-").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?")
}

async function escribirPdf(ruta: string, contenido: string, hash: string): Promise<void> {
  const pdf = await PDFDocument.create()
  pdf.setTitle("Evidencia de aprobación")
  pdf.setCreator("Agente Órdenes de Compra")
  const fuente = await pdf.embedFont(StandardFonts.Helvetica)
  let pagina = pdf.addPage([595, 842])
  let y = 790
  const lineas = [...aWinAnsi(contenido).split("\n"), "", `SHA-256 del contenido: ${hash}`]
  for (const linea of lineas) {
    const partes = linea.match(/.{1,95}(\s|$)|\S+/g) ?? [""]
    for (const parte of partes) {
      if (y < 50) {
        // Correos largos: se continúa en una página nueva en lugar de dibujar fuera del margen.
        pagina = pdf.addPage([595, 842])
        y = 790
      }
      pagina.drawText(parte.trimEnd(), { x: 50, y, size: 10, font: fuente })
      y -= 15
    }
  }
  await writeFile(ruta, await pdf.save())
}

export type Evidencia = { ruta_txt: string; ruta_pdf: string; sha256: string }

export async function generarEvidencia(directorio: string, caso: string, solicitudId: string, aprobacion: AprobacionCruda): Promise<Evidencia> {
  const carpeta = join(directorio, "out", caso)
  await mkdir(carpeta, { recursive: true })
  const contenido = contenidoEvidencia(solicitudId, aprobacion)
  const hash = sha256(contenido)
  const rutaTxt = join("out", caso, "aprobacion.txt")
  const rutaPdf = join("out", caso, "aprobacion.pdf")
  await writeFile(join(directorio, rutaTxt), `${contenido}---\nsha256: ${hash}\n`, "utf8")
  await escribirPdf(join(directorio, rutaPdf), contenido, hash)
  return { ruta_txt: rutaTxt, ruta_pdf: rutaPdf, sha256: hash }
}
