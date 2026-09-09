# BunTTY 0.0.1

Terminal web colaborativa basada en Bun. Cada ruta mantiene un shell y un
historial independientes mientras el servidor permanece activo:

- `http://localhost:3001/`
- `http://localhost:3001/1`
- `http://localhost:3001/2`

Al recargar una ruta, BunTTY reconecta al mismo proceso y reconstruye el
contenido del terminal.

Si se interrumpe la conexión, el navegador reintenta automáticamente con esperas
de 1 a 30 segundos y reconstruye el historial sin duplicarlo. Si el shell termina,
la sesión se queda cerrada hasta que recargues la página.

El navegador conserva hasta 50.000 líneas de historial para desplazarse hacia
atrás. Al recargar, solo puede reconstruir la salida que conserve el servidor:
los últimos 8.000.000 de caracteres por sesión, en memoria. El contenido que
supere esos límites sale del buffer de la terminal, pero sigue disponible en
los registros en disco de las sesiones nuevas.

`BUNTTY_HISTORY_CHARS` permite cambiar el límite del buffer del servidor al
arrancar (por defecto `8000000`). Es independiente de las 50.000 filas del
navegador y de los registros en disco; valores grandes requieren más memoria.

## Historial en disco

Además del historial de la terminal, las sesiones nuevas guardan comandos y
salida en `logs/`. El botón **Historial** permite leer bloques anteriores por
páginas, incluso después de cerrar el shell o reiniciar el servidor.

```text
logs/
  0/   # sesión /
  1/   # sesión /1
  2/   # sesión /2
```

Cada archivo `.jsonl` contiene como máximo 10 entradas ejecutadas en el prompt
de Bash, junto con sus marcas de tiempo, salida y código de terminación. Un
pipeline, una instrucción multilínea o un bloque compuesto cuenta como una
entrada. Las teclas introducidas dentro de `vim`, `read` u otro programa no
cuentan como comandos del shell. Si una entrada no aparece en el historial de
Bash, se registra su primera instrucción mediante `BASH_COMMAND`.

Los archivos también rotan al superar aproximadamente 1 MiB. Una salida larga
puede ocupar varios archivos, con referencias al comando que continúa. Los
archivos de una ejecución nueva tienen nombres únicos y no sobrescriben los
anteriores. `/0` y los nombres de sesión personalizados usan nombres con sufijo
para evitar colisiones y rutas ambiguas.

Los registros conservan la salida original, incluidas las secuencias ANSI. El
visor presenta texto de solo lectura; no recrea una aplicación interactiva ni
restaura procesos cerrados. Carga como máximo 256 KiB de registros por página.
La opción `BUNTTY_LOG_DIR` cambia la carpeta de guardado y Docker monta
`./logs:/logs`. `logs/` está excluida de Git.

El conteo depende de la integración de Bash (`DEBUG` y `PROMPT_COMMAND`); otros
shells guardan salida por tamaño sin identificar comandos. Reemplazar esos hooks
dentro del shell desactiva el conteo. Los registros empiezan al crear sesiones
con esta versión; no recuperan salida ya descartada de sesiones antiguas. No se
borran automáticamente: su retención depende del espacio disponible en disco.

API de lectura: `/api/logs?session=%2F1` enumera bloques; `file` y `offset`
permiten leer páginas, y `before` enumera bloques anteriores.

## Docker

El entorno de contenedor esta preparado para integrarse con Micro. Incluye
Debian, acceso al socket de Docker, la interfaz TUN y las capacidades de red
usadas por Micro.
Bun y las dependencias se instalan durante el primer arranque.

```bash
docker compose up -d
docker compose logs -f
```

Compose publica el servicio en `http://localhost:3001` mediante la red del
host.

El servidor acepta `PORT` (por defecto `3000`) y `HOST` (por defecto `0.0.0.0`).
Por ejemplo, desde `scripts/`: `PORT=3001 bun run server.js`. Cambiar estas
variables requiere iniciar un proceso nuevo; reiniciar el servidor termina sus
shells existentes.

La raiz del repositorio conserva solamente la configuracion de Compose y la
documentacion. Todo el codigo ejecutable vive dentro de `scripts/`, que se
monta como `/scripts` en el contenedor.

## API

La sesion raiz se usa cuando no se especifica `session`. Para controlar otra
ruta, se envia su valor codificado en la consulta:

```bash
curl 'http://localhost:3001/api/status?session=%2F1'
curl -X POST 'http://localhost:3001/api/take-control?session=%2F1'
curl -X POST 'http://localhost:3001/api/input?session=%2F1' \
  -H 'Content-Type: application/json' \
  -d '{"data":"echo hola\r"}'
```

La API debe tomar el control antes de enviar entrada. `/api/input` devuelve
`409` si un humano tiene el control o nadie lo ha tomado para la API. Cuando un
usuario recupera el control desde el navegador, la API deja de poder escribir.
Cada entrada admite hasta 65.536 caracteres y debe ser texto; el navegador
divide automáticamente los pegados grandes en mensajes de ese tamaño.

Solo el controlador puede escribir y redimensionar el PTY. Los demás clientes
siguen viendo la misma salida y pueden tomar el control con el botón existente.
Los mensajes WebSocket malformados se descartan, nunca se ejecutan como comandos.

## Verificación

```bash
bun test scripts/tests
```

Las pruebas inician un servidor en un puerto temporal y crean sus propios shells.
No utilizan las sesiones de la instancia en ejecución.

## Seguridad

BunTTY expone un shell sin autenticacion. El contenedor tambien monta
`/var/run/docker.sock`, por lo que debe ejecutarse solamente en una maquina y
red de confianza. No se debe publicar el puerto `3001` directamente en
Internet.

El control compartido coordina la escritura; no sustituye autenticación ni
permisos de acceso. Se rechazan peticiones de navegador con un origen de otro
host en la API y WebSocket, pero los clientes directos de API siguen siendo de
confianza. Un proxy debe conservar el host público de la petición.
