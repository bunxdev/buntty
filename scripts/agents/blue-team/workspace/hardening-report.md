# Blue Team — Hardening BunTTY v5.3

Fecha: 2026-11-11 · Alcance: headers/CSP, rate limiting, logging, validación,
sesiones, configuración de despliegue.

## Cambios (un commit cada uno)

| # | Severidad | Área | Cambio |
|---|-----------|------|--------|
| 1 | ALTA | Despliegue | `docker-compose.yml` publicaba kali con `BT_FRAME_ANCESTORS=* ...`: cualquier web podía enmarcar el shell root (clickjacking). Se quita `*`; override con `BT_KALI_FRAME_ANCESTORS`. El informe del red team lo daba por seguro; no lo era. |
| 2 | MEDIA | CSP | `script-src` permitía todo `cdn.jsdelivr.net` (cualquier paquete npm). Ahora solo `npm/@xterm/` y `npm/asciinema-player@3.7.1/`. |
| 3 | MEDIA | Config | Arranque rechazado si `BT_VIEW_TOKEN == BT_TOKEN` (el rol "view" recibía shell completo). Avisos para tokens < 16 caracteres y para `BT_VIEW_TOKEN` sin `BT_TOKEN`. |
| 4 | BAJA | Logging | Nuevos eventos `auth_login`, `forbidden_role`; `auth_rate_limited` se registra una vez por IP y ventana (antes, cada petición: inundación de logs). `GET /logout` borra la cookie. |
| 5 | MEDIA | DoS / sesiones | Límite de WebSockets (`BT_MAX_CLIENTS`=200, `BT_MAX_CLIENTS_PER_IP`=30); cierre de clientes que no leen (16 MB de backpressure); caducidad opcional de shells inactivos (`BT_SESSION_IDLE_MINUTES`). |

## Verificado

- Login por `?token=` → 302 + cookie; `/logout` → `Max-Age=0`.
- Token de lectura: `/api/input` y `/api/recording` → 403 (logueado como `forbidden_role`).
- 25 fallos de auth → 429 con una sola línea `auth_rate_limited`.
- WS con `Origin` ajeno → rechazado; 4.º socket desde la misma IP con límite 3 → `1013`.
- Sesión sin clientes ni salida → destruida por el reaper.
- Regresión: input por WS y API, `/api/screen`, index y estáticos funcionan.

## Riesgos residuales (no corregidos)

- **docker.sock montado** en ambos contenedores = root en el host. Quitarlo si los agentes no usan Docker.
- **Token en la URL del grid**: `/grid?token=` no se limpia de la barra de direcciones porque los iframes de kali (otro puerto, otra cookie) lo necesitan.
- **`frame-src 'self' http: https:`** es amplio; solo necesita `:3001` para kali.
- **Sin TLS por defecto**: la cookie no lleva `Secure` y el token viaja en claro si se expone en la LAN.
- **Despliegue actual**: el host donde se hizo esta revisión corre con `BT_TOKEN` vacío y `BT_FRAME_ANCESTORS=*`; recrear los contenedores con el compose corregido.
