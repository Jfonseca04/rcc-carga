import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, nuevoId, conocidosDe, type Registro, type Sesion } from "./db";
import {
  CLIENTES, ETAPAS, PARIDAD_MIN, rangosDe, semanaDeFecha, hoyISO, normalizarCaravana,
  caravanaDesdeQR, validarRegistro, type Etapa, type Resultado
} from "./reglas";
import { exportarExcel, leerHistorialExcel } from "./datalake";
import { modoDemo, sincronizar, bajarHistoria } from "./sync";
import { iniciarAuth, cuenta, entrar, salir } from "./auth";
import { Escaner } from "./Escaner";

type Vista = { tipo: "inicio" } | { tipo: "carga"; sesionId: string; editarId?: string } | { tipo: "lista"; sesionId: string };

export default function App() {
  const [vista, setVista] = useState<Vista>({ tipo: "inicio" });
  const online = useOnline();
  const pendientes = useLiveQuery(() => db.registros.where("estado").equals("pendiente").count(), [], 0);
  const [usuario, setUsuario] = useState<string | null>(null);
  const [authListo, setAuthListo] = useState(false);
  const [sync, setSync] = useState("");

  useEffect(() => {
    iniciarAuth().then(() => setUsuario(cuenta()?.name || cuenta()?.username || null)).catch(() => {}).finally(() => setAuthListo(true));
  }, []);

  // Sincroniza al volver la señal, al iniciar sesión y cada minuto si hay pendientes.
  const subir = useCallback(async () => {
    if (modoDemo() || !navigator.onLine) return;
    try {
      const r = await sincronizar();
      setSync(r.fallidos ? `${r.fallidos} sin subir por error` : r.enviados ? `Subidos ${r.enviados}` : "");
    } catch (e) { setSync((e as Error).message); }
  }, []);
  useEffect(() => { if (online && usuario) subir(); }, [online, usuario, subir]);
  useEffect(() => { const t = setInterval(subir, 60000); return () => clearInterval(t); }, [subir]);
  const demo = authListo && modoDemo();

  return (
    <div className="app">
      <header className="barra">
        <button className="titulo" onClick={() => setVista({ tipo: "inicio" })}>RCC Carga</button>
        <span className={"pill " + (online ? "ok" : "off")}>{online ? "Con señal" : "Sin señal"}</span>
        <button className="pill" onClick={subir} disabled={demo}>{pendientes} sin subir</button>
      </header>
      {demo && (
        <div className="demo">
          Modo demo: los datos quedan en este teléfono y se exportan a Excel.{" "}
          {online && window.self === window.top && <button className="link" onClick={() => entrar()}>Entrar con Microsoft</button>}
        </div>
      )}
      {!demo && usuario && (
        <div className="cuenta">
          <span>{usuario}</span>
          {sync && <span>{sync}</span>}
          <button className="link" onClick={() => salir()}>Salir</button>
        </div>
      )}
      <main>
        {vista.tipo === "inicio" && <Inicio usuario={usuario} onAbrir={(id, a) => setVista(a === "lista" ? { tipo: "lista", sesionId: id } : { tipo: "carga", sesionId: id })} />}
        {vista.tipo === "carga" && (
          <Carga
            key={vista.editarId || "nuevo"}
            sesionId={vista.sesionId}
            editarId={vista.editarId}
            onLista={() => setVista({ tipo: "lista", sesionId: vista.sesionId })}
            onEditar={id => setVista({ tipo: "carga", sesionId: vista.sesionId, editarId: id })}
            onNuevo={() => setVista({ tipo: "carga", sesionId: vista.sesionId })}
            onGuardado={subir}
          />
        )}
        {vista.tipo === "lista" && (
          <Lista
            sesionId={vista.sesionId}
            onCargar={() => setVista({ tipo: "carga", sesionId: vista.sesionId })}
            onEditar={id => setVista({ tipo: "carga", sesionId: vista.sesionId, editarId: id })}
            onSalir={() => setVista({ tipo: "inicio" })}
            onCambio={subir}
          />
        )}
      </main>
    </div>
  );
}

// ---------------- Inicio: abrir una sesión de medición ----------------

function Inicio({ onAbrir, usuario }: { onAbrir: (sesionId: string, a: "carga" | "lista") => void; usuario: string | null }) {
  const [cliente, setCliente] = useState(() => leer("cliente") || "");
  const [operario, setOperario] = useState(() => leer("operario") || "");
  const [bajando, setBajando] = useState(false);
  useEffect(() => { if (usuario && !operario) setOperario(usuario); }, [usuario]); // eslint-disable-line
  const [etapa, setEtapa] = useState<Etapa | "">("");
  const [fecha, setFecha] = useState(hoyISO());
  const [msg, setMsg] = useState("");
  const sesiones = useLiveQuery(() => db.sesiones.orderBy("creadaEn").reverse().limit(10).toArray(), [], []);
  const conteos = useLiveQuery(async () => {
    const m: Record<string, number> = {};
    for (const r of await db.registros.filter(x => !x.anulado).toArray()) m[r.sesionId] = (m[r.sesionId] || 0) + 1;
    return m;
  }, [], {} as Record<string, number>);
  const nHist = useLiveQuery(() => (cliente ? db.historial.where("cliente").equals(cliente).count() : 0), [cliente], 0);
  const archivo = useRef<HTMLInputElement>(null);

  const listo = cliente && etapa && fecha && operario.trim();
  const futura = fecha > hoyISO();

  async function iniciar() {
    if (!listo || futura) return;
    guardar("cliente", cliente);
    guardar("operario", operario.trim());
    const s: Sesion = { id: nuevoId(), cliente, etapa: etapa as Etapa, fecha, operario: operario.trim(), creadaEn: new Date().toISOString() };
    await db.sesiones.add(s);
    if (!modoDemo() && navigator.onLine) bajar(); // refresca la historia sin frenar la carga
    onAbrir(s.id, "carga");
  }

  async function bajar() {
    if (!cliente) return;
    setBajando(true);
    try {
      const r = await bajarHistoria(cliente);
      setMsg(`Historia de ${cliente} actualizada: ${r.dataLake} registros del Data Lake y ${r.entrada} de otros teléfonos.`);
    } catch (e) { setMsg(`No se pudo bajar la historia: ${(e as Error).message}`); }
    finally { setBajando(false); }
  }

  async function importar(f: File) {
    const { filas, descartadas } = leerHistorialExcel(await f.arrayBuffer());
    await db.historial.bulkPut(filas);
    setMsg(`Historia cargada: ${filas.length} registros${descartadas ? ` (${descartadas} filas descartadas por datos incompletos)` : ""}.`);
  }

  return (
    <section>
      <h1>Nueva medición</h1>

      <label className="campo">
        <span>Granja</span>
        <select value={cliente} onChange={e => setCliente(e.target.value)}>
          <option value="">Elegí la granja</option>
          {CLIENTES.map(c => <option key={c}>{c}</option>)}
        </select>
      </label>

      <div className="campo">
        <span>Etapa</span>
        <div className="etapas">
          {ETAPAS.map(e => (
            <button key={e} className={"etapa " + (etapa === e ? "activa" : "")} onClick={() => setEtapa(e)}>{e}</button>
          ))}
        </div>
      </div>

      <label className="campo">
        <span>Fecha en que se midió</span>
        <input type="date" value={fecha} max={hoyISO()} onChange={e => setFecha(e.target.value)} />
        {fecha && !futura && <small>Semana {semanaDeFecha(fecha)}</small>}
        {futura && <small className="error">La fecha no puede ser futura.</small>}
      </label>

      <label className="campo">
        <span>Quién mide</span>
        <input value={operario} onChange={e => setOperario(e.target.value)} placeholder="Nombre" autoComplete="name" />
      </label>

      <button className="btn" disabled={!listo || futura} onClick={iniciar}>Empezar a cargar</button>

      {cliente && (
        <p className="nota">
          {nHist ? `Hay ${nHist} registros de historia de ${cliente} para precargar paridades y detectar duplicados.` : `Sin historia de ${cliente} en este teléfono.`}{" "}
          {!modoDemo()
            ? <button className="link" disabled={bajando} onClick={bajar}>{bajando ? "Bajando…" : "Actualizar historia desde SharePoint"}</button>
            : <button className="link" onClick={() => archivo.current?.click()}>Cargar historia desde un Excel del Data Lake</button>}
          <input ref={archivo} type="file" accept=".xlsx,.xls" hidden onChange={e => e.target.files?.[0] && importar(e.target.files[0])} />
        </p>
      )}
      {msg && <p className="ok-msg">{msg}</p>}

      {sesiones.length > 0 && (
        <>
          <h2>Mediciones recientes</h2>
          <ul className="sesiones">
            {sesiones.map(s => (
              <li key={s.id}>
                <button onClick={() => onAbrir(s.id, "lista")}>
                  <strong>{s.cliente} · {s.etapa}</strong>
                  <span>{formatoFecha(s.fecha)} · semana {semanaDeFecha(s.fecha)} · {conteos[s.id] || 0} cerdas</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------- Carga: una cerda por pantalla ----------------

function Carga({ sesionId, editarId, onLista, onEditar, onNuevo, onGuardado }: {
  sesionId: string; editarId?: string; onLista: () => void; onEditar: (id: string) => void; onNuevo: () => void; onGuardado: () => void;
}) {
  const sesion = useLiveQuery(() => db.sesiones.get(sesionId), [sesionId]);
  const cargadas = useLiveQuery(() => db.registros.where("sesionId").equals(sesionId).filter(r => !r.anulado).count(), [sesionId], 0);
  const [caravana, setCaravana] = useState("");
  const [paridad, setParidad] = useState("");
  const [medicion, setMedicion] = useState("");
  const [origen, setOrigen] = useState<"qr" | "tipeado">("tipeado");
  const [escaneando, setEscaneando] = useState(false);
  const [res, setRes] = useState<Resultado | null>(null);
  const [confirmarAvisos, setConfirmarAvisos] = useState(false);
  const [previa, setPrevia] = useState<string>("");
  const [hecho, setHecho] = useState("");
  const refCaravana = useRef<HTMLInputElement>(null);
  const refParidad = useRef<HTMLInputElement>(null);
  const refMedicion = useRef<HTMLInputElement>(null);
  const idRef = useRef(editarId || nuevoId());

  // Al editar, traer el registro
  useEffect(() => {
    if (!editarId) return;
    db.registros.get(editarId).then(r => {
      if (!r) return;
      setCaravana(r.caravana);
      setParidad(r.paridad === null ? "" : String(r.paridad));
      setMedicion(r.medicion === null ? "" : String(r.medicion));
      setOrigen(r.origen);
    });
  }, [editarId]);

  // Historia de la cerda: precarga paridad y muestra lo último
  useEffect(() => {
    setRes(null);
    setConfirmarAvisos(false);
    const car = normalizarCaravana(caravana);
    if (!sesion || !car) { setPrevia(""); return; }
    let vigente = true;
    conocidosDe(sesion.cliente).then(todos => {
      if (!vigente) return;
      const previos = todos.filter(r => r.id !== idRef.current && normalizarCaravana(r.caravana) === car).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
      const u = previos[0];
      if (!u) { setPrevia("Cerda sin registros previos en este teléfono."); return; }
      setPrevia(`Último: ${u.etapa}, ${formatoFecha(u.fecha)}, paridad ${u.paridad ?? "?"}, medición ${u.medicion ?? "?"}.`);
      if (!editarId && paridad === "" && u.paridad !== null) {
        // Preparto -> Destete: misma paridad. Otros pasos: se sugiere la última, el operario corrige.
        setParidad(String(u.paridad));
      }
    });
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caravana, sesion]);

  const onLeido = useCallback((texto: string) => {
    setEscaneando(false);
    setCaravana(caravanaDesdeQR(texto));
    setOrigen("qr");
    setTimeout(() => refParidad.current?.focus(), 50);
  }, []);

  if (!sesion) return <p>Cargando…</p>;
  const rg = rangosDe(sesion.cliente);

  function datos() {
    return {
      id: idRef.current,
      cliente: sesion!.cliente,
      fecha: sesion!.fecha,
      etapa: sesion!.etapa,
      caravana,
      paridad: paridad === "" ? null : Number(paridad),
      medicion: medicion === "" ? null : Number(medicion.replace(",", "."))
    };
  }

  async function guardarRegistro() {
    const d = datos();
    const r = validarRegistro(d, await conocidosDe(sesion!.cliente));
    setRes(r);
    if (Object.keys(r.errores).length) return;
    if (r.avisos.length && !confirmarAvisos) { setConfirmarAvisos(true); return; }
    const ahora = new Date().toISOString();
    const previo = editarId ? await db.registros.get(editarId) : undefined;
    const reg: Registro = {
      ...d,
      caravana: normalizarCaravana(d.caravana),
      semana: semanaDeFecha(d.fecha),
      sesionId,
      cargadoEn: previo?.cargadoEn || ahora,
      editadoEn: previo ? ahora : undefined,
      operario: sesion!.operario,
      origen,
      estado: "pendiente",
      spItemId: previo?.spItemId
    };
    await db.registros.put(reg);
    navigator.vibrate?.(40);
    onGuardado();
    if (editarId) { onLista(); return; }
    setHecho(`Guardada ${reg.caravana}: paridad ${reg.paridad}, medición ${reg.medicion}.`);
    idRef.current = nuevoId();
    setCaravana(""); setParidad(""); setMedicion(""); setOrigen("tipeado"); setRes(null); setConfirmarAvisos(false); setPrevia("");
    refCaravana.current?.focus();
  }

  const err = res?.errores || {};

  return (
    <section>
      <div className="cabecera-sesion">
        <div>
          <strong>{sesion.cliente} · {sesion.etapa}</strong>
          <span>Medido el {formatoFecha(sesion.fecha)} · semana {semanaDeFecha(sesion.fecha)}</span>
        </div>
        <button className="btn chico secundario" onClick={onLista}>{cargadas} cargadas</button>
      </div>

      {escaneando && <Escaner onLeido={onLeido} onCerrar={() => setEscaneando(false)} />}

      <h1>{editarId ? "Corregir cerda" : "Cerda"}</h1>
      {hecho && !editarId && <p className="ok-msg">{hecho}</p>}

      <label className={"campo " + (err.caravana ? "con-error" : "")}>
        <span>Caravana</span>
        <div className="fila">
          <input ref={refCaravana} value={caravana} autoFocus inputMode="text" autoCapitalize="characters"
            onChange={e => { setCaravana(e.target.value); setOrigen("tipeado"); }}
            onKeyDown={e => e.key === "Enter" && refParidad.current?.focus()} />
          <button className="btn chico" onClick={() => setEscaneando(true)}>Escanear QR</button>
        </div>
        {err.caravana && <small className="error">{err.caravana}</small>}
        {res?.duplicado && (
          <button className="link" onClick={() => onEditar(res.duplicado!.id)} disabled={!("sesionId" in res.duplicado)}>
            {"sesionId" in res.duplicado ? "Abrir el registro existente para corregirlo" : "El registro existente está en el Data Lake: pedí la corrección."}
          </button>
        )}
        {previa && <small>{previa}</small>}
      </label>

      <label className={"campo grande " + (err.paridad ? "con-error" : "")}>
        <span>Paridad <em>(número de partos, {PARIDAD_MIN[sesion.etapa]} a {rg.paridadMax})</em></span>
        <input ref={refParidad} value={paridad} inputMode="numeric" pattern="[0-9]*"
          onChange={e => { setParidad(e.target.value.replace(/\D/g, "")); setRes(null); setConfirmarAvisos(false); }}
          onKeyDown={e => e.key === "Enter" && refMedicion.current?.focus()} />
        {err.paridad && <small className="error">{err.paridad}</small>}
      </label>

      <label className={"campo grande medicion " + (err.medicion ? "con-error" : "")}>
        <span>Medición caliper <em>({rg.medicionMin} a {rg.medicionMax})</em></span>
        <input ref={refMedicion} value={medicion} inputMode="decimal"
          onChange={e => { setMedicion(e.target.value.replace(/[^\d.,]/g, "")); setRes(null); setConfirmarAvisos(false); }}
          onKeyDown={e => e.key === "Enter" && guardarRegistro()} />
        {err.medicion && <small className="error">{err.medicion}</small>}
      </label>

      {err.fecha && <p className="error">{err.fecha}</p>}
      {confirmarAvisos && res?.avisos.length ? (
        <div className="aviso">
          {res.avisos.map(a => <p key={a}>{a}</p>)}
          <p>Si está bien, tocá Guardar de nuevo.</p>
        </div>
      ) : null}

      <button className="btn" onClick={guardarRegistro}>{confirmarAvisos ? "Guardar igual" : "Guardar"}</button>
      {editarId && <button className="btn secundario" onClick={onNuevo}>Cancelar corrección</button>}
    </section>
  );
}

// ---------------- Lista de la sesión ----------------

function Lista({ sesionId, onCargar, onEditar, onSalir, onCambio }: { sesionId: string; onCargar: () => void; onEditar: (id: string) => void; onSalir: () => void; onCambio: () => void }) {
  const sesion = useLiveQuery(() => db.sesiones.get(sesionId), [sesionId]);
  const regs = useLiveQuery(() => db.registros.where("sesionId").equals(sesionId).filter(r => !r.anulado).toArray(), [sesionId], []);
  const [aBorrar, setABorrar] = useState<string | null>(null);
  const ordenados = useMemo(() => [...regs].sort((a, b) => (a.cargadoEn < b.cargadoEn ? 1 : -1)), [regs]);
  if (!sesion) return <p>Cargando…</p>;

  async function borrar(r: Registro) {
    if (aBorrar !== r.id) { setABorrar(r.id); return; } // segundo toque confirma
    // Si ya se subió, se marca anulado y se avisa a la Lista; si no, se borra del teléfono.
    if (r.spItemId) await db.registros.update(r.id, { anulado: true, estado: "pendiente" });
    else await db.registros.delete(r.id);
    setABorrar(null);
    onCambio();
  }

  return (
    <section>
      <div className="cabecera-sesion">
        <div>
          <strong>{sesion.cliente} · {sesion.etapa}</strong>
          <span>Medido el {formatoFecha(sesion.fecha)} · semana {semanaDeFecha(sesion.fecha)} · {sesion.operario}</span>
        </div>
      </div>
      <h1>{regs.length} cerdas cargadas</h1>
      <div className="acciones">
        <button className="btn" onClick={onCargar}>Seguir cargando</button>
        <button className="btn secundario" disabled={!regs.length}
          onClick={() => exportarExcel(regs, `RCC_${sesion.cliente.replace(/\W+/g, "_")}_${sesion.etapa.split(" ")[0]}_${semanaDeFecha(sesion.fecha)}.xlsx`)}>
          Exportar Excel
        </button>
      </div>
      <table className="tabla">
        <thead><tr><th>Caravana</th><th>Paridad</th><th>Medición</th><th></th></tr></thead>
        <tbody>
          {ordenados.map(r => (
            <tr key={r.id}>
              <td>
                {r.caravana}{r.origen === "qr" && <span className="tag">QR</span>}
                <span className={"estado " + (r.errorSync ? "err" : r.estado)} title={r.errorSync || ""}>
                  {r.errorSync ? "Error al subir" : r.estado === "sincronizado" ? "Subido" : "Sin subir"}
                </span>
              </td>
              <td>{r.paridad}</td>
              <td>{r.medicion}</td>
              <td className="der">
                <button className="link" onClick={() => onEditar(r.id)}>Corregir</button>{" "}
                <button className="link rojo" onClick={() => borrar(r)}>{aBorrar === r.id ? "¿Seguro? Tocá de nuevo" : "Borrar"}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn secundario" onClick={onSalir}>Terminar</button>
    </section>
  );
}

// ---------------- utilidades ----------------

function useOnline() {
  const [on, setOn] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    addEventListener("online", a); addEventListener("offline", b);
    return () => { removeEventListener("online", a); removeEventListener("offline", b); };
  }, []);
  return on;
}
function formatoFecha(iso: string) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
function leer(k: string) { try { return localStorage.getItem("rcc." + k); } catch { return null; } }
function guardar(k: string, v: string) { try { localStorage.setItem("rcc." + k, v); } catch { /* sin storage */ } }
