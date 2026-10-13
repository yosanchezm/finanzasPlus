# Puesta en marcha de Finanzas Plus

## 1. Qué es `HOUSEHOLD_TEAM_ID`

Un Team de Appwrite es el grupo que representa al hogar. En este proyecto, el team contiene tu usuario y el de tu pareja y permite dar acceso a los mismos presupuestos, metas y categorías.

En la consola de Appwrite:

1. Abre tu proyecto.
2. Ve a **Auth → Teams**.
3. Crea un team llamado, por ejemplo, **Hogar Rivera**.
4. Copia el `$id` del team.
5. Invita a tu pareja como miembro del team.
6. Guarda ese `$id` en `.env` como `VITE_APPWRITE_HOUSEHOLD_TEAM_ID=...`.

El ID no es una contraseña. Puede estar en el frontend porque solo identifica el team; los permisos se validan en Appwrite. La API key sí es secreta y solo debe existir en `.env` local o en variables de una Function.

## 2. Variables necesarias

En la raíz del proyecto crea `.env` a partir de `.env.example`:

```env
VITE_APPWRITE_ENDPOINT=https://appwrite.tu-dominio.com/v1
VITE_APPWRITE_PROJECT_ID=tu_project_id
VITE_APPWRITE_DATABASE_ID=finanzas_plus
VITE_APPWRITE_HOUSEHOLD_ID=id_de_la_fila_del_hogar
VITE_APPWRITE_HOUSEHOLD_TEAM_ID=team_id_del_hogar
VITE_APPWRITE_RECEIPTS_BUCKET_ID=receipts

# Solo para migraciones y backend; nunca lo pongas en código frontend.
APPWRITE_API_KEY=api_key_con_permisos_de_databases_y_storage

AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
GEMINI_API_KEY=...

TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=un_secreto_largo_y_aleatorio

# Variables de la Appwrite Function de Nia
APPWRITE_ENDPOINT=https://appwrite.muxiistudio.com/v1
APPWRITE_PROJECT_ID=tu_project_id
APPWRITE_DATABASE_ID=finanzas_plus
HOUSEHOLD_TEAM_ID=team_id_del_hogar
HOUSEHOLD_ID=id_de_la_fila_del_hogar
HOUSEHOLD_CURRENCY=COP
HOUSEHOLD_TIMEZONE=America/Bogota
RECEIPTS_BUCKET_ID=receipts
TELEGRAM_USER_MAP={"123456789":{"ownerScope":"you","appwriteUserId":"id_appwrite_tuyo"},"987654321":{"ownerScope":"partner","appwriteUserId":"id_appwrite_de_tu_pareja"}}
```

No subas `.env` a Git. El prefijo `VITE_` hace que esas variables puedan ser leídas por Vite; cualquier valor sin ese prefijo queda disponible solo para Node/Functions. `VITE_APPWRITE_HOUSEHOLD_ID` es el `$id` de la fila creada en `households`; no es el Team ID.

Para ejecutar la aplicación web localmente:

```bash
npm install
npm run dev
```

Antes de iniciar sesión, agrega `localhost` como plataforma Web en **Appwrite → Project → Platforms**. Si la aplicación se publica en otro dominio, agrega también ese hostname. La cuenta debe existir en Auth y ser miembro del Team del hogar; una cuenta recién registrada desde la pantalla no obtiene membresía automáticamente.

## 3. Migrar la base de datos

La migración crea una base TablesDB, once tablas (las nueve originales más `debts` y `debt_events`), columnas, índices y un bucket privado para recibos. Es idempotente: si una tabla ya existe, la conserva y no la borra. Para Appwrite self-hosted 1.8.1 usa el tipo `string`, que es el endpoint disponible en esa versión; no cambies el script a `varchar`.

Antes de ejecutar:

1. Crea una API key en **Project → API keys**.
2. Otorga como mínimo permisos de servidor para bases de datos y storage (`databases.*`, `storage.*`).
3. Completa el team ID en `.env`.
4. Ejecuta:

```bash
npm run migrate:appwrite
```

La API key no debe ser la clave pública del frontend ni una clave compartida en Telegram. Si tu base de datos ya existe con otro ID, usa ese mismo ID en `VITE_APPWRITE_DATABASE_ID`.

### Actualizar una base existente (gestión de deudas)

La gestión de deudas agrega dos tablas nuevas (`debts` y `debt_events`) y una columna opcional `debtId` con su índice `by_household_debt` en `transactions`. Los cambios son aditivos: no se modifica ni se elimina ninguna columna, índice ni fila existente.

Antes de desplegar esta versión o una posterior, vuelve a ejecutar la migración contra la base existente:

```bash
npm run migrate:appwrite
```

- Se recomienda probarla primero dos veces en una base de desarrollo: la segunda ejecución solo debe mostrar recursos existentes y no crear nada.
- El índice único `by_dedupe` de `debt_events` evita registrar dos veces el mismo evento.
- Si necesitas revertir el código, las tablas nuevas pueden quedar sin uso; no es necesario eliminarlas.

Después de la migración, crea una fila inicial en `households` desde la consola con `name`, `currency`, `timezone` y el `$id` del usuario propietario en `ownerId`. Copia el `$id` de esa fila en `HOUSEHOLD_ID`. El `HOUSEHOLD_TEAM_ID` y el `HOUSEHOLD_ID` son cosas diferentes: el primero identifica al equipo; el segundo identifica la fila concreta del hogar.

## 4. Crear una API key de Gemini

1. Entra a [Google AI Studio](https://aistudio.google.com/).
2. Inicia sesión con Google.
3. Abre **Get API key** / **API keys**.
4. Selecciona **Create API key** y crea o elige un proyecto de Google Cloud.
5. Copia la clave una sola vez y colócala en `GEMINI_API_KEY` en el backend.
6. En la primera fase usa límites bajos y revisa **Dashboard → Usage**.

Para que una Function desplegada pueda usarla, repite `GEMINI_API_KEY` en **Functions → Nia → Settings → Environment variables**. El `.env` de tu computador no se copia automáticamente a producción.

La capa gratuita sirve para prototipar y medir el bot, pero no conviene tratarla como garantía de producción: tiene límites de frecuencia y disponibilidad que pueden cambiar. Cuando el bot ya esté estable, vincula facturación con un presupuesto y alertas de gasto. Para recibos y conversación, empieza con `gemini-3.5-flash-lite`, que es el modelo configurado por defecto en el código de Nia. Si AI Studio te ofrece un modelo Flash Lite más reciente, puedes cambiar `AI_MODEL` después de comprobar su nombre exacto en tu proyecto.

## 5. Crear y configurar la Function `Nia`

La Function recibe texto o imágenes desde Telegram, consulta el contexto del hogar, usa Gemini para extraer una operación estructurada y pide confirmación cuando falta información importante.

### Dominio en Appwrite self-hosted

Si la Function muestra un dominio como `6a982c0e00350f9e0cc1.functions.localhost`, es el dominio predeterminado de una instalación self-hosted. No lo uses como webhook público: `functions.localhost` no es tu dominio real ni es accesible desde Telegram.

En el VPS donde está instalado Appwrite, edita el archivo `.env` de Appwrite —el que está junto a `docker-compose.yml`, no el `.env` de este proyecto— y define, por ejemplo:

```env
_APP_DOMAIN=appwrite.muxiistudio.com
_APP_DOMAIN_FUNCTIONS=functions.appwrite.muxiistudio.com
_APP_OPTIONS_ROUTER_FORCE_HTTPS=enabled
```

El paquete actual de Nia necesita Node.js 16 o superior. Incluye `undici` para proporcionar `fetch`, `FormData` y `Blob` cuando se ejecuta en Node.js 16, por lo que puedes usar el runtime que aparece en tu consola. Si quieres habilitar Node.js 22 para futuras Functions, revisa `_APP_FUNCTIONS_RUNTIMES` en este mismo `.env` y agrega `node-22` conservando los runtimes que ya tengas habilitados:

```env
_APP_FUNCTIONS_RUNTIMES=node-22,node-16
```

Si esa variable ya existe, no la reemplaces ciegamente: añade `node-22` separado por coma. Después vuelve a recrear los contenedores para que el runtime quede disponible.

En tu VPS, según `server.md`, Appwrite está en `/opt/stacks/core/appwrite`, `appwrite-traefik` es interno y solo `edge-traefik` publica 80/443. Por eso no publiques puertos adicionales en Appwrite. Aplica el cambio así:

```bash
cd /opt/stacks/core/appwrite
sudo nano .env
```

Guarda las variables anteriores y recrea Appwrite usando los dos Compose que ya utiliza tu instalación:

```bash
docker compose -p appwrite -f docker-compose.yml -f compose.edge.yml up -d --force-recreate
docker compose -p appwrite -f docker-compose.yml -f compose.edge.yml ps
    # Puede responder 401 si la instalación protege este endpoint de salud.
    # Eso no significa por sí solo que Appwrite esté caído.
    curl -kI https://appwrite.muxiistudio.com/
```

Usa otro subdominio si ya tienes una convención, pero conserva la idea: el dominio de Functions debe ser un subdominio dedicado. Luego configura en el DNS:

```text
appwrite.muxiistudio.com                 A  IP_PUBLICA_DEL_VPS
functions.appwrite.muxiistudio.com       A  IP_PUBLICA_DEL_VPS
*.functions.appwrite.muxiistudio.com     A  IP_PUBLICA_DEL_VPS
```

El registro comodín (`*`) es necesario porque Appwrite genera un subdominio diferente para cada Function. El VPS debe aceptar tráfico HTTPS en los puertos 80 y 443. En tu arquitectura, `edge-traefik` solicitará un certificado individual para el hostname exacto de Nia mediante HTTP-01; el wildcard DNS no implica un wildcard SSL. Si usas Cloudflare, deja esos registros en modo DNS-only mientras validas el certificado y el enrutamiento; después puedes activar el proxy si tu configuración lo soporta.

Después de eso, una nueva implementación debería mostrar una URL parecida a:

```text
https://<FUNCTION_ID>.functions.appwrite.muxiistudio.com
```

No necesitas crear una entrada DNS individual para cada Function. Si tu instalación no usa el `docker-compose.yml` oficial o tienes Nginx/Traefik externo delante, ese proxy también debe reenviar el wildcard al router de Appwrite.

### Ruta en el `edge-traefik` de tu VPS

Tu arquitectura usa certificados individuales con HTTP-01, no un certificado wildcard automático. Crea el registro wildcard DNS, pero agrega en el proxy una ruta para el hostname exacto que Appwrite muestre después de desplegar Nia. No uses literalmente `functions.localhost`.

En tu caso, el hostname que aparece en el contexto del servidor es exactamente:

```text
6a984928003af4c0d44c.functions.appwrite.muxiistudio.com
```

En los comandos siguientes debes usar ese valor sin `https://`, sin `/` final y sin los signos `< >`. En Traefik, las comillas correctas son las dobles exteriores y las comillas invertidas internas:

```yaml
rule: "Host(`6a984928003af4c0d44c.functions.appwrite.muxiistudio.com`)"
```

No uses `Host(6a...)`, `Host('6a...')`, `Host(\"6a...\")` ni `Host(\`HOST_EXACTO_DE_NIA\`)`. El último es solo un marcador de ejemplo.

Primero copia el archivo dinámico y revisa cómo se llama el servicio existente de Appwrite:

```bash
sudo cp /opt/infrastructure/edge/dynamic/appwrite.yml /opt/infrastructure/edge/dynamic/appwrite.yml.bak-functions
sudo sed -n '1,240p' /opt/infrastructure/edge/dynamic/appwrite.yml
```

En `/opt/infrastructure/edge/dynamic/appwrite.yml` o en un archivo nuevo dentro de esa carpeta, agrega un router equivalente al siguiente. Como ya tienes el hostname anterior, puedes copiar este bloque literalmente en `/opt/infrastructure/edge/dynamic/finanzas-nia.yml`:

```yaml
http:
  routers:
    finanzas-nia-edge:
      rule: "Host(`6a984928003af4c0d44c.functions.appwrite.muxiistudio.com`)"
      entryPoints:
        - websecure
      service: finanzas-nia-appwrite
      tls:
        certResolver: letsencrypt

  services:
    finanzas-nia-appwrite:
      loadBalancer:
        passHostHeader: true
        serversTransport: finanzas-nia-internal-tls
        servers:
          - url: "https://appwrite-traefik:443"

  serversTransports:
    finanzas-nia-internal-tls:
      insecureSkipVerify: true
```

`insecureSkipVerify` solo aplica al tramo interno `edge-traefik → appwrite-traefik`; el navegador y Telegram seguirán recibiendo HTTPS público terminado por `edge-traefik`. No agregues `ports:` al Compose de Appwrite ni cambies el Traefik interno para publicar 80/443.

Comprueba la ruta y el certificado:

```bash
dig +short 6a984928003af4c0d44c.functions.appwrite.muxiistudio.com
docker exec edge-traefik getent hosts appwrite-traefik
curl -vkI https://6a984928003af4c0d44c.functions.appwrite.muxiistudio.com
docker logs edge-traefik --since 10m 2>&1 | grep -iE 'nia|acme|certificate|error|unable'
```

El segundo comando debe devolver una dirección para `appwrite-traefik`; el documento de tu servidor indica que ese contenedor pertenece tanto a las redes `appwrite` como `edge`. Si no devuelve nada, no cambies puertos ni publiques el contenedor: primero hay que revisar la unión a la red `edge`.

`dig` recibe únicamente el hostname. No escribas `dig https://.../`. Usa `curl -vkI` durante el diagnóstico porque permite ver si estás recibiendo un certificado autofirmado; cuando el certificado público ya funcione, la prueba estricta será:

```bash
curl -fsSI https://6a984928003af4c0d44c.functions.appwrite.muxiistudio.com
```

Si sigues viendo un certificado autofirmado después de corregir el router, revisa los logs de `edge-traefik`: normalmente significa que el archivo dinámico no se cargó, que el DNS apunta a otro servidor o que la petición está llegando directamente al Traefik interno. No desactives la verificación TLS de Telegram; Telegram exige un certificado público confiable.

Si el router ya existente de Appwrite define un `serversTransport` para `appwrite-traefik:443`, reutiliza ese transporte y no dupliques la definición.

La variable `_APP_DOMAIN_FUNCTIONS` reemplaza el valor de desarrollo `functions.localhost`; Appwrite recomienda separar los subdominios de la consola, Sites y Functions.

En la consola de Appwrite:

1. Abre **Functions → Nia → Settings**.
2. Selecciona Node.js 16. El paquete manual actual instala `undici` durante el build y es compatible con ese runtime. Node.js 22 también funcionará si posteriormente lo habilitas.
3. En **Execute access**, selecciona `Any` para que Telegram pueda invocar el endpoint.
4. Genera el paquete de la Function desde la raíz del repositorio y súbelo como código de la Function (carga manual de un archivo `tar.gz`), con `index.js` como punto de entrada:

   ```bash
   npm install
   npm run package:nia
   ```

   El comando compila `functions/nia/index.js` con Vite para Node.js 16, deja el resultado en `dist-nia/` y escribe `functions/nia.tar.gz`, que contiene solo `index.js` y `package.json` en la raíz del archivo. El `package.json` generado conserva `undici` como dependencia externa con la versión exacta fijada en `functions/nia/package.json`; Appwrite la instala durante el build. El script falla si el resultado usa APIs que Node.js 16 no tiene (`findLast`, `toSorted`, `structuredClone`, entre otras). Tanto `dist-nia/` como `functions/*.tar.gz` están ignorados por Git. Vuelve a ejecutar el comando y a subir el archivo cada vez que cambie el código de Nia. No uses el `package.json` del frontend como raíz de la Function.
5. Agrega estas variables en la Function (no en el frontend):

```env
APPWRITE_ENDPOINT=https://appwrite.muxiistudio.com/v1
APPWRITE_PROJECT_ID=tu_project_id
APPWRITE_API_KEY=api_key_de_servidor
GEMINI_API_KEY=...
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
APPWRITE_DATABASE_ID=6a9826a7000ebcbb7694
HOUSEHOLD_TEAM_ID=team_id_del_hogar
HOUSEHOLD_ID=id_de_la_fila_del_hogar
HOUSEHOLD_CURRENCY=COP
HOUSEHOLD_TIMEZONE=America/Bogota
RECEIPTS_BUCKET_ID=receipts
TELEGRAM_USER_MAP={"123456789":{"ownerScope":"you","appwriteUserId":"id_appwrite_tuyo"},"987654321":{"ownerScope":"partner","appwriteUserId":"id_appwrite_de_tu_pareja"}}
```

6. La Function necesitará permisos de servidor para leer/escribir TablesDB y Storage. Configúralos en **Settings → Scopes** o usa la API key de servidor prevista por el código de Nia; nunca pongas la API key en el navegador ni en Telegram.
7. Despliega la Function y confirma en **Domains** que ya no aparece `functions.localhost`. Si el dominio sigue igual, Appwrite aún no está leyendo la variable del VPS o los contenedores no fueron recreados.

## 7. Crear el bot de Telegram

1. En Telegram abre `@BotFather`.
2. Envía `/newbot`.
3. Define nombre y username terminando en `bot`.
4. Copia el token que entrega BotFather a `TELEGRAM_BOT_TOKEN`.
5. No publiques ese token: permite controlar el bot.

El bot debe vivir en una Appwrite Function con endpoint público HTTPS. En self-hosted usa el dominio generado bajo `_APP_DOMAIN_FUNCTIONS`, por ejemplo `https://<function-id>.functions.appwrite.muxiistudio.com`. En Appwrite Cloud suele ser `https://<function-id>.<region>.appwrite.run`. Telegram no debe apuntar al endpoint administrativo `/v1/functions/.../executions`: debe apuntar al dominio HTTP de la Function. La Function validará un secreto propio antes de procesar cualquier mensaje.

El flujo será:

```text
Telegram webhook → Function → getFile → Gemini → validación → confirmación → TablesDB
```

Para configurar el webhook, cuando la Function tenga una URL pública ejecuta lo siguiente desde PowerShell. Reemplaza solo los dos valores de token/secreto; conserva la URL exacta de Nia:

```powershell
$token = "TOKEN_ENTREGADO_POR_BOTFATHER"
$secret = "EL_MISMO_TELEGRAM_WEBHOOK_SECRET_DE_LA_FUNCTION"
$url = "https://6a984928003af4c0d44c.functions.appwrite.muxiistudio.com"

$body = @{
  url = $url
  secret_token = $secret
  allowed_updates = @("message", "callback_query")
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "https://api.telegram.org/bot$token/setWebhook" `
  -ContentType "application/json" `
  -Body $body
```

En Windows PowerShell puedes usar `Invoke-RestMethod` en lugar de `curl`. Telegram enviará el secreto en el header `X-Telegram-Bot-Api-Secret-Token`; la Function debe comprobarlo antes de procesar el cuerpo.

Telegram entrega un `file_id`; la Function llama a `getFile`, descarga el archivo temporal y lo sube a Appwrite Storage. La descarga de archivos de bots tiene un límite actual de 20 MB, por lo que el bot debe rechazar archivos mayores con un mensaje claro.

Comprueba que Telegram aceptó el webhook:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

En PowerShell también puedes verificarlo así:

```powershell
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo" | ConvertTo-Json -Depth 5
```

Luego envía `/start` al bot y prueba primero un mensaje de texto; después una foto nítida del recibo. Si `getWebhookInfo` muestra `last_error_message`, corrige primero DNS, certificado o el acceso `Any` de la Function.

## 8. Cómo debe comportarse Nia

Nunca guardar directamente la primera interpretación de una foto o frase. Gemini debe devolver JSON estructurado con:

```json
{
  "type": "expense",
  "amountMinor": 286500,
  "currency": "COP",
  "occurredAt": "2026-09-03T18:40:00-05:00",
  "merchant": "Éxito",
  "category": "Alimentación",
  "ownerScope": "you",
  "confidence": 0.94,
  "missingFields": []
}
```

Si falta la fecha, el monto, la moneda, el responsable o la categoría, pregunta. Si el usuario dice “ayer”, “el viernes pasado” o “la semana pasada”, resolver con la zona horaria del team y pedir confirmación cuando haya más de una interpretación. Antes de escribir, responder con un resumen y botones **Confirmar / Editar / Cancelar**.
