// Mismas herramientas que usa la aplicación: este archivo solo las reexporta (no hay copia divergente).
// Integración: el host debe pasar ctx.confirmados con los casos que el usuario confirmó; sin eso,
// oc_crear nunca crea una OC con excepciones.
// Uso: import * as oc from "./modulo/tools/oc.ts" → oc.leer_paquete, oc.validar, oc.construir_payload, oc.generar_evidencia, oc.crear
export * from "../../src/tools/oc.ts"
