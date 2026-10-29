// Interfaz propia del proveedor de modelo: enviar(mensajes, herramientas) → respuesta.
// El ciclo del agente solo conoce estos tipos; cambiar de proveedor es escribir otra implementación.

export type LlamadaHerramienta = { id: string; nombre: string; argumentos: Record<string, unknown> }

export type Mensaje =
  | { rol: "sistema"; texto: string }
  | { rol: "usuario"; texto: string }
  | { rol: "asistente"; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: "resultados"; resultados: { id: string; nombre: string; contenido: string }[] }

export type DefinicionHerramienta = { nombre: string; descripcion: string; esquema: Record<string, unknown> }

export type RespuestaModelo = {
  texto: string
  llamadas: LlamadaHerramienta[]
  /** entrada incluye tokens leídos de caché; cache_leido permite estimar el ahorro. */
  uso: { entrada: number; salida: number; cache_leido?: number }
}

export interface ProveedorLLM {
  readonly nombre: string
  readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaModelo>
}

/** Error del proveedor con mensaje apto para mostrar en el chat (sin trazas ni claves). */
export class ErrorProveedor extends Error {}
