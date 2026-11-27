import Dexie, { type Table } from "dexie";
import type { Etapa } from "./reglas";

export type Estado = "pendiente" | "sincronizado";

export interface Registro {
  id: string;            // id_registro (UUID), evita duplicar al reenviar
  sesionId: string;
  cliente: string;
  fecha: string;         // fecha de MEDICIÓN (AAAA-MM-DD)
  semana: string;        // calculada de la fecha de medición, ej. "48_26"
  etapa: Etapa;
  caravana: string;
  paridad: number | null;
  medicion: number | null;
  // Control (no los lee el tablero)
  cargadoEn: string;     // fecha y hora de carga (ISO)
  editadoEn?: string;
  operario: string;
  origen: "qr" | "tipeado";
  estado: Estado;
  spItemId?: string;     // id del ítem en la Lista "RCC Entrada" una vez enviado
  anulado?: boolean;     // borrado después de enviado: se marca "Anulado" en la Lista
  errorSync?: string;    // último error al enviar, para mostrarlo
}

export interface Sesion {
  id: string;
  cliente: string;
  etapa: Etapa;
  fecha: string;
  operario: string;
  creadaEn: string;
}

/** Historia de la granja bajada del Data Lake (o importada de un Excel en modo demo). */
export interface Historial {
  id: string;
  cliente: string;
  fecha: string;
  semana: string;
  etapa: Etapa;
  caravana: string;
  paridad: number | null;
  medicion: number | null;
}

class BaseLocal extends Dexie {
  registros!: Table<Registro, string>;
  sesiones!: Table<Sesion, string>;
  historial!: Table<Historial, string>;
  constructor() {
    super("rcc-recoleccion");
    this.version(1).stores({
      registros: "id, sesionId, cliente, estado, [cliente+caravana], [cliente+semana+etapa]",
      sesiones: "id, creadaEn",
      historial: "id, cliente, [cliente+caravana]"
    });
    // v2: campos de sincronización (no cambian los índices)
    this.version(2).stores({
      registros: "id, sesionId, cliente, estado, [cliente+caravana], [cliente+semana+etapa]",
      sesiones: "id, creadaEn",
      historial: "id, cliente, [cliente+caravana]"
    });
  }
}

export const db = new BaseLocal();

export function nuevoId(): string {
  return crypto.randomUUID();
}

/** Todo lo conocido de una granja: lo cargado en el teléfono + la historia del Data Lake. */
export async function conocidosDe(cliente: string) {
  const [locales, hist] = await Promise.all([
    db.registros.where("cliente").equals(cliente).toArray(),
    db.historial.where("cliente").equals(cliente).toArray()
  ]);
  const vivos = locales.filter(r => !r.anulado);
  const ids = new Set(locales.map(r => r.id));
  return [...vivos, ...hist.filter(h => !ids.has(h.id))];
}
