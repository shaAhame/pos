import { beforeEach, describe, expect, test } from "vitest";
import { enqueue, getQueue, getFailed, pendingFor, syncQueue } from "../lib/offline";

const entry = (ref, userId = "u1") => ({ clientRef: ref, userId, payload: { clientRef: ref }, receipt: { items: [] }, queuedAt: new Date().toISOString() });
const netErr = () => Object.assign(new Error("Network"), { response: undefined });
const httpErr = (status) => Object.assign(new Error("HTTP"), { response: { status, data: { message: "nope" } } });
const isConnectionError = (e) => !e.response || e.response.status === 503;

beforeEach(() => localStorage.clear());

describe("offline queue", () => {
  test("enqueue is idempotent per clientRef", () => {
    enqueue(entry("a")); enqueue(entry("a")); enqueue(entry("b"));
    expect(getQueue().map((e) => e.clientRef)).toEqual(["a", "b"]);
  });

  test("sync uploads in order and removes sent sales", async () => {
    enqueue(entry("a")); enqueue(entry("b"));
    const sent = [];
    const r = await syncQueue({ userId: "u1", post: async (p) => { sent.push(p.clientRef); }, isConnectionError });
    expect(sent).toEqual(["a", "b"]);
    expect(r.sent).toBe(2);
    expect(getQueue()).toEqual([]);
  });

  test("stops and keeps everything when still offline", async () => {
    enqueue(entry("a")); enqueue(entry("b"));
    const r = await syncQueue({ userId: "u1", post: async () => { throw netErr(); }, isConnectionError });
    expect(r.stoppedBecause).toBe("offline");
    expect(getQueue().length).toBe(2);
  });

  test("a server 503 (database down) is treated as offline, not as a rejection", async () => {
    enqueue(entry("a"));
    await syncQueue({ userId: "u1", post: async () => { throw httpErr(503); }, isConnectionError });
    expect(getQueue().length).toBe(1);
    expect(getFailed().length).toBe(0);
  });

  test("expired login stops sync without losing sales", async () => {
    enqueue(entry("a"));
    const r = await syncQueue({ userId: "u1", post: async () => { throw httpErr(401); }, isConnectionError });
    expect(r.stoppedBecause).toBe("login");
    expect(getQueue().length).toBe(1);
  });

  test("a sale the server refuses moves to the failed list instead of retrying forever", async () => {
    enqueue(entry("a")); enqueue(entry("b"));
    let n = 0;
    const r = await syncQueue({ userId: "u1", post: async () => { if (n++ === 0) throw httpErr(400); }, isConnectionError });
    expect(r).toMatchObject({ sent: 1, failed: 1 });
    expect(getQueue()).toEqual([]);
    expect(getFailed()[0].clientRef).toBe("a");
  });

  test("only the logged-in cashier's sales are uploaded under their login", async () => {
    enqueue(entry("a", "u1")); enqueue(entry("b", "u2"));
    const sent = [];
    await syncQueue({ userId: "u2", post: async (p) => { sent.push(p.clientRef); }, isConnectionError });
    expect(sent).toEqual(["b"]);
    expect(pendingFor("u1").length).toBe(1);
  });
});
