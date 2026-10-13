# Nia — Appwrite Function

Esta es la Function HTTP de Finanzas Plus. No depende del `package.json` del frontend.

## Configuración en Appwrite

- Runtime: Node.js 16 or newer.
- Root directory: `functions/nia`.
- Entrypoint: `index.js`.
- Execute access: `Any`.
- Variables: copiar las de `docs/setup.md` y completar los valores reales.

El paquete incluye `undici` para proporcionar `fetch`, `FormData` y `Blob` en Node.js 16. Appwrite instalará esta dependencia durante el build de la Function.

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
