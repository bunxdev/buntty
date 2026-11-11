// External file so the page works under a CSP without 'unsafe-inline'.
const params = new URLSearchParams(location.search);
const token = params.get("token");
const withToken = (url) => token ? url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token) : url;
const session = params.get("session") || "/";
document.getElementById("sessionLabel").textContent = session;
const castUrl = withToken(`/api/recording?session=${encodeURIComponent(session)}`);
document.getElementById("downloadBtn").href = castUrl;
// Only same-origin session paths: blocks javascript:, //host and /\host (browsers treat "\" as "/").
document.getElementById("backBtn").href = withToken(/^\/[a-zA-Z0-9._\/-]*$/.test(session) && !session.startsWith("//") ? session : "/");

const container = document.getElementById("player-container");
const showEmpty = () => {
  container.innerHTML = '<div class="no-session" role="status">No hay grabación disponible para esta sesión.<br>Escribe algo en el terminal para generar una.<br><br>Uso: <code>/replay?session=/1</code></div>';
  document.getElementById("downloadBtn").hidden = true;
};
// Fetch first: AsciinemaPlayer loads URLs asynchronously, so a 400/404 would never reach a try/catch.
fetch(castUrl).then((res) => res.ok ? res.text() : Promise.reject(res.status)).then((data) => {
  if (!data.trim()) return showEmpty();
  container.replaceChildren();
  AsciinemaPlayer.create({ data }, container, {
    theme: "monokai", fit: "width", autoPlay: true, speed: 1, idleTimeLimit: 3, poster: "npt:0:01",
  });
}).catch(showEmpty);
