import { send } from "./connection.js";

export const takeControl = (myId, cid) => send({ type: cid === myId ? "release_control" : "take_control" });
export const sendInput = (d) => send({ type: "input", data: d });
export const sendResize = (c, r) => send({ type: "resize", cols: c, rows: r });
