// Interfaz obligatoria (sección 7.4). La implementación real se diseña en SOLUCION.md §6.
import type { OrdenCompra } from "../dominio/payload.ts"

export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>
}
