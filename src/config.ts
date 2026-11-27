// Configuración de Microsoft y SharePoint. Son los mismos datos que usa el tablero
// (Tablero-Test.aspx), que no son secretos: identifican el tenant y la app registrada.

export type Entorno = "prueba" | "produccion";

export const CONFIG = {
  azure: {
    tenantId: "92cc6dcf-19f7-4f88-9999-cc16946fe519",
    // Registro de app del tablero. Hay que agregarle la dirección de esta app como
    // "Redirect URI" de tipo SPA en Entra ID (ver README).
    clientId: "a7e475f5-6507-4e28-bb4d-81e64c3aa855"
  },
  scopes: ["User.Read", "Sites.ReadWrite.All"],
  sharepoint: {
    hostName: "biotecomar.sharepoint.com",
    sitePath: "/sites/RPADTC01",
    listaEntrada: "RCC Entrada",
    dataLakeFolder: "RCC/DataLake/Master",
    archivoDataLake: { prueba: "Condicion Corporal Test", produccion: "Condicion Corporal" } as Record<Entorno, string>
  },
  // Con ?prod=1 en la dirección se usa el archivo de producción; si no, el de prueba.
  entorno: (new URLSearchParams(location.search).has("prod") ? "produccion" : "prueba") as Entorno,
  // Semanas de la Lista de entrada que se bajan para detectar duplicados entre teléfonos.
  semanasEntradaABajar: 12
};
