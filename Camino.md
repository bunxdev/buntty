# Camino

BunTTY ha evolucionado desde una terminal web colaborativa hacia una
implementacion compacta y modular. El servidor, la gestion de sesiones, los
clientes, la API y la interfaz web se separaron por responsabilidad, y el
codigo ejecutable se concentro bajo `scripts/`.

Cada ruta identifica una sesion independiente con su propio proceso de shell.
La sesion permanece activa aunque se desconecten todos los clientes, conserva
un historial acotado en memoria y lo reenvia al reconectar para reconstruir el
terminal. El proceso y su historial terminan cuando finaliza la sesion o se
reinicia el servicio.

Los clientes conectados comparten la salida, pero solo quien tiene el control
puede enviar entrada interactiva. El control puede tomarse, soltarse o pasar a
otro cliente; la API tambien puede asignarlo a la IA y enviar entrada al shell.
La API expone estado, toma de control y entrada, seleccionando la sesion por su
identificador de ruta.

La integracion con Micro aporta el entorno de sistema y las funciones de red
que necesita el flujo previsto. El modo de red del host, el socket del motor de
contenedores, la capacidad `NET_ADMIN`, el dispositivo TUN, el nombre fijo del
contenedor y el bootstrap actual son decisiones deliberadas y forman parte de
la configuracion operativa.
