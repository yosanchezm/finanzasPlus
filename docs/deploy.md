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
