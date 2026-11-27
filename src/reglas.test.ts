import { describe, it, expect } from "vitest";
import { validarRegistro, semanaDeFecha, normalizarEtapa, caravanaDesdeQR, type DatosRegistro, type RegistroPrevio } from "./reglas";

const ahora = new Date(2026, 10, 27); // 27/11/2026
const base: DatosRegistro = { id: "n", cliente: "UNI", fecha: "2026-11-25", etapa: "Preparto", caravana: "a 123", paridad: 3, medicion: 14 };
const v = (p: Partial<DatosRegistro>, ex: RegistroPrevio[] = []) => validarRegistro({ ...base, ...p }, ex, ahora);

describe("reglas", () => {
  it("semana igual que el motor del tablero", () => {
    expect(semanaDeFecha("2026-11-27")).toBe("48_26");
    expect(semanaDeFecha("2027-01-01")).toBe("53_26");
    expect(semanaDeFecha("2025-12-29")).toBe("1_26");
  });
  it("registro correcto pasa", () => {
    const r = v({});
    expect(r.errores).toEqual({});
    expect(r.avisos).toEqual([]);
  });
  it("Servicio no es una etapa", () => {
    expect(normalizarEtapa("Servicio")).toBeNull();
    expect(normalizarEtapa("35 dias post servicio")).toBe("35 días post servicio");
  });
  it("paridad 0 en preparto bloqueada, permitida a 35 días", () => {
    expect(v({ paridad: 0 }).errores.paridad).toMatch(/no puede ser 0/);
    expect(v({ paridad: 0, etapa: "35 días post servicio" }).errores.paridad).toBeUndefined();
  });
  it("detecta paridad y medición invertidas", () => {
    expect(v({ paridad: 15, medicion: 3 }).errores.paridad).toMatch(/invertidas/);
  });
  it("medición fuera de rango", () => {
    expect(v({ medicion: 45 }).errores.medicion).toBeDefined();
  });
  it("duplicado misma semana y etapa", () => {
    const ex: RegistroPrevio[] = [{ id: "x", fecha: "2026-11-23", semana: "48_26", etapa: "Preparto", caravana: "A123", paridad: 3 }];
    const r = v({}, ex);
    expect(r.errores.caravana).toMatch(/ya tiene/);
    expect(r.duplicado?.id).toBe("x");
    expect(v({ etapa: "Destete" }, ex).errores.caravana).toBeUndefined();
  });
  it("fecha futura bloqueada y fecha vieja avisa", () => {
    expect(v({ fecha: "2026-11-28" }).errores.fecha).toBeDefined();
    expect(v({ fecha: "2026-11-01" }).avisos[0]).toMatch(/hace 26 días/);
  });
  it("destete con paridad distinta al preparto avisa", () => {
    const ex: RegistroPrevio[] = [{ id: "p", fecha: "2026-10-28", semana: "44_26", etapa: "Preparto", caravana: "A123", paridad: 4 }];
    expect(v({ etapa: "Destete", paridad: 3 }, ex).avisos.join(" ")).toMatch(/paridad 4/);
  });
  it("caravana desde QR", () => {
    expect(caravanaDesdeQR("https://x.sharepoint.com/ficha?caravana=ab12")).toBe("AB12");
    expect(caravanaDesdeQR("https://fichas.bioter.com/cerda/7788")).toBe("7788");
    expect(caravanaDesdeQR(" 5521 ")).toBe("5521");
  });
});
