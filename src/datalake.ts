import * as XLSX from "xlsx";
import { COLUMNAS_DATALAKE, normalizarCaravana, normalizarEtapa, semanaDeFecha, sinAcentos, hoyISO } from "./reglas";
import type { Registro, Historial } from "./db";

/** Fila con las columnas exactas que lee el motor del tablero. */
export function aFilaDataLake(r: Registro) {
  return {
    id_registro: r.id,
    Cliente: r.cliente,
    Fecha: r.fecha,
    Semana: r.semana,
    Etapa: r.etapa,
    Caravana: r.caravana,
    Paridad: r.paridad,
    Medicion: r.medicion
  };
}

/** Descarga un Excel con el formato del Data Lake (modo demo, mientras no hay sincronización). */
export function exportarExcel(registros: Registro[], nombre: string) {
  const ws = XLSX.utils.json_to_sheet(registros.map(aFilaDataLake), { header: [...COLUMNAS_DATALAKE] });
  const control = XLSX.utils.json_to_sheet(
    registros.map(r => ({ id_registro: r.id, CargadoEn: r.cargadoEn, EditadoEn: r.editadoEn || "", Operario: r.operario, Origen: r.origen }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Datos");
  XLSX.utils.book_append_sheet(wb, control, "Control");
  XLSX.writeFile(wb, nombre);
}

function aFechaISO(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const f = new Date(v.getTime() + 12 * 3600000); // mismo ajuste que el motor
    return hoyISO(f);
  }
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (d) return `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
  return null;
}

/** Lee un Excel del Data Lake (mismas columnas que el tablero) y devuelve la historia por cerda. */
export function leerHistorialExcel(buf: ArrayBuffer): { filas: Historial[]; descartadas: number } {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  if (!json.length) return { filas: [], descartadas: 0 };
  const h: Record<string, string> = {};
  for (const k of Object.keys(json[0])) h[sinAcentos(k)] = k;
  const filas: Historial[] = [];
  let descartadas = 0;
  json.forEach((r, i) => {
    const etapa = normalizarEtapa(String(r[h["etapa"]] ?? ""));
    const fecha = aFechaISO(r[h["fecha"]]);
    const caravana = normalizarCaravana(String(r[h["caravana"]] ?? ""));
    const cliente = String(r[h["cliente"]] ?? "").trim();
    if (!etapa || !fecha || !caravana || !cliente) { descartadas++; return; }
    const num = (v: unknown) => (v === null || v === "" || v === undefined ? null : Number(v));
    filas.push({
      id: String((h["id_registro"] && r[h["id_registro"]]) || `hist-${i}-${cliente}-${caravana}-${fecha}-${etapa}`),
      cliente,
      fecha,
      semana: String(r[h["semana"]] ?? "").trim() || semanaDeFecha(fecha),
      etapa,
      caravana,
      paridad: num(r[h["paridad"]]),
      medicion: num(r[h["medicion"]])
    });
  });
  return { filas, descartadas };
}
