import bs58 from "bs58";

export type SolanaProvider = {
  publicKey?: { toBase58: () => string };
  connect?: () => Promise<unknown>;
  disconnect?: () => Promise<unknown>;
  signMessage?: (
    message: Uint8Array,
  ) => Promise<Uint8Array | { signature: Uint8Array }>;
};

const WALLET_STORAGE_KEY = "seeky_wallet";

function isBrowser() {
  return typeof window !== "undefined";
}

export function getSolanaProvider(): SolanaProvider | null {
  if (!isBrowser()) return null;

  const w = window as unknown as { solana?: unknown };
  const p = w.solana;

  if (!p || typeof p !== "object") return null;
  return p as SolanaProvider;
}

export function getConnectedWalletPubkey(): string | null {
  if (!isBrowser()) return null;

  const provider = getSolanaProvider();
  const pk = provider?.publicKey?.toBase58?.();

  if (pk && pk.length > 20) {
    localStorage.setItem(WALLET_STORAGE_KEY, pk);
    return pk;
  }

  const stored = localStorage.getItem(WALLET_STORAGE_KEY);
  return stored && stored.length > 20 ? stored : null;
}

export async function ensureWalletConnected(): Promise<SolanaProvider | null> {
  const provider = getSolanaProvider();
  if (!provider) return null;

  const alreadyConnected = provider.publicKey?.toBase58?.();
  if (!alreadyConnected && provider.connect) {
    await provider.connect().catch(() => null);
  }

  const pk = provider.publicKey?.toBase58?.();
  if (pk && pk.length > 20) {
    localStorage.setItem(WALLET_STORAGE_KEY, pk);
  }

  return provider;
}

export async function connectWallet(): Promise<string | null> {
  const provider = await ensureWalletConnected();
  const pk = provider?.publicKey?.toBase58?.() || null;

  if (pk && isBrowser()) {
    localStorage.setItem(WALLET_STORAGE_KEY, pk);
    window.dispatchEvent(new Event("seeky:wallet"));
  }

  return pk;
}

export async function disconnectWallet(): Promise<void> {
  const provider = getSolanaProvider();

  try {
    await provider?.disconnect?.();
  } catch {
    // ignore
  }

  if (isBrowser()) {
    localStorage.removeItem(WALLET_STORAGE_KEY);
    window.dispatchEvent(new Event("seeky:wallet"));
  }
}

export async function signTextMessage(text: string): Promise<string | null> {
  const provider = await ensureWalletConnected();
  if (!provider?.signMessage) return null;

  const msgBytes = new TextEncoder().encode(text);
  const raw = await provider.signMessage(msgBytes).catch(() => null);
  if (!raw) return null;

  const sigBytes =
    raw instanceof Uint8Array
      ? raw
      : raw &&
          typeof raw === "object" &&
          "signature" in raw &&
          raw.signature instanceof Uint8Array
        ? raw.signature
        : null;

  if (!sigBytes) return null;

  return bs58.encode(sigBytes);
}
