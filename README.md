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
| v5.0 | Auth (`BT_TOKEN`), TLS, readonly mode, download log, WebGL renderer, search (Ctrl+F), grid NxM |
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
curl 'http://localhost:3000/api/status?session=%2F1'
curl -X POST 'http://localhost:3000/api/take-control?session=%2F1'
curl -X POST 'http://localhost:3000/api/input?session=%2F1' \
  -H 'Content-Type: application/json' \
  -d '{"data":"echo hola\r"}'
```

Endpoints adicionales:

- `GET /api/screen?session=` — captura de pantalla del terminal
- `GET /api/download?session=` — descarga del log
- `GET /api/uploads?session=` — lista archivos subidos
- `GET /api/files?session=&file=` — descarga un archivo subido
- `GET /api/recording?session=` — descarga `.cast` (asciinema v2)
- `GET /api/recording/status?session=` — estado de la grabacion
- `GET /replay?session=` — web replay player

## Seguridad

BunTTY soporta autenticacion mediante `BT_TOKEN`. Sin token configurado,
expone un shell abierto. El contenedor monta `/var/run/docker.sock`, por lo
que debe ejecutarse solamente en una maquina y red de confianza.

Headers de seguridad incluidos: `Content-Security-Policy` (frame-ancestors),
`X-Content-Type-Options: nosniff`, `X-Frame-Options`.

## Opciones (env)

- `PORT` — puerto del servidor (def 3000)
- `BT_TOKEN` — token de autenticacion (def vacio, sin auth)
- `BT_TLS_CERT` / `BT_TLS_KEY` — certificados TLS
- `BT_COLS` / `BT_ROWS` — tamaño del PTY (def 80x24)
- `BT_FRAME_ANCESTORS` — CSP frame-ancestors (def `'self'`)
- `SHELL` — comando a lanzar por sesion (def bash)
