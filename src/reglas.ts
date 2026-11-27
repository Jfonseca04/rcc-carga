// Reglas compartidas con el Tablero de Condición Corporal.
// Este módulo no depende de React ni del navegador: la idea es que el motor del
// tablero (Tablero-Core) use estas mismas funciones, para que la app no valide
// una cosa y el tablero interprete otra.

export const ETAPAS = ["Preparto", "Destete", "35 días post servicio"] as const;
export type Etapa = (typeof ETAPAS)[number];

export const CLIENTES = ["ING", "CSJ", "La Lucía", "Pacuca", "UNI"] as const;

// Rangos por defecto. Se pueden ajustar por cliente en RANGOS_POR_CLIENTE.
export interface Rangos {
  paridadMax: number;
  medicionMin: number;
  medicionMax: number;
  diasAtrasAviso: number; // fecha de medición más vieja que esto pide confirmación
}
export const RANGOS_DEFECTO: Rangos = { paridadMax: 12, medicionMin: 5, medicionMax: 30, diasAtrasAviso: 7 };
export const RANGOS_POR_CLIENTE: Partial<Record<string, Partial<Rangos>>> = {};
export function rangosDe(cliente: string): Rangos {
  return { ...RANGOS_DEFECTO, ...(RANGOS_POR_CLIENTE[cliente] || {}) };
}

// Paridad mínima por etapa. En preparto y destete la cerda ya tuvo (o está por tener)
// al menos un parto, así que 0 no es válido. A los 35 días post servicio puede ser
// una cachorra recién servida (paridad 0).
export const PARIDAD_MIN: Record<Etapa, number> = {
  "Preparto": 1,
  "Destete": 1,
  "35 días post servicio": 0
};

// ---- Semana: mismo cálculo que semanaISO() y parseSemana() del motor ----

export function semanaISO(fecha: Date): { semana: number; anio: number } {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // jueves de esa semana
  const anio = d.getFullYear();
  const ene4 = new Date(anio, 0, 4);
  ene4.setDate(ene4.getDate() + 3 - ((ene4.getDay() + 6) % 7));
  return { semana: 1 + Math.round((d.getTime() - ene4.getTime()) / (7 * 86400000)), anio };
}

/** "2026-11-27" -> "48_26", el formato de la columna Semana del Data Lake. */
export function semanaDeFecha(fechaISO: string): string {
  const { semana, anio } = semanaISO(fechaLocal(fechaISO));
  return `${semana}_${String(anio).slice(-2)}`;
}

/** Interpreta "AAAA-MM-DD" como fecha local (sin corrimiento por zona horaria). */
export function fechaLocal(fechaISO: string): Date {
  const [a, m, d] = fechaISO.split("-").map(Number);
  return new Date(a, m - 1, d);
}

export function hoyISO(ahora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}`;
}

// ---- Normalización (igual que normalizarHeader / normalizarEtapaKey del motor) ----

export function sinAcentos(s: string): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Lee una etapa escrita de cualquier forma. "Servicio" ya no se acepta: devuelve null. */
export function normalizarEtapa(raw: string): Etapa | null {
  const s = sinAcentos(raw);
  if (s.includes("35")) return "35 días post servicio";
  if (s.includes("destet")) return "Destete";
  if (s.includes("prepart")) return "Preparto";
  return null;
}

export function normalizarCaravana(raw: string): string {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Saca la caravana del texto de un QR de ficha. Acepta un link con ?caravana=,
 * un link cuyo último tramo es la caravana, o el texto de la caravana sola.
 * Ajustar cuando sepamos qué trae exactamente el QR de la ficha.
 */
export function caravanaDesdeQR(texto: string): string {
  const t = String(texto || "").trim();
  try {
    const u = new URL(t);
    const p = u.searchParams.get("caravana") || u.searchParams.get("id");
    if (p) return normalizarCaravana(p);
    const partes = u.pathname.split("/").filter(Boolean);
    if (partes.length) return normalizarCaravana(decodeURIComponent(partes[partes.length - 1]));
  } catch {
    /* no es un link */
  }
  return normalizarCaravana(t);
}

// ---- Validación de un registro ----

export interface DatosRegistro {
  id: string;
  cliente: string;
  fecha: string; // fecha de medición, AAAA-MM-DD
  etapa: Etapa;
  caravana: string;
  paridad: number | null;
  medicion: number | null;
}

export interface RegistroPrevio {
  id: string;
  fecha: string;
  semana: string;
  etapa: Etapa;
  caravana: string;
  paridad: number | null;
}

export interface Resultado {
  errores: Record<string, string>; // bloquean el guardado
  avisos: string[]; // piden confirmación
  duplicado?: RegistroPrevio; // registro existente con misma caravana, semana y etapa
}

export function validarRegistro(
  r: DatosRegistro,
  existentes: RegistroPrevio[],
  ahora = new Date()
): Resultado {
  const errores: Record<string, string> = {};
  const avisos: string[] = [];
  const rg = rangosDe(r.cliente);

  if (!r.cliente) errores.cliente = "Elegí la granja.";
  if (!ETAPAS.includes(r.etapa)) errores.etapa = "Etapa no válida.";

  // Fecha de medición
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.fecha)) {
    errores.fecha = "Falta la fecha de medición.";
  } else {
    const f = fechaLocal(r.fecha);
    const hoy = fechaLocal(hoyISO(ahora));
    const dias = Math.round((hoy.getTime() - f.getTime()) / 86400000);
    if (dias < 0) errores.fecha = "La fecha de medición no puede ser futura.";
    else if (dias > rg.diasAtrasAviso) avisos.push(`La fecha de medición es de hace ${dias} días. ¿Es la fecha en que se midió?`);
  }

  // Caravana
  const car = normalizarCaravana(r.caravana);
  if (!car) errores.caravana = "Falta la caravana.";
  else if (!/^[A-Z0-9\-_.]+$/.test(car)) errores.caravana = "La caravana tiene caracteres raros.";

  // Paridad
  const pMin = PARIDAD_MIN[r.etapa] ?? 0;
  if (r.paridad === null || Number.isNaN(r.paridad)) errores.paridad = "Falta la paridad.";
  else if (!Number.isInteger(r.paridad)) errores.paridad = "La paridad es un número entero.";
  else if (r.paridad < pMin) errores.paridad = pMin === 1 ? `En ${r.etapa.toLowerCase()} la paridad no puede ser 0.` : "Paridad no válida.";
  else if (r.paridad > rg.paridadMax) errores.paridad = `Paridad mayor a ${rg.paridadMax}. ¿No será la medición?`;

  // Medición
  if (r.medicion === null || Number.isNaN(r.medicion)) errores.medicion = "Falta la medición.";
  else if (r.medicion < rg.medicionMin || r.medicion > rg.medicionMax)
    errores.medicion = `La medición tiene que estar entre ${rg.medicionMin} y ${rg.medicionMax}.`;

  // Medición y paridad invertidas
  if (
    r.paridad !== null && r.medicion !== null &&
    r.paridad > rg.paridadMax && r.medicion <= rg.paridadMax &&
    r.paridad >= rg.medicionMin && r.paridad <= rg.medicionMax
  ) {
    errores.paridad = "Parece que paridad y medición están invertidas.";
  }

  // Duplicado: misma granja (ya filtrado por quien llama), caravana, semana y etapa
  let duplicado: RegistroPrevio | undefined;
  if (car && !errores.fecha) {
    const semana = semanaDeFecha(r.fecha);
    duplicado = existentes.find(e => e.id !== r.id && normalizarCaravana(e.caravana) === car && e.semana === semana && e.etapa === r.etapa);
    if (duplicado) errores.caravana = `La caravana ${car} ya tiene ${r.etapa.toLowerCase()} cargado en la semana ${semana}.`;
  }

  // Coherencia con la historia de la cerda
  if (car && r.paridad !== null && !errores.paridad) {
    const previos = existentes
      .filter(e => e.id !== r.id && normalizarCaravana(e.caravana) === car && e.paridad !== null && e.fecha <= r.fecha)
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    const ult = previos[0];
    if (ult && ult.paridad !== null) {
      if (r.etapa === "Destete" && ult.etapa === "Preparto" && ult.paridad !== r.paridad)
        avisos.push(`En el preparto (${ult.fecha}) esta cerda tenía paridad ${ult.paridad}.`);
      if (r.paridad < ult.paridad)
        avisos.push(`La paridad bajó: antes era ${ult.paridad} (${ult.etapa}, ${ult.fecha}).`);
    }
  }

  return { errores, avisos, duplicado };
}

// ---- Columnas del Data Lake (las que lee el motor del tablero) ----

export const COLUMNAS_DATALAKE = ["id_registro", "Cliente", "Fecha", "Semana", "Etapa", "Caravana", "Paridad", "Medicion"] as const;
