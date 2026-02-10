/**
 * Identity storage — Ed25519 keypair in IndexedDB.
 *
 * Stores raw 32-byte seed + 32-byte pubkey in IndexedDB.
 * Caches pubkey hex in localStorage for synchronous access.
 */

const DB_NAME = "dupenet";
const STORE_NAME = "identity";
const KEY = "default";
const LS_PUBKEY = "dupenet_pubkey";

interface StoredIdentity {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyHex: string;
  createdAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadIdentity(): Promise<StoredIdentity | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveIdentity(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  publicKeyHex: string,
): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const value: StoredIdentity = {
      privateKey,
      publicKey,
      publicKeyHex,
      createdAt: Date.now(),
    };
    const req = store.put(value, KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  // Cache pubkey hex for synchronous access
  try {
    localStorage.setItem(LS_PUBKEY, publicKeyHex);
  } catch {
    /* localStorage may be unavailable */
  }
}

export async function deleteIdentity(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(LS_PUBKEY);
  } catch {
    /* ignore */
  }
}

/** Quick synchronous check — returns cached pubkey hex or null. */
export function getCachedPubkey(): string | null {
  try {
    return localStorage.getItem(LS_PUBKEY);
  } catch {
    return null;
  }
}
