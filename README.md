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
- src/auth.ts y src/config.ts: login Microsoft (MSAL) con el mismo tenant y registro de app que el tablero.
- src/sync.ts: subida a la Lista "RCC Entrada" y bajada de la historia desde el Data Lake, por Microsoft Graph.
- src/Escaner.tsx: lector de QR con la cámara (jsQR, anda en Android y iPhone).
- src/App.tsx: pantallas (nueva medición, carga por cerda, lista de la sesión).

## Qué valida
- Etapa de lista cerrada: Preparto, Destete, 35 días post servicio. "Servicio" no existe.
- Paridad entera, mínimo 1 en preparto y destete (0 solo a 35 días post servicio), máximo 12.
- Medición entre 5 y 30 (rango a confirmar). Detecta paridad y medición invertidas.
- Duplicados: misma caravana, granja, semana y etapa. Ofrece corregir el existente.
- La semana sale de la fecha de MEDICIÓN; la fecha de carga se guarda aparte.
- Avisa si la paridad no coincide con el preparto o bajó respecto de la historia.

## Login y sincronización con SharePoint
Sin cuenta Microsoft (o con `?demo=1` en la dirección) la app queda en modo demo: guarda en el teléfono y exporta a Excel.
Con la cuenta iniciada:
- Sube cada registro a la Lista **RCC Entrada** del sitio RPADTC01 al guardar, al volver la señal y cada minuto.
- Un registro corregido actualiza su ítem; uno borrado después de subido se marca "Anulado".
- Al empezar una medición baja la historia de la granja: el Excel del Data Lake (el mismo que lee el tablero) y lo que otros teléfonos cargaron en la Lista en las últimas 12 semanas.
- Por defecto usa el archivo de prueba "Condicion Corporal Test"; con `?prod=1` usa el de producción.

### Lo que hay que configurar una vez
1. **Entra ID** (registro de app del tablero, `a7e475f5-…`): en *Authentication* agregar una plataforma **Single-page application** con la dirección donde se publique la app como Redirect URI. En *API permissions* agregar `Sites.ReadWrite.All` (delegado) y dar consentimiento de administrador.
2. **Lista "RCC Entrada"** en el sitio RPADTC01, con estas columnas (nombre interno exacto):

   | Columna | Tipo |
   |---|---|
   | id_registro | Una línea de texto, indexada, valores únicos |
   | Cliente | Una línea de texto, indexada |
   | Fecha | Una línea de texto (AAAA-MM-DD), indexada |
   | Semana, Etapa, Caravana, Operario, Origen, CargadoEn, EditadoEn | Una línea de texto |
   | Paridad, Medicion | Número |
   | Estado | Una línea de texto ("Pendiente de aprobar" / "Anulado") |

3. **Publicar la app** en un sitio con https (por ejemplo Azure Static Web Apps). SharePoint no sirve para alojarla porque no deja registrar el service worker que la hace funcionar sin señal.

## Próximos pasos
1. Pase de la Lista al Excel Master (n8n o Power Automate), con aprobación.
2. Usuarios por granja (que cada uno vea solo la suya).
3. Ajustar la lectura del QR cuando sepamos qué trae la ficha.
