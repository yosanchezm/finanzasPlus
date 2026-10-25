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
| `NIA_EXPLAIN_PARAPHRASE` | Opcional, apagada por defecto. Con `true`, `1`, `on` o `yes`, Nia le pide a Gemini que reescriba con otras palabras cada explicación de deudas (una llamada más por explicación) y la envía solo si no cambia ninguna cifra, no escribe números con letras y cabe en 1.200 caracteres; si no, envía la plantilla. La fuente y el aviso siempre salen tal cual |

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
- `budget`: fija, quita o lista el presupuesto de una categoría para el mes (ver [Presupuestos](#presupuestos)).
- `goal`: crea, actualiza, lista, elimina o registra aportes a metas.
- `category`: crea, actualiza, lista o archiva categorías.
- `conversation`: responde preguntas generales, explica finanzas y puede describir sus capacidades e identidad configurada.
- `analysis`: consulta movimientos, presupuestos, metas y categorías para analizar totales, tendencias y diferencias entre `you`, `partner` y `shared`. Las deudas llegan ya calculadas por el código (saldo, próxima cuota, tasa E.A. y monto vencido): el modelo las cita, pero no calcula nada de deudas.
- `debt`: préstamos y tarjetas (ver [Deudas](#deudas)).

## Presupuestos

Nia lee y escribe el presupuesto en la tabla `budget_lines` (el mismo plan que la web) y **nunca escribe en la tabla `budgets`** anterior.

- **Solo este mes**: un presupuesto por chat es una línea fija de un solo mes (`fromMonth` = `toMonth`) para la categoría. La vista previa nombra la categoría, el monto y «solo este mes»; solo se guarda al confirmar, y al confirmar el plan se calcula de nuevo con las líneas actuales. Si ya existe una línea de ese mes para la categoría, se actualiza (sin duplicar); el plan recurrente no cambia.
- **Quitar**: escribe una línea de un mes con monto 0 (el plan recurrente sigue igual). No se aceptan categorías de ingreso.
- **Modo antiguo**: si `budget_lines` no existe, o está vacía mientras `budgets` tiene filas, Nia sigue leyendo (los montos antiguos cuentan como líneas de un mes) pero rechaza escribir con el aviso de que la migración está pendiente.
- **Cifras**: el análisis recibe las cifras ya calculadas por el código (`computeBudgetMonth`, las mismas de la web: Por asignar, real por grupo, base de ingreso); el modelo no hace aritmética de presupuesto.
- **Tipos de categoría**: Nia ofrece `need`, `want`, `saving`, `investment` e `income`; no ofrece ni crea `debt`. Un tipo desconocido se lee como `need`. La categoría «Costos financieros» que crea el flujo de deudas es de tipo `debt`.

### Orden de despliegue

1. `npm run migrate:appwrite` (crea `budget_lines`).
2. `npm run migrate:budgets -- --apply` (copia los presupuestos antiguos).
3. Solo entonces, `npm run package:nia` y subir `functions/nia.tar.gz`.

Antes del paso 2 la Function funciona en modo antiguo (solo lectura de presupuestos). Prueba en Telegram: fija un presupuesto («solo este mes»), confírmalo y pide el resumen del presupuesto.

## Deudas

El intent `debt` tiene trece acciones (`setup`, armar o ajustar una deuda, se describe junto a `create`). Gemini solo extrae lo que dijo la persona; los montos, las cuotas, las tasas y las recomendaciones los calcula el núcleo compartido (`packages/finance-core`) y todo cambio de datos pide confirmación.

| Acción | Ejemplo | Qué hace |
|---|---|---|
| `create` | “Pedí un préstamo de 10 millones al 24% E.A. a 36 cuotas” | Muestra una vista previa de la deuda (con aviso de usura y de la Ley 1555 si aplica) y la crea al confirmar. Una tarjeta, o una deuda descrita con sus cargos (`setup`), la arma el asesor: muestra los supuestos, la tasa E.A., el IVA ligado a la cuota de manejo y la mora, y pregunta lo que falta (día de corte, día de pago y cómo calcula el banco el pago mínimo, con botones para la regla). No ofrece **Confirmar** mientras haya una pregunta abierta, no inventa esos datos y, al confirmar, escribe una sola vez (la tarjeta, solo su fila; el préstamo, su fila y su desembolso). El cupo todavía no se guarda. Si lo que describes es una deuda que ya tienes, el asesor compara con lo registrado y lista las diferencias como pasos (primero las correcciones, luego la tasa, los cargos y la mora); si no sabe si un dato estaba mal desde el inicio o cambió de verdad, lo pregunta con botones. Cada paso es una vista previa con su propio botón **Confirmar** (`nia:confirm:<id>`) y se guarda una sola vez; si un paso falla o lo cancelas, los siguientes no se ejecutan y Nia dice qué quedó hecho y qué no |
| `pay` | “Pagué 380 mil al carro” | Muestra cómo se reparte el pago (intereses, cargos y capital) y lo registra al confirmar, una sola vez aunque se toque el botón varias veces |
| `list` | “¿Cuánto debo?” | Lista las deudas con saldo, próxima cuota, tasa E.A. y vencido |
| `simulate` | “Simula un abono de 2 millones al carro” | Compara reducir plazo, reducir cuota y adelantar cuotas, y muestra las próximas cuotas (hasta 6; si hay más, el resto está en la web). No guarda nada. El botón **Registrar este abono** lo convierte en un pago con la estrategia simulada, que se confirma como cualquier otro |
| `advise` | “¿Cómo me conviene abonar 2 millones al carro?” | Calcula una recomendación determinística y la explica |
| `legal_rate` | “La usura de noviembre es 28.2” | Registra la tasa de usura, el IBC o el salario mínimo de un mes o año (el mes se resuelve en código; fuera de 5 a 100 % se rechaza). Si ya había un valor para ese mes, lo actualiza |
| `rate_change` | “Bajó la tasa del carro a 22 % E.A. desde hoy” | Pregunta la convención de la tasa si falta y, en un crédito de cuota fija, si se mantiene el plazo o la cuota (botones). Muestra la cuota, las cuotas restantes y el costo antes y después, con el aviso de usura del hogar. Si mantener la cuota ya no alcanza para los intereses, lo explica y muestra mantener el plazo. Aplica también a tarjetas |
| `charge_change` | “Quita el seguro de vida del carro” | Agrega un cargo (un preset: cuota de manejo con su IVA, seguro de vida, otro seguro o el 4 por mil; o campos explícitos), cambia el valor de uno que la deuda ya tiene (se busca por nombre o tipo, sin importar mayúsculas ni tildes) o lo quita, junto con lo que depende de él. Muestra la próxima cuota antes y después |
| `terms_correction` | “El corte de la tarjeta es el 20, no el 15” | Corrige un dato que estaba mal desde el inicio de la deuda: día de corte, día de pago, pago mínimo (regla, porcentaje, piso), tasa tal como la dice el banco o modalidad. Muestra el antes y el después, la tasa E.A. y, si algún pago anterior cambia de costo, la nota de que los costos se actualizan al abrir la deuda en la web (Nia no los recalcula). Un valor igual al registrado no cambia nada. El cupo, la tasa de avances, la penalización por abono anticipado, el orden de aplicación y la base de la mora se responden “no soportado aún” y no se guardan |
| `restructure` | “Reestructura el crédito a 48 cuotas, primera cuota el 2026-12-05” | Rehace el plan de un préstamo (no de una tarjeta) con el saldo de hoy más lo vencido: intereses, cargos, impuestos y mora. Muestra ese desglose, el saldo que pasa al plan nuevo, la cuota y las cuotas antes y después, el costo restante y el aviso de usura del hogar. Se puede cambiar la tasa (con los botones de convención si falta), el sistema, la periodicidad, la primera cuota y los cargos, o pedir que se condone la mora. Si no dices la primera cuota, queda un periodo después de la fecha. Al confirmar, Nia vuelve a calcular todo con la deuda de ese momento: un pago registrado entre la vista previa y el botón cambia el saldo que se escribe. Si el plan no es válido o no cabe en un solo cambio, no guarda nada y lo explica |
| `late_policy` | “Activa la mora a la usura en la tarjeta desde el 10 de octubre” | Configura la política de mora de un préstamo o de una tarjeta: tasa de usura, tasa fija, múltiplo de la tasa del contrato o sin mora, con días de gracia y fecha de vigencia. Muestra el modo, la fecha, el tope de usura vigente (y avisa si la tasa pedida lo supera) y la mora acumulada a hoy antes y después; la mora no es retroactiva. En una tarjeta la mora se calcula sobre el capital del pago mínimo sin cubrir y se cobra en el próximo extracto. Se confirma con el botón **Confirmar** y se registra una sola vez |
| `explain` | “¿Qué es la mora?”, “explícame la usura”, “¿por qué bajaron los intereses de mi tarjeta?” | Explica un tema de deudas con tus números y no guarda nada (ver [Guía de deudas](#guía-de-deudas-explicar-configurar-y-corregir)) |

Simular y recomendar aplican a préstamos con plan de cuotas; todavía no a tarjetas (tampoco en la web). Los cambios de tasa, de cargos y las reestructuraciones se confirman con el mismo botón **Confirmar** y se registran una sola vez; si el cambio es con fecha pasada y toca un pago ya registrado, Nia avisa que los costos de pagos anteriores se actualizan al abrir la deuda en la web. En sistemas que no acortan el plazo con un abono (por ejemplo, el alemán), reducir plazo y reducir cuota dan el mismo resultado y Nia lo dice.

### Guía de deudas: explicar, configurar y corregir

**Explicar (`explain`).** Los hechos (cifras ya formateadas) y los textos legales revisados viven en el núcleo (`packages/finance-core/src/explain/`); Nia solo les pone la plantilla en español (`functions/nia/debt/explain/render.js`) y la web arma sus propios popovers con los mismos hechos y los mismos textos. Hay nueve temas: tasas (E.A., N.A.M.V., M.V.), usura e IBC, mora, a dónde va el pago, cargos y GMF, extracto y pago mínimo, por qué bajan los intereses de una tarjeta, reestructurar y abonos extra.

- Una pregunta como “¿qué es la mora?” que el clasificador dejó como conversación o análisis pasa por un enrutador local (sin llamar a Gemini): exige una pregunta y un concepto, y un verbo de escritura (“pagué la mora”) lo descarta. “Explícame” muestra el menú de temas con botones; si hay varias deudas pregunta de cuál.
- Los botones `nia:exp:<tema>[:<deuda>][:<n>]` no tienen estado, no guardan nada y siguen funcionando después de un redespliegue.
- Cada explicación termina con la línea de fuente y el aviso exacto «Información educativa con tus datos; no es asesoría financiera.». Las cifras estimadas llevan «aproximado». Una guarda numérica descarta cualquier número que no esté en los hechos.
- Un tema cuyo texto legal no está revisado responde «Este tema está en revisión» y no muestra cifras. La revisión del dueño y el override `NIA_ALLOW_UNREVIEWED=1` se explican en `docs/deploy.md`.
- La paráfrasis opcional (`NIA_EXPLAIN_PARAPHRASE`) viene apagada: con ella, una explicación cuesta una llamada más a Gemini. Sin ella, explicar no llama a Gemini.

**Configurar y ajustar (asesor).** Para una tarjeta o una deuda descrita con sus cargos (`setup`), Nia muestra los supuestos, pregunta lo que falta (corte, pago, regla del pago mínimo) y no ofrece **Confirmar** mientras haya una pregunta abierta. Si lo descrito corresponde a una deuda registrada, compara y propone una cadena de pasos ordenados (correcciones, tasa, cargos, mora); cada paso se confirma con su propio botón **Confirmar** (`nia:confirm:<id>`), se guarda una sola vez y, si uno falla o se cancela, los siguientes no se ejecutan y Nia dice qué quedó hecho. Lo que Nia no puede guardar todavía (cupo, tasa de avances, penalización por abono anticipado, orden de aplicación del pago, base de la mora) se responde «no soportado aún». Si durante una configuración abierta describes otra deuda, Nia pregunta «¿Es otra deuda?» con los botones **Seguir con la actual** y **Empezar una nueva**.

**Corregir datos (`terms_correction`).** Un dato que estaba mal desde el inicio se corrige como evento retroactivo, sin tocar los pagos ya registrados. Nia lo hace por chat (“el corte es el 20, no el 15”) y la web, desde **Más acciones → Corregir datos**. Ambos muestran el antes y el después, y la corrección se puede anular desde el historial. Una versión anterior de Nia o de la web ignora estos eventos (`unknown_event_kind`), por eso se despliegan juntas.

**Popovers «¿Qué es esto?» en la web.** Junto a la tasa, la mora, los cargos, el pago mínimo y el extracto de la deuda, un botón abre la misma explicación del tema, con su fuente y el mismo aviso. Es de solo lectura, se opera con teclado y no aparece para un tema sin texto revisado. `npm run build` ejecuta `scripts/check-explain-copy.mjs` primero, igual que `npm run package:nia`.

**`/ayuda`.** Lista estas capacidades (explicar, crear o configurar una deuda, ajustar y corregir datos) junto a las generales.

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
