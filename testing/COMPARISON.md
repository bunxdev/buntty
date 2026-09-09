# BunTTY frente a WeTTY, ttyd y tmate

> Comparación histórica previa al refuerzo de BunTTY. Los resultados guardados
> describen aquella ejecución. El código posterior de `testing` corrige la
> escritura por API sin control, el resize de espectadores y añade reconexión
> automática, validación de mensajes, nombres como texto y decodificación UTF-8
> incremental. `probe.mjs` ya exige el comportamiento corregido; las regresiones
> del servidor se ejecutan con `bun test scripts/tests`.

Evaluación realizada el 8 de septiembre de 2026. Evidencia ejecutable:
[probe.mjs](probe.mjs); resultados completos: [results.json](results.json).
Configuración: [compose.yml](compose.yml).

## Conclusión

BunTTY ya ofrece una combinación útil: colaboración desde el navegador, una
sesión por ruta, recuperación del historial al recargar y una API sencilla para
integraciones. En la configuración probada, WeTTY y ttyd abren shells separados
por cliente y los reemplazan al reconectar. BunTTY conserva el mismo shell.

Eso no demuestra que BunTTY sea mejor en general. Para superar estas opciones
como terminal colaborativa debe convertir el control visual en permisos reales,
mejorar la recuperación y soportar usuarios lentos y sesiones largas sin degradar
el servicio. tmate ya aporta ventanas y colaboración entre clientes locales.

## Lo comprobado ejecutando las aplicaciones

| Prueba | BunTTY :3001 | WeTTY :3002 | ttyd :3003 | tmate |
| --- | --- | --- | --- | --- |
| HTTP GET | 200 | 200 | 200 | No aplica al cliente local |
| Comandos en un PTY real | Sí | Sí | Sí | Sí |
| Redimensionado del PTY | Sí; incluso un espectador | Sí | Sí | No medido |
| Dos clientes comparten el shell | Sí, misma ruta | No por defecto | No por defecto | Sí, adjuntos al mismo socket |
| Estado después de desconectar | Conservado | Shell nuevo | Shell nuevo | Conservado en servidor local |
| Historial al reconectar | Recuperado | Sin sesión anterior | Sin sesión anterior | Captura de pantalla comprobada; replay no medido |
| Sesiones distintas | Variables separadas por ruta | Un shell por cliente | Un shell por cliente | Segunda ventana creada y eliminada |
| Traspaso explícito de control | Comprobado | No probado | No probado | No probado |

WeTTY y ttyd pueden ejecutar otros comandos o conectarse a un multiplexor;
el resultado anterior corresponde a `/bin/sh` sin tmux. Separar variables por
ruta en BunTTY no constituye aislamiento del sistema de archivos ni de permisos.

ttyd rechazó un WebSocket sin `Origin` con `-O`; el cliente corregido pasó las
pruebas manteniendo esa opción. tmate se probó sin red y con dos clientes locales
reales mediante PTY. Su colaboración remota SSH/web no fue validada.

## Qué falta en BunTTY, por prioridad

### P0: permisos que el servidor haga cumplir

Dos defectos fueron reproducidos en una sesión temporal:

1. Un segundo cliente no puede escribir por WebSocket mientras el primero tiene
   el control, pero `POST /api/input` sin identidad ni credencial sí escribe.
   La API elude el bloqueo aplicado al WebSocket.
2. Un espectador envía `resize` y cambia el PTY a 37 filas y 101 columnas. Puede
   modificar la presentación de la terminal que utiliza otra persona.

Además, el código permite que cualquier cliente tome el control y que la API
lo reclame como `AI`. No hay autenticación, autorización por sesión ni comprobación
de origen en el manejador de actualización WebSocket.

Implementar identidades y permisos de propietario, editor y lector; aplicar la
misma autorización a REST y WebSocket; permitir resize solo al controlador;
añadir tokens de sesión revocables y permisos específicos para integraciones.
La aceptación exige que un lector tampoco pueda escribir usando directamente
la API. Referencias: `scripts/modules/api.js`, `handlers.js` y `server.js`.

### P1: recuperación y gestión de sesiones

El shell persiste mientras vive el proceso servidor. Las sesiones y el historial
están en Maps de memoria; no hay recuperación implementada tras reiniciar BunTTY.
No se reinició el servicio del usuario para comprobarlo destructivamente.
El cliente muestra una pantalla de reconexión manual al perder el WebSocket.

Añadir reconexión automática con espera creciente, identificación estable del
cliente, listado y cierre de sesiones, expiración por inactividad y límites de
sesiones. Para sobrevivir a reinicios del servidor web, separar la vida del PTY
de ese proceso, por ejemplo con un supervisor o multiplexor. Guardar texto por
sí solo no conserva los procesos del shell.

### P1: carga y fidelidad del terminal

`session.js` concatena texto y recorta a dos millones de caracteres. El corte
puede dejar una secuencia de escape incompleta; no es una instantánea del estado
del emulador. La conversión independiente de cada bloque a texto merece pruebas
con caracteres UTF-8 fragmentados.

`clients.js` difunde a todos los clientes sin gestionar el resultado de `send`
ni una cola por cliente. Incorporar control de flujo, colas limitadas y una
estrategia para consumidores lentos; validar tipos y tamaños de mensajes antes
de escribir al PTY. Probar salida masiva, caracteres multibyte, aplicaciones de
pantalla completa y reconexiones a diferentes tamaños.

WeTTY incluye pausa/reanudación del PTY y confirmación del consumo mediante
eventos `commit`, verificado en el código de la imagen instalada. Es una
referencia concreta para mejorar el flujo de datos de BunTTY.

### P2: experiencia e integración

Incorporar búsqueda del scrollback, enlaces y portapapeles, preferencias de fuente,
atajos móviles y transferencia de archivos con permisos. Añadir ventanas o
paneles y enlaces de invitación con modo lectura. La UI debe distinguir ceder
el control a otro usuario de cederlo a una integración: actualmente muestra un
mensaje de cesión a IA incluso cuando el servidor elige otro cliente humano.

Para automatización, ampliar la API con eventos de salida, ciclo de vida de la
sesión y resultados estructurados. El endpoint actual confirma que aceptó la
entrada, no que el comando terminó correctamente.

### P2: despliegue reproducible y observabilidad

El proceso en uso responde en 3001, pero el código versionado sigue fijando 3000
y el README también lo documenta. Parametrizar `PORT`/`HOST` y reflejar la
configuración efectiva. Hay dos procesos Bun en `dev`, por lo que su memoria
total no sirve como medición aislada de BunTTY.

Construir una imagen con versiones fijadas, instalar dependencias al construir
en vez de cada arranque, permitir un usuario sin privilegios y hacer opcionales
los privilegios especiales del entorno. Añadir comprobaciones de salud, métricas
y eventos de auditoría de cambios de control sin registrar secretos del terminal.

## Qué ofrecen los otros proyectos según sus fuentes

- [WeTTY](https://github.com/butlerx/wetty): acceso mediante SSH/login, opciones
  TLS y configuración del destino. Es una referencia para acceso a shells
  autenticados. Sus funciones SSH y TLS no se probaron en este laboratorio.
- [ttyd](https://github.com/tsl0922/ttyd): autenticación básica o mediante proxy,
  TLS, comprobación de origen, límite de clientes, modo lectura, transferencia
  ZMODEM/trzsz y Sixel. Aquí se probaron PTY y origen, no todas esas funciones.
- [tmate](https://github.com/tmate-io/tmate): derivado de tmux para compartir
  terminales. La versión instalada ofrece tokens de lectura y opciones de
  servidor remoto. En esta evaluación solo se validó el uso local.

## Límites de la comparación

Se utilizaron imágenes oficiales de WeTTY y ttyd fijadas por digest, y el paquete
Debian de tmate; no se compilaron los HEAD actuales de los tres repositorios.
BunTTY se probó en la instancia existente del puerto 3001 y se revisó su código
base `24bf5f8`. No se modificó su implementación.

Una muestra de `docker stats` después de pruebas parciales dio aproximadamente
31.29 MiB para WeTTY, 1.40 MiB para ttyd y 2.26 MiB para tmate. No tenían idéntico
número de sesiones ni carga. Es una observación de esos contenedores, no una
comparación de rendimiento ni una prueba de superioridad. `dev` incluye más de
un servidor Bun; queda excluido de cualquier ranking de memoria.

No se midieron latencias comparables, concurrencia, accesibilidad, rendimiento
visual, móviles ni transferencia de archivos. Tampoco se verificó el relay
remoto de tmate. La siguiente evaluación debería usar la misma carga, un proceso
por servicio y pruebas de reconexión, salida masiva y clientes lentos antes de
afirmar que BunTTY es más rápido o más robusto.
