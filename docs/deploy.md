# Despliegue del dashboard en Dokploy

Dominio: `https://finanzas.personal.muxiistudio.com`

El dashboard es una SPA estática de Vite. El `Dockerfile` la compila con Node 22 y la sirve con Nginx en el puerto `80`. El SSL lo termina `edge-traefik`; Dokploy solo recibe HTTP interno.

```text
Internet → edge-traefik (TLS) → dokploy-traefik:80 → contenedor Nginx:80
```

## 1. Variables: Build Args, no Environment

Vite incrusta las variables `VITE_*` en el bundle durante `npm run build`. Deben ir en **Dokploy → Build Args**. Si se ponen solo en *Environment*, el sitio carga sin configuración de Appwrite.

```env
VITE_APPWRITE_ENDPOINT=https://appwrite.muxiistudio.com/v1
VITE_APPWRITE_PROJECT_ID=<valor del .env local>
VITE_APPWRITE_DATABASE_ID=<valor del .env local>
VITE_APPWRITE_HOUSEHOLD_ID=<valor del .env local>
VITE_APPWRITE_HOUSEHOLD_TEAM_ID=<valor del .env local>
VITE_APPWRITE_RECEIPTS_BUCKET_ID=receipts
```

`VITE_APPWRITE_CURRENCY` es opcional (por defecto `COP`). El build falla con `Missing build arg: ...` si falta alguna de las cinco primeras.

Ninguna de estas variables es secreta: terminan en el navegador. **No** agregues `APPWRITE_API_KEY`, `GEMINI_API_KEY` ni `TELEGRAM_*`; el dashboard no las usa.

## 2. Appwrite: plataforma web

Proyecto **FinanzasPlus → Overview → Platforms → Add platform → Web**, hostname (sin protocolo ni ruta):

```text
finanzas.personal.muxiistudio.com
```

Sin este paso el login falla por CORS aunque el sitio cargue.

## 3. Dokploy: aplicación

```text
Proyecto:        personal (o el que prefieras)
Source:          GitHub → yosanchezm/finanzasPlus, rama master
Build Type:      Dockerfile
Dockerfile Path: Dockerfile
Build Context:   .
Build Args:      los de la sección 1
```

Pestaña **Domains** (una entrada por host):

```text
Host: finanzas.personal.muxiistudio.com | Path: / | Container Port: 80 | HTTPS: OFF | Certificate: None
```

## 4. edge-traefik: router público

El wildcard DNS `*.personal` ya apunta al VPS. Solo falta el router, en un archivo propio, reutilizando el servicio existente `dokploy-internal` (no redefinirlo):

```bash
sudo tee /opt/infrastructure/edge/dynamic/finanzas-plus.yml > /dev/null <<'EOF'
http:
  routers:
    finanzas-plus-edge:
      rule: "Host(`finanzas.personal.muxiistudio.com`)"
      entryPoints:
        - websecure
      service: dokploy-internal
      tls:
        certResolver: letsencrypt
EOF
```

El proveedor File recarga solo; no hace falta reiniciar `edge-traefik`.

## 5. Desplegar y verificar

Deploy desde Dokploy y esperar a que el servicio quede `1/1` y `healthy`.

```bash
docker service ls | grep -i finanzas

curl -I https://finanzas.personal.muxiistudio.com
curl -s https://finanzas.personal.muxiistudio.com/health

openssl s_client -connect finanzas.personal.muxiistudio.com:443 \
  -servername finanzas.personal.muxiistudio.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

Esperado: `HTTP 200`, `/health` responde `ok`, y el certificado no es `TRAEFIK DEFAULT CERT`. Luego iniciar sesión en el navegador.

## 6. Diagnóstico

```bash
docker exec edge-traefik wget -S -O- \
  --header='Host: finanzas.personal.muxiistudio.com' \
  http://dokploy-traefik:80/health 2>&1 | head -20
```

| Síntoma | Capa probable |
|---|---|
| HTTPS público 404 | falta `dynamic/finanzas-plus.yml` en edge-traefik |
| Prueba interna con `Host` da 404 | falta el dominio en Dokploy |
| Prueba interna da 502 | build fallido, puerto distinto de `80` o tarea sin `1/1` |
| Carga pero el login falla | falta la plataforma web en Appwrite o faltan Build Args |
| `TRAEFIK DEFAULT CERT` | router no cargado o ACME pendiente |

## 7. Rollback

Seleccionar el deployment anterior en Dokploy y redesplegar. DNS y edge-traefik no cambian.

## 8. Nia se despliega por separado

La imagen web no usa `functions/`: el `.dockerignore` excluye `functions`, `scripts`, `docs` y `dist-nia` del contexto de build. En cambio, `packages/` (código compartido que importa la web) debe seguir dentro del contexto, así que no lo agregues al `.dockerignore`.

Nia es una Appwrite Function y no pasa por Dokploy. Para desplegarla o actualizarla, genera el paquete y súbelo en la consola de Appwrite como se describe en la sección 5 de [setup.md](setup.md):

```bash
npm run package:nia
```

El archivo resultante es `functions/nia.tar.gz` (ignorado por Git). Para poder volver a una versión anterior de Nia, conserva una copia del `tar.gz` antes de reemplazarlo y vuelve a subirla.

Vuelve a generar y subir el `tar.gz` después de cada cambio de Nia. El de la gestión de deudas (crear, pagar, listar, simular y recomendar abonos) necesita antes las tablas `debts` y `debt_events` en la base de datos en producción: aplica la migración de la sección 3 de [setup.md](setup.md) y luego sube el paquete. Las variables opcionales `NIA_WEB_URL` y `DEBT_ADVICE_THRESHOLDS` se agregan en la Function y requieren un nuevo despliegue para tomar efecto.

### Orden de despliegue: tasas legales

La tabla `legal_rates` (tasas legales del hogar) se crea con la migración. El orden es:

1. Ejecuta `npm run migrate:appwrite` (primero dos veces en desarrollo) **antes** de desplegar esta versión o una posterior.
2. Despliega la web (Dokploy) y sube el `tar.gz` de Nia. Conviene hacerlo juntos para que ambas superficies calculen con las mismas tasas.
3. Si se despliega sin migrar, nada falla: la web y Nia usan los valores de la app y avisan que no pudieron leer las tasas legales.

Para volver atrás, redespliega la versión anterior; la tabla puede quedar sin uso y no hace falta borrarla.

### Guía de deudas de Nia: compuerta de revisión y orden de despliegue

Las explicaciones de deudas (`nia:exp`, «¿qué es la mora?») usan textos legales que el dueño debe revisar antes de publicarlos. `npm run package:nia` ejecuta primero `scripts/check-explain-copy.mjs` y **falla mientras haya textos sin revisar o ausentes**. Un tema sin texto revisado responde «Este tema está en revisión» y no muestra cifras.

- **S0 (solo plomería, ningún tema publicado).** Se empaqueta con el override explícito `NIA_ALLOW_UNREVIEWED=1`, que imprime una advertencia visible:
  - PowerShell: `$env:NIA_ALLOW_UNREVIEWED='1'; npm run package:nia`
  - Bash: `NIA_ALLOW_UNREVIEWED=1 npm run package:nia`
- Sin el override, el paquete se rechaza con la lista de claves faltantes: es lo esperado hasta la revisión.
- **Revisión del dueño (G.1).** `node scripts/check-explain-copy.mjs --print` lista cada clave con su texto y sus fuentes. Con la aprobación, un commit fija `reviewedOn` y `reviewedHash` de cada clave (G.2); un texto editado después de revisarse vuelve a quedar sin revisar. Con G.2 hecho, `npm run package:nia` pasa sin override y el override ya no se usa (G.3).
- Los cortes S1 a S3 y S4 a S6 se empaquetan con el override hasta que G.2 esté en el repositorio.

| Corte | Qué se despliega | Notas |
| --- | --- | --- |
| S0 | Solo el `tar.gz` de Nia | Con `NIA_ALLOW_UNREVIEWED=1`. Sin cambios de esquema |
| S1 a S3 | Solo el `tar.gz` de Nia | Después de G.2, sin override |
| S4 | Web y Nia **juntos** | Un Nia anterior ignora `terms_correction` y lee los datos sin corregir |
| S5 | Nia y web | El refactor de presets no cambia el comportamiento de la web |
| S6 | Nia | Escribe correcciones: la web de S4 debe estar publicada |
| S7 | Web (necesita G.2 o el override, porque `build` ejecuta la comprobación) y luego Nia otra vez para `/ayuda` | |

No hay migración de Appwrite en ningún corte: **no ejecutes `npm run migrate:appwrite` por esta funcionalidad**. Antes de revertir S4, anula las correcciones cuyos valores anteriores no deban reaparecer.

## Verificación local

```bash
docker build -t finanzas-plus:local \
  --build-arg VITE_APPWRITE_ENDPOINT=https://appwrite.muxiistudio.com/v1 \
  --build-arg VITE_APPWRITE_PROJECT_ID=... \
  --build-arg VITE_APPWRITE_DATABASE_ID=... \
  --build-arg VITE_APPWRITE_HOUSEHOLD_ID=... \
  --build-arg VITE_APPWRITE_HOUSEHOLD_TEAM_ID=... .

docker run --rm -p 127.0.0.1:8080:80 finanzas-plus:local
```
