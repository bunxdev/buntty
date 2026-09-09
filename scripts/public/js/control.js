import { send } from "./connection.js";

export const takeControl = (myId, cid) => send({ type: cid === myId ? "release_control" : "take_control" });
export function sendInput(data) {
  // Large pastes use bounded messages without splitting a surrogate pair.
  for (let start = 0; start < data.length;) {
    let end = Math.min(start + 65_536, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && last >= 0xD800 && last <= 0xDBFF) end--;
    if (!send({ type: "input", data: data.slice(start, end) })) return;
    start = end;
  }
}
export const sendResize = (c, r) => send({ type: "resize", cols: c, rows: r });
