"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DB_VERSION, emptyDb, reviveDb, type Db } from "../lib/db";

/**
 * Holds the app's data in the browser and keeps it in localStorage.
 *
 * `ready` exists because localStorage isn't there during server rendering:
 * the first paint has to be a skeleton, or React hydrates against markup built
 * from data the server couldn't see. Screens render nothing meaningful until
 * it flips true, which takes one tick.
 *
 * Writes are saved synchronously on every change. The data is a few kilobytes
 * of text, so there's nothing to gain by batching it, and a debounce would
 * mean a tab closed at the wrong moment loses the last expense entered.
 */

const STORAGE_KEY = `tabby.db.v${DB_VERSION}`;

interface StoreValue {
  db: Db;
  ready: boolean;
  /** Whether this browser can actually keep the data. */
  persistent: boolean;
  /** Apply a transition. Returns whatever the reducer reported. */
  update: <T extends { db: Db }>(fn: (db: Db) => T) => Omit<T, "db">;
  reset: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Db>(emptyDb);
  const [ready, setReady] = useState(false);
  const [persistent, setPersistent] = useState(true);

  // A ref alongside the state so an update that runs twice in one tick reads
  // the value the previous one wrote, rather than a stale render's copy.
  const latest = useRef(db);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const revived = stored ? reviveDb(JSON.parse(stored)) : emptyDb();
      latest.current = revived;
      setDb(revived);
    } catch {
      // Private browsing, blocked site data, or corrupt JSON. The app still
      // works for this session; it just won't be there tomorrow, and the
      // banner says so rather than letting someone lose an evening's receipts.
      setPersistent(false);
    } finally {
      setReady(true);
    }
  }, []);

  const persist = useCallback((next: Db) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      setPersistent(false);
    }
  }, []);

  const update = useCallback<StoreValue["update"]>(
    (fn) => {
      const result = fn(latest.current);
      const { db: nextDb, ...rest } = result;
      latest.current = nextDb;
      setDb(nextDb);
      persist(nextDb);
      return rest;
    },
    [persist],
  );

  const reset = useCallback(() => {
    const fresh = emptyDb();
    latest.current = fresh;
    setDb(fresh);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      setPersistent(false);
    }
  }, []);

  const value = useMemo<StoreValue>(
    () => ({ db, ready, persistent, update, reset }),
    [db, ready, persistent, update, reset],
  );

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) {
    throw new Error("useStore must be used inside <StoreProvider>.");
  }
  return value;
}

/** A neutral placeholder for the tick before stored data is available. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="card text-center text-sm text-ink/45" role="status">
      {label}
    </div>
  );
}
