// Sincronización con SharePoint por Microsoft Graph.
//
// Subida: cada registro pendiente va a la Lista "RCC Entrada" del sitio. El id_registro
// es único en la Lista, así que reenviar (por un corte de señal a mitad de camino) no duplica.
// Un registro corregido después de enviado actualiza su ítem; uno borrado se marca "Anulado".
//
// Bajada: la historia de la granja sale del Excel del Data Lake (el mismo que lee el tablero)
// y de lo cargado en la Lista por otros teléfonos. Con eso la app precarga la paridad y
// detecta duplicados aunque la cerda se haya cargado en otro celular.

import { db, type Registro, type Historial } from "./db";
import { token, cuenta } from "./auth";
import { CONFIG } from "./config";
import { leerHistorialExcel } from "./datalake";
import { normalizarEtapa, normalizarCaravana, semanaDeFecha, hoyISO } from "./reglas";

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Modo demo: sin cuenta Microsoft, o forzado con ?demo=1. Los datos solo se exportan a Excel. */
export function modoDemo(): boolean {
  return new URLSearchParams(location.search).has("demo") || !cuenta();
}

async function graph(path: string, init: RequestInit = {}) {
  const t = await token();
  const r = await fetch(path.startsWith("http") ? path : GRAPH + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly",
      ...(init.headers || {})
    }
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).error?.message || msg; } catch { /* sin cuerpo */ }
    const e = new Error(msg) as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  return r.status === 204 ? null : r.headers.get("content-type")?.includes("json") ? r.json() : r.arrayBuffer();
}

let cacheIds: { siteId: string; listId: string } | null = null;
async function ids() {
  if (cacheIds) return cacheIds;
  const sp = CONFIG.sharepoint;
  const site = await graph(`/sites/${sp.hostName}:${sp.sitePath}`);
  const listas = await graph(`/sites/${site.id}/lists?$filter=displayName eq '${encodeURIComponent(sp.listaEntrada)}'&$select=id,displayName`);
  const lista = listas.value?.[0];
  if (!lista) throw new Error(`No existe la Lista "${sp.listaEntrada}" en el sitio. Ver README para crearla.`);
  cacheIds = { siteId: site.id, listId: lista.id };
  return cacheIds;
}

/** Campos del ítem de la Lista. Los nombres internos de las columnas tienen que coincidir. */
function campos(r: Registro) {
  return {
    Title: r.caravana,
    id_registro: r.id,
    Cliente: r.cliente,
    Fecha: r.fecha,
    Semana: r.semana,
    Etapa: r.etapa,
    Caravana: r.caravana,
    Paridad: r.paridad,
    Medicion: r.medicion,
    CargadoEn: r.cargadoEn,
    EditadoEn: r.editadoEn || null,
    Operario: r.operario,
    Origen: r.origen,
    Estado: r.anulado ? "Anulado" : "Pendiente de aprobar"
  };
}

async function buscarPorIdRegistro(siteId: string, listId: string, id: string): Promise<string | null> {
  const r = await graph(`/sites/${siteId}/lists/${listId}/items?$filter=fields/id_registro eq '${id}'&$select=id`);
  return r.value?.[0]?.id ?? null;
}

async function enviarUno(r: Registro, siteId: string, listId: string) {
  const base = `/sites/${siteId}/lists/${listId}/items`;
  let itemId = r.spItemId || null;
  if (!itemId) {
    try {
      itemId = (await graph(base, { method: "POST", body: JSON.stringify({ fields: campos(r) }) })).id as string;
    } catch (e) {
      // Puede que ya esté (se envió antes y se cortó la respuesta): buscarlo y actualizarlo.
      itemId = await buscarPorIdRegistro(siteId, listId, r.id);
      if (!itemId) throw e;
      await graph(`${base}/${itemId}/fields`, { method: "PATCH", body: JSON.stringify(campos(r)) });
    }
  } else {
    await graph(`${base}/${itemId}/fields`, { method: "PATCH", body: JSON.stringify(campos(r)) });
  }
  if (r.anulado) await db.registros.delete(r.id);
  else await db.registros.update(r.id, { estado: "sincronizado", spItemId: itemId, errorSync: undefined });
}

let enCurso: Promise<{ enviados: number; fallidos: number }> | null = null;

/** Envía todo lo pendiente. Si se llama dos veces seguidas, la segunda espera a la primera. */
export function sincronizar(): Promise<{ enviados: number; fallidos: number }> {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    if (modoDemo() || !navigator.onLine) return { enviados: 0, fallidos: 0 };
    const pendientes = await db.registros.where("estado").equals("pendiente").toArray();
    if (!pendientes.length) return { enviados: 0, fallidos: 0 };
    const { siteId, listId } = await ids();
    let enviados = 0, fallidos = 0;
    for (const r of pendientes) {
      try { await enviarUno(r, siteId, listId); enviados++; }
      catch (e) { fallidos++; await db.registros.update(r.id, { errorSync: (e as Error).message }); }
    }
    return { enviados, fallidos };
  })().finally(() => { enCurso = null; });
  return enCurso;
}

/** Baja la historia de la granja: el Excel del Data Lake + lo cargado en la Lista en las últimas semanas. */
export async function bajarHistoria(cliente: string): Promise<{ dataLake: number; entrada: number }> {
  if (modoDemo() || !navigator.onLine) return { dataLake: 0, entrada: 0 };
  const sp = CONFIG.sharepoint;
  const { siteId, listId } = await ids();

  // 1. Data Lake (mismo archivo que lee el tablero)
  const hijos = await graph(`/sites/${siteId}/drive/root:/${sp.dataLakeFolder}:/children?$select=id,name`);
  const patron = sp.archivoDataLake[CONFIG.entorno].toLowerCase();
  const archivo = (hijos.value as { id: string; name: string }[])
    .filter(f => f.name.toLowerCase().includes(patron) && /\.xlsx?$/i.test(f.name))
    .sort((a, b) => a.name.length - b.name.length)[0];
  let dl: Historial[] = [];
  if (archivo) {
    const buf = (await graph(`/sites/${siteId}/drive/items/${archivo.id}/content`)) as ArrayBuffer;
    dl = leerHistorialExcel(buf).filas.filter(f => f.cliente === cliente);
  }

  // 2. Lista de entrada (otros teléfonos, todavía no pasados al Master)
  const desde = new Date(); desde.setDate(desde.getDate() - 7 * CONFIG.semanasEntradaABajar);
  let url: string | null = `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=500&$filter=fields/Cliente eq '${cliente.replace(/'/g, "''")}' and fields/Fecha ge '${hoyISO(desde)}'`;
  const ent: Historial[] = [];
  while (url) {
    const pag: { value: { fields: Record<string, unknown> }[]; "@odata.nextLink"?: string } = await graph(url);
    for (const it of pag.value) {
      const f = it.fields;
      const etapa = normalizarEtapa(String(f.Etapa ?? ""));
      const fecha = String(f.Fecha ?? "").slice(0, 10);
      if (!etapa || !fecha || f.Estado === "Anulado") continue;
      ent.push({
        id: String(f.id_registro), cliente, fecha, semana: String(f.Semana || semanaDeFecha(fecha)), etapa,
        caravana: normalizarCaravana(String(f.Caravana ?? "")),
        paridad: f.Paridad == null ? null : Number(f.Paridad),
        medicion: f.Medicion == null ? null : Number(f.Medicion)
      });
    }
    url = pag["@odata.nextLink"] || null;
  }

  await db.transaction("rw", db.historial, async () => {
    await db.historial.where("cliente").equals(cliente).delete();
    await db.historial.bulkPut([...dl, ...ent]);
  });
  return { dataLake: dl.length, entrada: ent.length };
}
