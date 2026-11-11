# Purple Team — Informe consolidado BunTTY v5.3

Fecha: 2026-11-11 · Método: revisión de código + ataques reproducidos contra una
instancia de prueba (`PORT=3999`, con `BT_TOKEN`/`BT_VIEW_TOKEN`).

## 1. Validación de hallazgos Red → controles Blue

| # | Hallazgo (origen) | Control | Validado | Estado |
|---|---|---|---|---|
| R1 | CSP `sandbox` de `/api/files` pisada por `sec()` (Red) | `sec()` respeta cabeceras de la ruta (fa07c4b) | Sí | Cerrado |
| R2 | `BT_FRAME_ANCESTORS=*` (Red: "el compose es seguro") | Aviso al arrancar (fa07c4b) + `*` quitado del compose (3b11191) | **No era seguro**: el compose de kali tenía `*` hasta 3b11191 | Cerrado en repo, **abierto en el contenedor en ejecución** (ver §3) |
| P1 | CSP permitía todo `cdn.jsdelivr.net` (cualquier paquete npm = script válido) | CSP limitada a `@xterm/` y `asciinema-player@3.7.1/` (297201c) | Sí, cabecera verificada | Cerrado |
| P2 | `BT_VIEW_TOKEN == BT_TOKEN` daba shell completo a "solo lectura" | Arranque falla en ese caso + aviso de tokens < 16 chars (789b0e3) | Sí | Cerrado |
| P3 | `/public/*` se sirve **sin auth** y seguía symlinks: `public/x -> /root/.claude/.credentials.json` legible sin token | `realpath` + confinamiento a `public/` + solo ficheros regulares (f0ac399) | Sí: symlink a fichero/dir → 404; css/js/html → 200 | Cerrado |

Defensas re-verificadas que aguantan: path traversal (session/`file=`), CSRF/CSWSH
(Origin + `application/json` + `SameSite=Strict`), roles view/full, DNS rebinding sin
token, open redirect del strip de `?token=`, inyección JSON/JS en `tools/`.

## 2. Riesgo residual (no corregido, requiere decisión)

| Prioridad | Gap | Prueba | Por qué no se tocó / recomendación |
|---|---|---|---|
| **Alta** | `BT_TOKEN` se hereda en el entorno de **todos** los shells (`env: {...process.env}`). Cualquier `env`/`printenv` lo imprime, y los usuarios con `BT_VIEW_TOKEN` ven esa salida → escalada view → full. | `env \| grep BT_TOKEN` en un shell de kali: presente. | `ai.sh`/`bt-send` lo usan. Recomendación: quitar `BT_TOKEN`/`BT_VIEW_TOKEN` del env del PTY y dar a los agentes un token aparte (p. ej. `BT_AGENT_TOKEN`) o un socket local. |
| Media | Bloqueo por rate-limit afecta también al token válido: 20 fallos desde una IP → 429 para **todos** durante 5 min, repetible. Tras NAT de Docker todos comparten IP → cualquiera en la LAN deja fuera al operador. | 20× token erróneo, luego token válido → `429`. | Dejar pasar tokens válidos anula el freno a fuerza bruta. Con tokens de 32+ chars (ya avisado al arrancar) la fuerza bruta es inviable, así que se puede priorizar disponibilidad; decisión del dueño. |
| Media | Docker Desktop: todo llega desde la IP del gateway (privada) → con `BT_BIND=0.0.0.0` y sin token, el filtro de IP no protege. | Documentado en README. | Recomendación: que `main.sh` se niegue a arrancar sin `BT_TOKEN` cuando exista `/.dockerenv` y no sea `127.0.0.1`, o generar token aleatorio. |
| Baja | `/grid?token=` no pasa por el strip a cookie: el token queda en la barra/historial y se copia en cada iframe. | Revisión de `server.js` (ruta `/grid` antes del redirect). | Pasar el token solo a los iframes de `:3001` (los de `:3000` ya tienen cookie). |
| Baja | Sin cuota de disco para subidas (`/tmp/buntty-uploads`). | Revisión. | Un usuario full ya tiene shell; impacto bajo. |
| Info | `docker.sock` y `~/.claude` montados en ambos contenedores = root en el host + credenciales de Claude accesibles desde cualquier shell. | Documentado. | Quitar `docker.sock` si los agentes no lo necesitan. |

## 3. Acción operativa inmediata

El contenedor `kali` en ejecución sigue con
`BT_FRAME_ANCESTORS=* http://localhost:3000 ...` (verificado en su entorno). El fix
3b11191 solo aplica al recrearlo:

```bash
docker compose up -d --force-recreate kali
```

## 4. Nota de proceso

El informe de Red (`red-team/workspace/pentest-report.md`) afirmaba que el
`docker-compose.yml` era seguro respecto a `frame-ancestors`; no lo era. Validar
cada "verificado" contra el fichero real, no contra el README.

Bug funcional (no de seguridad) en `tools/gh-auth-lupa`: `2>&1 > "$OUT"` manda stderr
(donde `gh` imprime el código) a la terminal, no al fichero; debería ser `> "$OUT" 2>&1`.
