// Tope global diario de tokens, persistido en out/consumo-diario.json: un reinicio del servidor
// (o de la instancia en el hosting) no vuelve el contador a cero.
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

type Estado = { dia: string; tokens: number }

export class ConsumoDiario {
  private estado: Estado
  private readonly archivo: string

  constructor(directorio: string, private readonly tope: number, private readonly hoy: () => string = () => new Date().toISOString().slice(0, 10)) {
    this.archivo = join(directorio, "out", "consumo-diario.json")
    this.estado = this.leer()
  }

  private leer(): Estado {
    try {
      const guardado = JSON.parse(readFileSync(this.archivo, "utf8")) as Partial<Estado>
      if (typeof guardado.dia === "string" && typeof guardado.tokens === "number") return { dia: guardado.dia, tokens: guardado.tokens }
    } catch {
      // Sin archivo o archivo dañado: se empieza en cero.
    }
    return { dia: this.hoy(), tokens: 0 }
  }

  private vigente(): Estado {
    if (this.estado.dia !== this.hoy()) this.estado = { dia: this.hoy(), tokens: 0 }
    return this.estado
  }

  alcanzado(): boolean {
    return this.vigente().tokens >= this.tope
  }

  async sumar(tokens: number): Promise<void> {
    this.vigente().tokens += tokens
    await mkdir(join(this.archivo, ".."), { recursive: true })
    await writeFile(this.archivo, JSON.stringify(this.estado), "utf8")
  }

  get tokens(): number {
    return this.vigente().tokens
  }
}
