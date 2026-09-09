# Laboratorio de comparación

Rama: `testing`. Los servicios de este archivo Compose son independientes del
servicio `dev` de BunTTY. No montan el repositorio ni el socket Docker.

| Aplicación | Acceso | Versión probada |
| --- | --- | --- |
| BunTTY existente | http://localhost:3001/ | código base `24bf5f8`, Bun 1.4.2 |
| WeTTY | http://localhost:3002/ | 3.0.0, imagen oficial fijada por digest |
| ttyd | http://localhost:3003/ | 1.7.7-2922cb8, imagen oficial fijada por digest |
| tmate | comando de abajo | paquete Debian 2.4.0-2 |

Los puertos del laboratorio se publican en loopback. Si accedes mediante
Codespaces, reenvía los puertos 3002 y 3003 desde la pestaña Puertos.
WeTTY ejecuta `/bin/sh` local para comparar el terminal sin necesitar otro
servidor SSH. ttyd permite escritura y comprueba el origen WebSocket.

Desde la raíz del repositorio:

```sh
docker compose -f testing/compose.yml up -d --build
docker compose -f testing/compose.yml ps
docker compose -f testing/compose.yml logs --tail 20
npm ci --prefix testing --ignore-scripts --no-audit --no-fund
# Ejecutar cuando los registros indiquen que ambos servidores están escuchando.
node testing/probe.mjs
```

El script requiere Node 22 o posterior y acceso a Docker y localhost. Crea rutas
temporales `/comparison-...` en BunTTY y termina sus shells al finalizar. No
escribe en la sesión `/`. `BUNTTY_URL` permite cambiar la URL de BunTTY.
`results.json` se reemplaza en cada ejecución; un error deja salida distinta de
cero y el detalle en ese archivo. Es una prueba de caracterización: también
registra defectos observados, por lo que terminar correctamente no significa
que BunTTY esté libre de fallos.

Para entrar en tmate desde una terminal interactiva:

```sh
docker exec -it -e TERM=xterm-256color buntty-testing-tmate \
  tmate -S /tmp/tmate.sock attach-session -t comparison
```

Abre el mismo comando en otra terminal para compartir la sesión. Desconecta con
`Ctrl+b`, seguido de `d`; crea otra ventana con `Ctrl+b`, seguido de `c`.
Si aparece el panel inicial de avisos de conexión, pulsa `q` para volver al shell.
El contenedor tmate no tiene red: se prueban sesiones locales, ventanas y dos
clientes, pero no el relay público ni los enlaces SSH/web. El contenedor no
publica un servidor web propio.

Para detener únicamente este laboratorio:

```sh
docker compose -f testing/compose.yml down
```

Consulta [COMPARISON.md](COMPARISON.md) para los resultados y las prioridades.

## Prueba de navegador de BunTTY

`browser-smoke.mjs` inicia su propio servidor temporal y comprueba scrollback,
reconexión sin duplicados, control entre pestañas y nombres tratados como texto.
Requiere Bun y Playwright con Chromium instalado. Puedes instalar las herramientas
fuera del repositorio:

```sh
npm install --prefix /tmp/buntty-browser playwright
/tmp/buntty-browser/node_modules/.bin/playwright install --with-deps chromium
PLAYWRIGHT_MODULE=file:///tmp/buntty-browser/node_modules/playwright/index.mjs \
  BUN_BINARY=bun node testing/browser-smoke.mjs
```

El informe y `results.json` conservan la medición original. El script de
comparación `probe.mjs` comprueba ahora los permisos corregidos y necesita que
la instancia de BunTTY haya arrancado con el código actualizado.

## Límite real del scrollback

Con las mismas herramientas de navegador:

```sh
PLAYWRIGHT_MODULE=file:///tmp/buntty-browser/node_modules/playwright/index.mjs \
  BUN_BINARY=bun node testing/scrollback-limit.mjs
```

Para probar una instancia ya arrancada, añade `BUNTTY_URL=http://localhost:3001`.
En ese modo no se inicia otro servidor: se crea una ruta temporal independiente
en la instancia indicada y se cierra su shell al terminar.

Esta prueba genera salida numerada en un shell temporal real y verifica todas
las líneas, su continuidad y los extremos del scroll mediante la rueda del
ratón en Chromium. Usa una ventana de 1920 × 900, sin modificar la instancia
del usuario. Guarda resultados y capturas en `scrollback-results/`.

Resultados del 8 de septiembre de 2026:

- 50.000 líneas cortas: conservadas íntegramente.
- Capacidad: 50.000 filas de historial más 54 filas de pantalla; estas últimas
  dependen del tamaño de ventana y fuente. Una fila queda vacía tras el salto
  de línea final.
- 60.000 líneas emitidas: permanecen las líneas 9.948 a 60.000, sin huecos ni
  duplicados. La rueda alcanza ambos extremos y la línea 9.948 aparece en pantalla.
- Recargar con líneas cortas conserva ese mismo intervalo.
- 50.000 líneas de 158 caracteres: conservadas durante la conexión. Tras recargar
  se recuperan las 50.000: 158 caracteres más CRLF por línea ocupan exactamente
  los ocho millones de caracteres que ahora conserva el servidor.

Las 50.000 son filas desplazables del emulador, no líneas visibles simultáneamente
ni una garantía de retención tras recargar. Las líneas que se ajustan al ancho
de la pantalla pueden ocupar varias filas. Los tiempos guardados describen una
ejecución local, no un benchmark comparativo.

## Carga de 80 millones de caracteres

```sh
PLAYWRIGHT_MODULE=file:///tmp/buntty-browser/node_modules/playwright/index.mjs \
  BUN_BINARY=bun node testing/stress-80m.mjs
```

Inicia una instancia temporal con `BUNTTY_HISTORY_CHARS=80000000`, genera
500.000 líneas y verifica el contenido completo del mensaje de recuperación,
no solo las filas visibles. Registra desconexiones, tiempos y el máximo de RSS
muestreado del servidor en `stress-80m-results.json`. Elimina los logs de prueba
al finalizar y no modifica el límite de la instancia activa.
