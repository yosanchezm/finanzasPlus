# Finanzas Plus

Finanzas Plus es un dashboard web en español para llevar las finanzas de dos personas sin perder la separación entre lo personal, lo compartido y el total del hogar.

## Ejecutar la aplicación

```bash
npm install
npm run dev
```

El dashboard usa la sesión del navegador para autenticarse contra Appwrite y carga el hogar, miembros, categorías, movimientos, presupuestos y metas desde TablesDB. El registro manual permite crear, editar y eliminar movimientos; los recibos se guardan en el bucket privado. Las credenciales de servidor y las claves de IA nunca se envían al frontend.

Para conectar tu instancia self-hosted de Appwrite, sigue [docs/setup.md](docs/setup.md). La migración de TablesDB se ejecuta con `npm run migrate:appwrite` después de completar `VITE_APPWRITE_HOUSEHOLD_TEAM_ID` y `APPWRITE_API_KEY`.

## Decisiones de producto

- **Tres perspectivas permanentes:** cada usuario conserva sus movimientos personales; los movimientos compartidos aparecen en el total del hogar y en la vista de cada miembro.
- **Flujo de caja antes que contabilidad:** mostrar cuándo entra y sale el dinero, no solo el gasto acumulado. El momento de un pago importa tanto como la categoría.
- **Presupuesto flexible:** las reglas 50/20/30 sirven como punto de partida, no como una calificación. Cada pareja puede definir su propia proporción según ingresos, deudas y obligaciones.
- **Metas con intención:** una meta tiene nombre, monto objetivo, fecha, aportes y progreso. El fondo de emergencia debe estar separado de metas de ocio.
- **IA con confirmación:** Nia puede extraer datos desde texto, foto o PDF, pero nunca debe guardar un movimiento ambiguo de forma silenciosa. Si falta fecha, moneda, categoría, responsable o si el importe no es legible, debe preguntar antes de escribir.

## Arquitectura propuesta

### Appwrite self-hosted 1.8.1

Usar Appwrite como capa de identidad, permisos, base de datos, archivos y Functions:

1. **Auth:** email/password o magic link; activar MFA cuando el producto deje de ser local. Una cuenta representa a una persona.
2. **Teams:** un team representa el hogar (`household`). Invitar a la pareja al team y usar los permisos del team para registros compartidos.
3. **Database:** usar una base de datos y separar tablas por responsabilidad:

   - `households`: nombre, moneda principal, zona horaria, ownerId.
   - `household_members`: householdId, userId, alias, color, rol.
   - `transactions`: householdId, actorId, ownerScope (`you`, `partner`, `shared`), type, amountMinor, currency, occurredAt, merchant, categoryId, accountId, note, source, confidence, status.
   - `categories`: householdId, name, kind (`need`, `want`, `saving`, `debt`, `income`), color, icon, archived.
   - `budgets`: householdId, month, categoryId, plannedMinor, alertAtPercent.
   - `goals`: householdId, name, targetMinor, currentMinor, targetDate, priority, ownerScope.
   - `attachments`: transactionId, bucketFileId, mimeType, retentionUntil.
   - `ai_events`: householdId, actorId, channel, inputHash, extractedJson, missingFields, confidence, status, transactionId.
   - `bot_sessions`: estado pendiente de conversaciones de Telegram y confirmaciones de Nia.

4. **Storage:** bucket privado para recibos. Guardar solo el `fileId` en la base de datos; aplicar límites de tamaño, MIME allowlist y política de retención.
5. **Functions:** webhook de Telegram, procesador de IA, creación de movimientos, reconciliación y recordatorios. Las claves de Telegram/IA viven únicamente como variables de entorno de Functions.
6. **Realtime:** suscribir el dashboard a cambios del team para que una actualización desde Telegram aparezca en ambas sesiones.

### Flujo de Nia

```text
Telegram texto/foto
  -> webhook Appwrite Function
  -> descarga segura y temporal del archivo
  -> modelo multimodal: extracción estructurada
  -> validador de esquema + reglas de negocio
  -> si falta algo: pregunta en Telegram
  -> si está completo: muestra resumen y pide confirmación
  -> al confirmar: guarda transaction + attachment + ai_event
```

La fecha debe resolverse con la zona horaria del hogar y con una referencia explícita a “hoy”. Ejemplos: “el viernes pasado”, “ayer”, “cuando fuimos al centro” o “el 3 de agosto”. Si hay más de una interpretación, Nia debe ofrecer las opciones y esperar confirmación. Nunca usar la fecha de recepción del mensaje como sustituto silencioso.

## IA multimodal: recomendación inicial

Para una primera versión económica, separar extracción y conversación:

- **Predeterminado:** `gemini-3.1-flash-lite` si está disponible en la cuenta: la tabla oficial muestra entrada texto/imagen/video desde US$0.25 por millón de tokens y salida US$1.50 por millón en Standard; Batch/Flex baja a US$0.125/US$0.75. Es apropiado para OCR, clasificación y JSON estructurado de recibos.
- **Fallback sencillo:** `gemini-2.5-flash-lite`: modelo pequeño de alto volumen. Mantener el identificador detrás de una variable de entorno para poder migrar sin tocar el bot.
- **Alternativa con buena experiencia de tool calling:** `gpt-4.1-mini`, que acepta imagen como entrada y cuesta US$0.40 por millón de tokens de entrada y US$1.60 de salida según la ficha de modelo de OpenAI.

La decisión práctica es medir tasa de extracción correcta con recibos colombianos reales (Éxito, Rappi, Bancolombia, Nequi, facturas con IVA y transferencias) antes de fijar un proveedor. El gateway debe permitir cambiar de modelo por entorno y registrar coste estimado por `ai_event`.

## Investigación de buenas prácticas incorporada

- Registrar ingresos netos y gastos completos durante al menos un mes para obtener una foto realista.
- Separar gastos fijos, variables, periódicos y excepcionales; incluir una categoría miscelánea para no romper el presupuesto cuando aparezca algo poco frecuente.
- Programar primero obligaciones y transferencias de ahorro, y después decidir el gasto flexible.
- Construir el fondo de emergencia de forma gradual, automática y en una cuenta segura, accesible y separada del gasto diario. El objetivo se personaliza según gastos y estabilidad; tres a seis meses puede ser una referencia, no una ley.
- Tratar la deuda como un flujo con tasa, mínimo, fecha de corte y fecha de vencimiento. El dashboard debe priorizar pagos mínimos y mostrar el coste de intereses antes de proponer acelerar una deuda.
- Tener una conversación semanal breve de pareja: revisar el total, detectar diferencias entre plan y realidad y elegir un ajuste pequeño para la siguiente semana.
- Evitar consejos de inversión personalizados en la primera versión. Se puede mostrar patrimonio y aportes, pero cualquier recomendación debe advertir riesgos, horizonte, liquidez y diversificación, y derivar a asesoría profesional cuando corresponda.

Fuentes de referencia:

- [CFPB · An essential guide to building an emergency fund](https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/)
- [CFPB · Analyzing budgets](https://files.consumerfinance.gov/f/documents/cfpb_building_block_activities_analyzing-budgets_guide.pdf)
- [CFPB · Your Money, Your Goals toolkit](https://files.consumerfinance.gov/f/201603_cfpb_your-money-your-goals_toolkit_english.pdf)
- [Appwrite · Databases](https://appwrite.io/docs/products/databases)
- [Appwrite · Authentication and permissions](https://appwrite.io/docs/advanced/security/authentication)
- [Telegram · Bot API / getFile](https://core.telegram.org/bots/api)
- [Google · Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [OpenAI · GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)

## Siguiente fase recomendada

1. Crear el proyecto y el team de hogar en Appwrite, con índices para `householdId + occurredAt`, `householdId + ownerScope` y `householdId + categoryId + occurredAt`.
2. Conectar Auth y reemplazar el adaptador demo por un repositorio Appwrite.
3. Implementar la Function de Telegram con confirmaciones idempotentes y deduplicación por `update_id` + hash del archivo.
4. Agregar importación CSV de extractos, edición masiva, cuentas y conciliación.
5. Medir Nia con un set de recibos anonimizados antes de permitir guardado automático.

> Este producto es una herramienta de organización y educación financiera; no sustituye asesoramiento financiero, tributario o legal.
