# BunTTY v5.3

Terminal web colaborativa multi-agente basada en Bun. Cada ruta mantiene un
shell y un historial independientes mientras el servidor permanece activo:

- `http://localhost:3000/` — sesion raiz
- `http://localhost:3000/1` … `/N` — sesiones por ruta
- `http://localhost:3000/grid?cols=3&rows=2` — grid multi-agente

Al recargar una ruta, BunTTY reconecta al mismo proceso y reconstruye el
contenido del terminal.

## Features

| Version | Features |
|---------|----------|
| v5.0 | Auth (`BT_TOKEN`), TLS, readonly mode, download log, WebGL renderer, search (Ctrl+Shift+F), grid NxM |
| v5.1 | 7 themes + picker, mobile keys (touch), Sixel images |
| v5.2 | File transfer (drag-drop + API), Files panel, CSP headers (`BT_FRAME_ANCESTORS`), security headers |
| v5.3 | Session recording (asciinema v2 `.cast`), web replay player, REC indicator, grid minimal mode |

## Docker

El entorno de contenedor esta preparado para integrarse con Micro. Incluye
acceso al socket de Docker, la interfaz TUN y las capacidades de red usadas
por Micro. Bun y las dependencias se instalan durante el primer arranque.

```bash
docker compose up -d
docker compose logs -f
```

El servicio queda disponible en `http://localhost:3000` mediante la red del
host.

La raiz del repositorio conserva solamente la configuracion de Compose y la
documentacion. Todo el codigo ejecutable vive dentro de `scripts/`, que se
monta como `/scripts` en el contenedor.

## API

La sesion raiz se usa cuando no se especifica `session`. Para controlar otra
ruta, se envia su valor codificado en la consulta:

```bash
curl -X POST 'http://localhost:3000/api/sessions?session=%2F1'   # crea el shell si no existe
curl 'http://localhost:3000/api/status?session=%2F1'
curl -X POST 'http://localhost:3000/api/take-control?session=%2F1'
curl -X POST 'http://localhost:3000/api/input?session=%2F1' \
  -H 'Content-Type: application/json' \
  -d '{"data":"echo hola\r"}'
curl -X POST 'http://localhost:3000/api/release-control?session=%2F1'
```

`GET /api` devuelve la lista de rutas, metodos y cuales requieren el token completo.

Endpoints adicionales:

- `GET /api/sessions` — lista las sesiones vivas (id, pid, controlador, clientes, tamaño)
- `POST /api/sessions?session=` — crea la sesion sin abrir el navegador; idempotente (201 si la crea, 200 si ya existia, 503 al llegar a `BT_MAX_SESSIONS`)
- `DELETE /api/sessions?session=` — mata el shell; los clientes conectados reciben `session_ended`
- `POST /api/resize?session=` con `{"cols":120,"rows":40}` — tamaño del PTY (409 si un usuario tiene el control: usa `take-control` antes)
- `POST /api/upload?session=&name=archivo` — sube el cuerpo crudo (`curl --data-binary @archivo`), max 10MB
- `GET /api/screen?session=&strip=1&chars=4000` — últimos `chars` caracteres de salida; `strip=1` quita códigos ANSI
- `POST /api/release-control?session=` — devuelve el control al primer usuario conectado tras `take-control` (409 si la API no lo tiene)
- `GET /api/download?session=` — descarga del log
- `GET /api/uploads?session=` — lista archivos subidos
- `GET /api/files?session=&file=` — descarga un archivo subido
- `GET /api/recording?session=` — descarga `.cast` (asciinema v2)
- `GET /api/recording/status?session=` — estado de la grabacion
- `GET /replay?session=` — web replay player

Con token: `Authorization: Bearer <BT_TOKEN>`. `BT_VIEW_TOKEN` solo permite lectura
(`input`, `resize`, `upload`, `take-control`, `release-control`, `recording`,
`POST`/`DELETE /api/sessions` devuelven 403).
Todos los errores de `/api/*` responden JSON `{ "error": "..." }`. Cuerpos JSON
limitados a 1MB y uploads a 10MB (413).

Los archivos subidos van a `/tmp/buntty-uploads/<sesion>/`, con `/` como `+`
(`/1` → `1`, `/a/b` → `a+b`, la raíz → `+root`).

## Seguridad

BunTTY expone un **shell root** y el contenedor monta `/var/run/docker.sock`
(equivale a root en el host). Ejecutalo solo en una maquina y red de confianza.

**Exposicion de red.** `docker-compose.yml` publica los puertos solo en
`127.0.0.1`. Para exponerlos en la LAN, define `BT_BIND=0.0.0.0` **y** un
`BT_TOKEN`.

Sin token, el servidor ademas rechaza IPs de origen publicas (solo loopback y
rangos privados: `10/8`, `172.16/12`, `192.168/16`, `fc00::/7`, link-local).
Esto **no** protege frente a la LAN: un equipo en `192.168.x.x` es "privado".
En Docker Desktop (macOS/Windows) todas las conexiones llegan desde la IP del
gateway de la VM, asi que este filtro no distingue clientes. El control real es
`BT_BIND=127.0.0.1` (por defecto) o un `BT_TOKEN`. `BT_INSECURE_ANY_IP=1`
desactiva el filtro; no lo uses sin token.

Si Lupa u otro contenedor necesita entrar por `host.docker.internal`, usa
`BT_BIND=0.0.0.0` **con** `BT_TOKEN` en `.env`; el grid pasa el token a los
iframes. Kali solo se deja enmarcar por el grid de `:3000` (`BT_FRAME_ANCESTORS`
en `docker-compose.yml`); nunca uses `*`, porque cualquier web podria
enmarcar un shell root (clickjacking). Si abres el grid por IP o nombre de la
LAN, añade ese origen con `BT_KALI_FRAME_ANCESTORS="http://<host>:3000 ..."`.

**Autenticacion.**

- `BT_TOKEN`: acceso completo. Se acepta como `Authorization: Bearer <token>`,
  o una sola vez como `?token=` en el navegador; en ese caso se cambia por una
  cookie `HttpOnly; SameSite=Strict` y se quita de la URL.
- `BT_VIEW_TOKEN`: acceso de solo lectura impuesto por el servidor. No puede
  escribir en el shell, tomar el control, subir archivos ni descargar
  grabaciones. El parametro `?readonly=1` es solo cosmetico y **no** es un
  control de seguridad.
- La comparacion de tokens es de tiempo constante.

**Proteccion cross-site (sin token).** Sin `BT_TOKEN`, cualquier pagina web
que visites podria intentar hablar con `localhost:3000`. Para evitarlo:

- El WebSocket y los `POST` rechazan cualquier `Origin` distinto del propio
  host (anti CSWSH/CSRF). Para permitir otros origenes, usa `BT_ALLOWED_ORIGINS`.
- El header `Host` se limita a `localhost`, `127.0.0.1`, `[::1]` y el hostname
  de la maquina (anti DNS rebinding). Para permitir otros nombres, usa
  `BT_ALLOWED_HOSTS`.

**Validacion de entrada.**

- Los IDs de sesion solo aceptan `[A-Za-z0-9._-]` por segmento y bloquean
  `..`, lo que impide path traversal en los uploads.
- Los nombres de usuario se sanean, y el frontend los muestra con `textContent`.
- `resize` y los parametros del grid se acotan.
- El maximo de shells simultaneos es `BT_MAX_SESSIONS`.
- Las peticiones HTTP tienen un limite de 1 MB, y los mensajes WS de 16 MB.

**Archivos subidos.** Se sirven siempre como `attachment`, con
`Content-Security-Policy: sandbox`, y nunca como HTML/JS ejecutable.

**Headers.**

- CSP completa: `script-src 'self'` + solo los paquetes usados del CDN
  (`cdn.jsdelivr.net/npm/@xterm/` y `asciinema-player@3.7.1/`) y `'wasm-unsafe-eval'`, sin
  scripts inline, con `object-src 'none'`, `base-uri 'none'` y
  `frame-ancestors`.
- `X-Frame-Options`, `X-Content-Type-Options: nosniff` y
  `Referrer-Policy: no-referrer`.
- Los scripts del CDN se cargan con Subresource Integrity (SRI).

**Grabaciones.** Los `.cast` contienen lo que se teclea, incluidas las
contraseñas escritas en prompts como `sudo`. Por eso solo se pueden descargar
con acceso completo.

**Secretos.** Los scripts de `scripts/tools/` ya no traen un token de Lupa por
defecto: necesitan `LUPA_API_TOKEN`. El token que estaba hardcodeado sigue en
el historial de git, asi que **hay que rotarlo**.

## Opciones (env)

- `PORT` — puerto del servidor (def 3000)
- `BT_TOKEN` — token de acceso completo (def vacio = sin auth, solo host local)
- `BT_VIEW_TOKEN` — token de solo lectura
- `BT_ALLOWED_HOSTS` — hostnames extra aceptados en `Host` (coma-separados)
- `BT_ALLOWED_ORIGINS` — origenes extra aceptados para WS/POST (coma-separados)
- `BT_MAX_SESSIONS` — maximo de sesiones/shells simultaneos (def 50)
- `BT_BIND` — IP donde Docker publica los puertos (def `127.0.0.1`)
- `BT_INSECURE_ANY_IP` — `1` permite IPs publicas sin token (no recomendado)
- `LUPA_API_TOKEN` / `LUPA_URL` — credenciales de las herramientas `scripts/tools/lupa-*`
- `BT_TLS_CERT` / `BT_TLS_KEY` — certificados TLS
- `BT_COLS` / `BT_ROWS` — tamaño del PTY (def 80x24)
- `BT_FRAME_ANCESTORS` — CSP frame-ancestors (def `'self'`)
- `BT_KALI_FRAME_ANCESTORS` — (docker-compose) origenes que pueden enmarcar kali (def: el grid en `localhost`/`127.0.0.1`/`host.docker.internal` `:3000`)
- `SHELL` — comando a lanzar por sesion (def bash)
