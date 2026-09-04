# BunTTY 0.0.1

Terminal web colaborativa basada en Bun. Cada ruta mantiene un shell y un
historial independientes mientras el servidor permanece activo:

- `http://localhost:3000/`
- `http://localhost:3000/1`
- `http://localhost:3000/2`

Al recargar una ruta, BunTTY reconecta al mismo proceso y reconstruye el
contenido del terminal.

## Docker

El entorno de contenedor esta preparado para integrarse con Micro. Incluye
Debian, acceso al socket de Docker, la interfaz TUN y las capacidades de red
usadas por Micro.
Bun y las dependencias se instalan durante el primer arranque.

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

## Seguridad

BunTTY expone un shell sin autenticacion. El contenedor tambien monta
`/var/run/docker.sock`, por lo que debe ejecutarse solamente en una maquina y
red de confianza. No se debe publicar el puerto `3000` directamente en
Internet.
