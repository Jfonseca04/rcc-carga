# RCC Carga: app de recolección de condición corporal

Esqueleto (fase 1, modo demo) de la app propia que reemplaza a KoboCollect.
App web instalable (PWA) que funciona sin señal. Escribe con las mismas columnas que lee el Tablero de Condición Corporal.

## Cómo correrla
    npm install
    npm run dev      # desarrollo en http://localhost:5173
    npm test         # pruebas de las reglas
    npm run build    # genera dist/ para publicar

## Archivos
- src/reglas.ts: reglas compartidas con el tablero (semana ISO, etapas, rangos, validaciones). Pensado para que el motor del tablero use el mismo módulo.
- src/db.ts: base local en el teléfono (IndexedDB con Dexie): registros, sesiones e historia de la granja.
- src/datalake.ts: exportar a Excel con columnas del Data Lake e importar historia desde un Excel del Data Lake.
- src/sync.ts: lugar de la sincronización con SharePoint (Lista "RCC Entrada" por Microsoft Graph), pendiente.
- src/Escaner.tsx: lector de QR con la cámara (jsQR, anda en Android y iPhone).
- src/App.tsx: pantallas (nueva medición, carga por cerda, lista de la sesión).

## Qué valida
- Etapa de lista cerrada: Preparto, Destete, 35 días post servicio. "Servicio" no existe.
- Paridad entera, mínimo 1 en preparto y destete (0 solo a 35 días post servicio), máximo 12.
- Medición entre 5 y 30 (rango a confirmar). Detecta paridad y medición invertidas.
- Duplicados: misma caravana, granja, semana y etapa. Ofrece corregir el existente.
- La semana sale de la fecha de MEDICIÓN; la fecha de carga se guarda aparte.
- Avisa si la paridad no coincide con el preparto o bajó respecto de la historia.

## Próximos pasos
1. Login Microsoft (MSAL) y sincronización a la Lista de SharePoint.
2. Bajar la historia de la granja del Data Lake al sincronizar.
3. Pase de la Lista al Excel Master (n8n o Power Automate).
