// App-wide session: logged-in user, shop settings, current shift, connection + offline sync.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { api, getToken, setToken, onUnauthorized, isConnectionError, getLocationId, setLocationId } from "./api";
import { load, save } from "./storage";
import * as offline from "./offline";

const SessionCtx = createContext(null);
export const useSession = () => useContext(SessionCtx);

const RANK = { cashier: 1, manager: 2, owner: 3 };
const DEFAULT_SETTINGS = { shopName: "Shop", currency: "Rs.", timezone: "Asia/Colombo", maxCashierDiscount: 10, defaultTaxRate: 0, receiptFooter: "" };

export function SessionProvider({ children }) {
  const [user, setUser] = useState(() => (getToken() ? load("pos.user", null) : null));
  const [settings, setSettings] = useState(() => load("pos.settings", DEFAULT_SETTINGS));
  const [shift, setShiftState] = useState(() => load("pos.shift", null));
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [locations, setLocations] = useState(() => load("pos.locations", []));
  const [ownerLocationId, setOwnerLocationIdState] = useState(getLocationId);
  const userRef = useRef(user);
  userRef.current = user;

  const setShift = useCallback((s) => { setShiftState(s); save("pos.shift", s); }, []);

  const refreshQueue = useCallback(() => {
    const u = userRef.current;
    setQueueCount(u ? offline.pendingFor(u._id).length : 0);
    setFailedCount(offline.getFailed().length);
  }, []);

  const logout = useCallback((message) => {
    setToken(null);
    setLocationId(null);
    setOwnerLocationIdState(null);
    setUser(null);
    save("pos.user", null);
    setShift(null);
    if (message) toast.info(message);
  }, [setShift]);

  useEffect(() => onUnauthorized((msg) => logout(msg || "Please log in again.")), [logout]);
  useEffect(() => offline.subscribe(refreshQueue), [refreshQueue]);
  useEffect(() => { refreshQueue(); }, [user, refreshQueue]);

  const refreshSettings = useCallback(async () => {
    const { data } = await api.get("/settings");
    setSettings(data);
    save("pos.settings", data);
    return data;
  }, []);

  const refreshLocations = useCallback(async () => {
    const { data } = await api.get("/locations");
    setLocations(data);
    save("pos.locations", data);
    return data;
  }, []);

  const chooseLocation = useCallback((id) => {
    setLocationId(id || null);
    setOwnerLocationIdState(id || null);
  }, []);

  // Re-read the user (and the business's features) from the server.
  const refreshMe = useCallback(async () => {
    const { data } = await api.get("/auth/me");
    setUser(data); save("pos.user", data);
    return data;
  }, []);

  const refreshShift = useCallback(async () => {
    const { data } = await api.get("/shifts/current");
    setShift(data);
    return data;
  }, [setShift]);

  // On start: confirm the saved login is still valid.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) { setReady(true); return; }
      try {
        const { data } = await api.get("/auth/me");
        if (cancelled) return;
        setUser(data); save("pos.user", data);
        await Promise.all([refreshSettings(), refreshShift(), refreshLocations()]).catch(() => {});
        setOnline(true);
      } catch (err) {
        if (isConnectionError(err)) setOnline(false); // keep the cached user; work offline
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshSettings, refreshShift, refreshLocations]);

  const signIn = useCallback(async (token, u) => {
    setToken(token);
    setUser(u); save("pos.user", u);
    setOnline(true);
    if (u.role !== "owner") { setLocationId(null); setOwnerLocationIdState(null); }
    await Promise.all([refreshSettings(), refreshShift(), refreshLocations()]).catch(() => {});
  }, [refreshSettings, refreshShift, refreshLocations]);

  // Background sync: every 20 s, when the browser comes back online, and on demand.
  const sync = useCallback(async ({ quiet = true } = {}) => {
    const u = userRef.current;
    if (!u || !getToken()) return;
    try {
      await api.get("/health", { timeout: 5000 });
      setOnline(true);
    } catch {
      setOnline(false);
      return;
    }
    if (!offline.pendingFor(u._id).length) return;
    const r = await offline.syncQueue({
      userId: u._id,
      post: (payload) => api.post("/sales", payload),
      isConnectionError,
    });
    if (r.sent) toast.success(`${r.sent} offline sale${r.sent > 1 ? "s" : ""} uploaded`);
    if (r.failed) toast.error(`${r.failed} offline sale${r.failed > 1 ? "s were" : " was"} refused by the server. A manager should check Sales → Offline problems.`);
    if (r.stoppedBecause === "offline") setOnline(false);
    if (!quiet && !r.sent && !r.failed && r.stoppedBecause) toast.info("Still offline. Will keep trying.");
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    sync();
    const t = setInterval(sync, 20000);
    const on = () => sync();
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [user, sync]);

  const can = useCallback((role) => !!user && RANK[user.role] >= RANK[role], [user]);
  // Is a feature switched on for this business (set by MacQuad per client)?
  const has = useCallback((feature) => !!user?.business?.features?.[feature], [user]);

  // The branch this screen is about: staff -> their own; owner -> their choice (null = all branches).
  const activeLocations = useMemo(() => locations.filter((l) => l.active), [locations]);
  const multiBranch = activeLocations.length > 1;
  const locationId = !user ? null : user.role === "owner"
    ? (activeLocations.some((l) => l._id === ownerLocationId) ? ownerLocationId : (multiBranch ? null : activeLocations[0]?._id || null))
    : user.locationId;
  const location = locations.find((l) => l._id === locationId) || null;
  useEffect(() => {
    // Forget a choice that points at a branch that no longer exists.
    if (user?.role === "owner" && ownerLocationId && locations.length && !activeLocations.some((l) => l._id === ownerLocationId)) chooseLocation(null);
  }, [user, ownerLocationId, locations.length, activeLocations, chooseLocation]);

  const value = useMemo(() => ({
    user, settings, shift, ready, online, queueCount, failedCount,
    locations, activeLocations, multiBranch, location, locationId,
    signIn, logout, can, has, setShift, setOnline, refreshShift, refreshSettings, refreshLocations, chooseLocation, sync, refreshMe,
  }), [has, refreshMe, user, settings, shift, ready, online, queueCount, failedCount, locations, activeLocations, multiBranch, location, locationId,
    signIn, logout, can, setShift, refreshShift, refreshSettings, refreshLocations, chooseLocation, sync]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
