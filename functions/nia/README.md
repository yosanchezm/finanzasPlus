# Nia — Appwrite Function

Esta es la Function HTTP de Finanzas Plus. No depende del `package.json` del frontend.

## Configuración en Appwrite

- Runtime: Node.js 16 (`node-16`).
- Código: el archivo `functions/nia.tar.gz` generado con `npm run package:nia` (ver [Empaquetado](#empaquetado)).
- Entrypoint: `index.js`.
- Execute access: `Any`.
- Variables: copiar las de `docs/setup.md` y completar los valores reales.

El paquete incluye `undici` para proporcionar `fetch`, `FormData` y `Blob` en Node.js 16. Appwrite instalará esta dependencia durante el build de la Function.

## Empaquetado

Desde la raíz del repositorio (no desde esta carpeta):

```bash
npm install
npm run package:nia
```

El script `scripts/package-nia.mjs` hace lo siguiente:

1. Compila `functions/nia/index.js` con Vite (build SSR, destino `node16`) y deja el resultado en `dist-nia/index.js`.
2. Genera `dist-nia/package.json` con `type: module`, `main: index.js`, `engines.node >=16` y `undici` como única dependencia externa, con la versión exacta de este `package.json`.
3. Revisa el resultado y falla si usa APIs que Node.js 16 no tiene (`findLast`, `findLastIndex`, `toSorted`, `toReversed`, `toSpliced`, `with()`, `structuredClone`, `Object.groupBy`, `Map.groupBy`). El destino `node16` de Vite solo adapta la sintaxis, no las APIs.
4. Escribe `functions/nia.tar.gz` con `index.js` y `package.json` en la raíz del archivo.

`dist-nia/` y `functions/*.tar.gz` están ignorados por Git. Sube el `tar.gz` en la consola de Appwrite (sección 5 de `docs/setup.md`). Para cambiar la versión de `undici`, edita `dependencies.undici` en este `package.json` con una versión exacta (sin `^` ni `~`); el script rechaza rangos.

### Variables de entorno

Todas se configuran en la Function de Appwrite, no en el repositorio:

| Variable | Uso |
|---|---|
| `APPWRITE_ENDPOINT` (o `APPWRITE_FUNCTION_API_ENDPOINT`) | Endpoint de la API de Appwrite |
| `APPWRITE_PROJECT_ID` (o `APPWRITE_FUNCTION_PROJECT_ID`) | Proyecto de Appwrite |
| `APPWRITE_API_KEY` | API key de servidor |
| `APPWRITE_DATABASE_ID` | Base de datos con las tablas de Finanzas Plus |
| `HOUSEHOLD_TEAM_ID`, `HOUSEHOLD_ID` | Team y fila del hogar |
| `HOUSEHOLD_CURRENCY`, `HOUSEHOLD_TIMEZONE` | Moneda (`COP`) y zona horaria (`America/Bogota`) por defecto |
| `RECEIPTS_BUCKET_ID` | Bucket de recibos (`receipts` por defecto) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Bot de Telegram y secreto del webhook |
| `TELEGRAM_USER_MAP` | JSON que vincula usuarios de Telegram con Appwrite (ver abajo) |
| `GEMINI_API_KEY`, `AI_MODEL` | Gemini y modelo (`gemini-3.5-flash-lite` por defecto) |

El módulo lee estas variables una sola vez, al cargarse; después de cambiarlas, vuelve a desplegar la Function.

`TELEGRAM_USER_MAP` es un JSON que vincula el Telegram user ID con el alcance individual y el usuario de Appwrite:

```json
{
  "123456789": {
    "ownerScope": "you",
    "appwriteUserId": "usuario_appwrite_1",
    "alias": "Yo"
  },
  "987654321": {
    "ownerScope": "partner",
    "appwriteUserId": "usuario_appwrite_2",
    "alias": "Pareja"
  }
}
```

La Function no guarda la primera interpretación automáticamente. Guarda una sesión pendiente, muestra el resumen y solo crea el movimiento cuando se confirma.

Nia también tiene tres modos de respuesta:

- `transaction`: interpreta texto, fechas relativas, recibos e imágenes; pregunta por los datos faltantes y solicita confirmación.
- `budget`: crea, actualiza, lista o elimina presupuestos y límites por categoría.
- `goal`: crea, actualiza, lista, elimina o registra aportes a metas.
- `category`: crea, actualiza, lista o archiva categorías.
- `conversation`: responde preguntas generales, explica finanzas y puede describir sus capacidades e identidad configurada.
- `analysis`: consulta movimientos, presupuestos, metas y categorías para analizar totales, tendencias y diferencias entre `you`, `partner` y `shared`.

El contexto conversacional reciente se conserva en `bot_sessions.pendingJson` junto con cualquier movimiento pendiente. Se limita para respetar el tamaño de la columna y expira después de 24 horas.

Las operaciones que cambian datos muestran una vista previa y requieren el botón `Confirmar`. Las notas de voz y audios de Telegram se envían a Gemini como entrada multimodal.
