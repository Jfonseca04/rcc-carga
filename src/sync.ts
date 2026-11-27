// Sincronización con SharePoint (fase siguiente).
//
// Plan:
// 1. Login con MSAL en el tenant de Bioter (se puede reusar el registro de app del tablero).
// 2. Enviar los registros "pendiente" a la Lista "RCC Entrada" del sitio
//    biotecomar.sharepoint.com/sites/RPADTC01 con Microsoft Graph:
//      POST /sites/{siteId}/lists/{listId}/items  { fields: { id_registro, Cliente, ... } }
//    El id_registro es único en la Lista, así que reenviar no duplica.
// 3. Bajar la historia de la granja del Data Lake (RCC/DataLake/Master), igual que el tablero,
//    y guardarla en db.historial para precargar paridad y detectar duplicados.
//
// Mientras tanto, en modo demo, la app exporta un Excel con las columnas del Data Lake.

import type { Registro } from "./db";

export const MODO_DEMO = true;

export async function sincronizar(_pendientes: Registro[]): Promise<{ enviados: number }> {
  throw new Error("La sincronización con SharePoint todavía no está conectada (modo demo).");
}
