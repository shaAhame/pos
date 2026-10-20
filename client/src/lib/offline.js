// Offline sales queue.
// When the internet (or the database) is down, the till still sells: the sale is saved in
// this browser and sent to the server later. Each sale carries a clientRef so sending it
// twice can never record it twice.
import { load, save } from "./storage";

const KEY = "pos.offlineQueue";
const FAILED_KEY = "pos.offlineFailed";
const listeners = new Set();

export const getQueue = () => load(KEY, []);
export const getFailed = () => load(FAILED_KEY, []);
const setQueue = (q) => { save(KEY, q); listeners.forEach((fn) => fn()); };
const setFailed = (q) => { save(FAILED_KEY, q); listeners.forEach((fn) => fn()); };
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const enqueue = (entry) => {
  // entry: { clientRef, userId, payload, receipt, queuedAt }
  const q = getQueue();
  if (!q.some((e) => e.clientRef === entry.clientRef)) q.push(entry);
  if (!save(KEY, q)) throw new Error("This browser's storage is full. The sale could not be saved offline.");
  listeners.forEach((fn) => fn());
};

export const pendingFor = (userId) => getQueue().filter((e) => e.userId === userId);

let syncing = false;
// post(payload) must return a promise; it should reject with the axios error.
// Returns { sent, failed, stoppedBecause }.
export const syncQueue = async ({ userId, post, isConnectionError }) => {
  if (syncing) return { sent: 0, failed: 0, stoppedBecause: "busy" };
  syncing = true;
  let sent = 0, failed = 0, stoppedBecause = null;
  try {
    for (const entry of pendingFor(userId)) {
      try {
        await post(entry.payload);
        sent++;
        setQueue(getQueue().filter((e) => e.clientRef !== entry.clientRef));
      } catch (err) {
        if (isConnectionError(err)) { stoppedBecause = "offline"; break; }
        if (err.response?.status === 401) { stoppedBecause = "login"; break; }
        // The server refused it outright: keep it for a manager to look at, don't retry forever.
        failed++;
        setQueue(getQueue().filter((e) => e.clientRef !== entry.clientRef));
        setFailed([...getFailed(), { ...entry, error: err.response?.data?.message || "Rejected", failedAt: new Date().toISOString() }]);
      }
    }
  } finally {
    syncing = false;
  }
  return { sent, failed, stoppedBecause };
};

export const dismissFailed = (clientRef) => setFailed(getFailed().filter((e) => e.clientRef !== clientRef));
