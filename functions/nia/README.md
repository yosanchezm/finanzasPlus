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
| `NIA_WEB_URL` | Opcional. URL pública de la app web (por ejemplo `https://finanzas.personal.muxiistudio.com`). Si está definida, las simulaciones largas incluyen el enlace al plan completo; si no, solo indican que está en la web, en Deudas |
| `DEBT_ADVICE_THRESHOLDS` | Opcional. JSON con los umbrales de la recomendación de abonos (ver [Deudas](#deudas)). Un JSON inválido o un valor fuera de rango se ignora y se usan los valores por defecto |

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
- `analysis`: consulta movimientos, presupuestos, metas y categorías para analizar totales, tendencias y diferencias entre `you`, `partner` y `shared`. Las deudas llegan ya calculadas por el código (saldo, próxima cuota, tasa E.A. y monto vencido): el modelo las cita, pero no calcula nada de deudas.
- `debt`: préstamos y tarjetas (ver [Deudas](#deudas)).

## Deudas

El intent `debt` tiene nueve acciones. Gemini solo extrae lo que dijo la persona; los montos, las cuotas, las tasas y las recomendaciones los calcula el núcleo compartido (`packages/finance-core`) y todo cambio de datos pide confirmación.

| Acción | Ejemplo | Qué hace |
|---|---|---|
| `create` | “Pedí un préstamo de 10 millones al 24% E.A. a 36 cuotas” | Muestra una vista previa de la deuda (con aviso de usura y de la Ley 1555 si aplica) y la crea al confirmar. Las tarjetas se crean desde la web |
| `pay` | “Pagué 380 mil al carro” | Muestra cómo se reparte el pago (intereses, cargos y capital) y lo registra al confirmar, una sola vez aunque se toque el botón varias veces |
| `list` | “¿Cuánto debo?” | Lista las deudas con saldo, próxima cuota, tasa E.A. y vencido |
| `simulate` | “Simula un abono de 2 millones al carro” | Compara reducir plazo, reducir cuota y adelantar cuotas, y muestra las próximas cuotas (hasta 6; si hay más, el resto está en la web). No guarda nada. El botón **Registrar este abono** lo convierte en un pago con la estrategia simulada, que se confirma como cualquier otro |
| `advise` | “¿Cómo me conviene abonar 2 millones al carro?” | Calcula una recomendación determinística y la explica |
| `legal_rate` | “La usura de noviembre es 28.2” | Registra la tasa de usura, el IBC o el salario mínimo de un mes o año (el mes se resuelve en código; fuera de 5 a 100 % se rechaza). Si ya había un valor para ese mes, lo actualiza |
| `rate_change` | “Bajó la tasa del carro a 22 % E.A. desde hoy” | Pregunta la convención de la tasa si falta y, en un crédito de cuota fija, si se mantiene el plazo o la cuota (botones). Muestra la cuota, las cuotas restantes y el costo antes y después, con el aviso de usura del hogar. Si mantener la cuota ya no alcanza para los intereses, lo explica y muestra mantener el plazo. Aplica también a tarjetas |
| `charge_change` | “Quita el seguro de vida del carro” | Cambia el valor de un seguro o cargo que la deuda ya tiene (se busca por nombre o tipo, sin importar mayúsculas ni tildes) o lo quita, junto con lo que depende de él. Muestra la próxima cuota antes y después. Agregar un cargo nuevo se hace en la web |
| `restructure` | “Reestructura el crédito a 48 cuotas, primera cuota el 2026-12-05” | Rehace el plan de un préstamo (no de una tarjeta) con el saldo de hoy más lo vencido: intereses, cargos, impuestos y mora. Muestra ese desglose, el saldo que pasa al plan nuevo, la cuota y las cuotas antes y después, el costo restante y el aviso de usura del hogar. Se puede cambiar la tasa (con los botones de convención si falta), el sistema, la periodicidad, la primera cuota y los cargos, o pedir que se condone la mora. Si no dices la primera cuota, queda un periodo después de la fecha. Al confirmar, Nia vuelve a calcular todo con la deuda de ese momento: un pago registrado entre la vista previa y el botón cambia el saldo que se escribe. Si el plan no es válido o no cabe en un solo cambio, no guarda nada y lo explica |

Simular y recomendar aplican a préstamos con plan de cuotas; todavía no a tarjetas (tampoco en la web). Los cambios de tasa, de cargos y las reestructuraciones se confirman con el mismo botón **Confirmar** y se registran una sola vez; si el cambio es con fecha pasada y toca un pago ya registrado, Nia avisa que los costos de pagos anteriores se actualizan al abrir la deuda en la web. En sistemas que no acortan el plazo con un abono (por ejemplo, el alemán), reducir plazo y reducir cuota dan el mismo resultado y Nia lo dice.

### Cómo se arma la recomendación

1. El núcleo compara las tres estrategias (`compareStrategies`).
2. El código promedia los ingresos y gastos de los **3 meses completos anteriores** (el mes en curso no cuenta) con la zona horaria del hogar. Una deuda compartida usa todos los movimientos; una personal usa los de su dueño y los compartidos. Si no hay ingresos registrados, el margen se considera desconocido y se dice, no se supone.
3. `advise` decide con reglas fijas, en este orden: deuda al 0 % (solo liquidez); margen apretado (reducir cuota); otra deuda con tasa E.A. más alta (pagar esa primero); si no, reducir plazo. Si el margen está apretado y hay una deuda más cara, gana la liquidez y la deuda más cara se menciona igual.
4. El núcleo entrega los **hechos** (`facts`) con todas las cifras ya formateadas. Gemini solo los redacta en un tono cercano, sin calcular.
5. Una **guarda numérica** revisa el texto: si contiene un número que no está en los hechos (se ignoran separadores de miles y el signo `%`; las fechas y el número de la Ley 1555 de los avisos sí están permitidos) o supera los 4096 caracteres, se descarta. Si Gemini falla, tarda más de 8 segundos o la guarda lo rechaza, Nia envía una plantilla en español armada solo con los hechos, de modo que la respuesta siempre llega.

### Umbrales de la recomendación

Se pueden ajustar con la variable `DEBT_ADVICE_THRESHOLDS`, un JSON con cualquiera de estas claves (las que falten usan el valor por defecto):

| Clave | Por defecto | Significado |
|---|---|---|
| `tightMarginRatio` | `0.1` | El margen (ingresos − gastos) es apretado si es menor que esta fracción del ingreso promedio |
| `maxInstallmentToIncome` | `0.3` | La cuota es apretada si supera esta fracción del ingreso promedio |
| `higherRateGapPct` | `0` | Otra deuda cuenta como más cara si su E.A. supera la de esta por más que estos puntos porcentuales (con `0`, cualquier E.A. estrictamente mayor) |

Ejemplo: `{"tightMarginRatio":0.15,"higherRateGapPct":2}`. Como las demás variables, se lee al cargar el módulo: vuelve a desplegar la Function después de cambiarla.

## Contexto de la conversación

El contexto conversacional reciente se conserva en `bot_sessions.pendingJson` junto con cualquier movimiento pendiente. Se limita para respetar el tamaño de la columna y expira después de 24 horas.

Las operaciones que cambian datos muestran una vista previa y requieren el botón `Confirmar`. Las notas de voz y audios de Telegram se envían a Gemini como entrada multimodal.
