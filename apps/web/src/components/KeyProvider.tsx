"use client";

/**
 * Identity context — provides Ed25519 keypair state to all client components.
 * Loads from IndexedDB on mount. Provides generate/clear/sign primitives.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { generateKeypair, toHex } from "@/lib/crypto";
import { loadIdentity, saveIdentity, deleteIdentity } from "@/lib/keys";

interface IdentityState {
  publicKeyHex: string | null;
  loading: boolean;
  generate: () => Promise<void>;
  getPrivateKey: () => Promise<Uint8Array | null>;
  clear: () => Promise<void>;
}

const IdentityContext = createContext<IdentityState>({
  publicKeyHex: null,
  loading: true,
  generate: async () => {},
  getPrivateKey: async () => null,
  clear: async () => {},
});

export function useIdentity() {
  return useContext(IdentityContext);
}

export function KeyProvider({ children }: { children: ReactNode }) {
  const [publicKeyHex, setPublicKeyHex] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadIdentity().then((id) => {
      if (id) setPublicKeyHex(id.publicKeyHex);
      setLoading(false);
    });
  }, []);

  const generate = useCallback(async () => {
    const kp = await generateKeypair();
    const hex = toHex(kp.publicKey);
    await saveIdentity(kp.privateKey, kp.publicKey, hex);
    setPublicKeyHex(hex);
  }, []);

  const getPrivateKey = useCallback(async () => {
    const id = await loadIdentity();
    return id?.privateKey ?? null;
  }, []);

  const clear = useCallback(async () => {
    await deleteIdentity();
    setPublicKeyHex(null);
  }, []);

  return (
    <IdentityContext.Provider
      value={{ publicKeyHex, loading, generate, getPrivateKey, clear }}
    >
      {children}
    </IdentityContext.Provider>
  );
}

/** Inline identity display: shows short pubkey or "generate identity" button. */
export function IdentityChip() {
  const { publicKeyHex, loading, generate, clear } = useIdentity();

  if (loading) return <span className="t">...</span>;

  if (!publicKeyHex) {
    return (
      <button onClick={generate} className="link-btn">
        [generate identity]
      </button>
    );
  }

  const short = publicKeyHex.slice(0, 4) + ".." + publicKeyHex.slice(-4);
  return (
    <span>
      <span className="t" title={publicKeyHex}>
        {short}
      </span>{" "}
      <button onClick={clear} className="link-btn t" title="clear identity">
        x
      </button>
    </span>
  );
}
