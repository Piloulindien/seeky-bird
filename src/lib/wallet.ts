import bs58 from "bs58";

export type SolanaProvider = {
  publicKey?: { toBase58: () => string };
  connect?: () => Promise<unknown>;
  disconnect?: () => Promise<unknown>;
  signMessage?: (
    message: Uint8Array,
  ) => Promise<Uint8Array | { signature: Uint8Array }>;
};

type BridgeRequest =
  | {
      type: "SEEKY_MOBILE_BRIDGE_REQUEST";
      id: string;
      method: "signMessage";
      payload: { messageB64: string };
    }
  | {
      type: "SEEKY_MOBILE_BRIDGE_REQUEST";
      id: string;
      method: "connect";
      payload?: Record<string, never>;
    }
  | {
      type: "SEEKY_MOBILE_BRIDGE_REQUEST";
      id: string;
      method: "disconnect";
      payload?: Record<string, never>;
    };

type BridgeResponse = {
  type: "SEEKY_MOBILE_BRIDGE_RESPONSE";
  id: string;
  ok: boolean;
  result?: {
    wallet?: string;
    signatureB58?: string;
  };
  error?: string;
};

type SeekyWindow = Window & {
  solana?: unknown;
  __SEEKY_WALLET__?: string | null;
  __SEEKY_MOBILE__?: boolean;
  ReactNativeWebView?: {
    postMessage: (message: string) => void;
  };
  __seekyBridgeListenerInstalled__?: boolean;
};

const WALLET_STORAGE_KEY = "seeky_wallet";
const BRIDGE_TIMEOUT_MS = 20_000;

const pendingBridgeRequests = new Map<
  string,
  {
    resolve: (value: BridgeResponse) => void;
    reject: (reason?: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

function isBrowser() {
  return typeof window !== "undefined";
}

function getSeekyWindow(): SeekyWindow | null {
  if (!isBrowser()) return null;
  return window as SeekyWindow;
}

function isMobileWebViewBridgeAvailable(): boolean {
  const w = getSeekyWindow();
  return !!(
    w &&
    w.__SEEKY_MOBILE__ &&
    w.ReactNativeWebView &&
    typeof w.ReactNativeWebView.postMessage === "function"
  );
}

function getInjectedMobileWallet(): string | null {
  const w = getSeekyWindow();
  const wallet = String(w?.__SEEKY_WALLET__ || "").trim();
  return wallet && wallet.length > 20 ? wallet : null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(bin);
}

function makeBridgeId(): string {
  return `seeky_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function installBridgeListener() {
  const w = getSeekyWindow();
  if (!w || w.__seekyBridgeListenerInstalled__) return;

  const onMessage = (event: MessageEvent) => {
    let data: unknown = event.data;

    if (typeof data === "string") {
      try {
        data = JSON.parse(data) as unknown;
      } catch {
        return;
      }
    }

    if (!data || typeof data !== "object") return;

    const msg = data as Partial<BridgeResponse>;
    if (msg.type !== "SEEKY_MOBILE_BRIDGE_RESPONSE") return;
    if (!msg.id || typeof msg.id !== "string") return;

    const pending = pendingBridgeRequests.get(msg.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    pendingBridgeRequests.delete(msg.id);
    pending.resolve(msg as BridgeResponse);
  };

  window.addEventListener("message", onMessage);
  document.addEventListener("message", onMessage as EventListener);
  w.__seekyBridgeListenerInstalled__ = true;
}

async function sendBridgeRequest(req: BridgeRequest): Promise<BridgeResponse> {
  const w = getSeekyWindow();
  const rnwv = w?.ReactNativeWebView;

  if (!rnwv || typeof rnwv.postMessage !== "function") {
    throw new Error("MOBILE_BRIDGE_UNAVAILABLE");
  }

  installBridgeListener();

  return await new Promise<BridgeResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingBridgeRequests.delete(req.id);
      reject(new Error("MOBILE_BRIDGE_TIMEOUT"));
    }, BRIDGE_TIMEOUT_MS);

    pendingBridgeRequests.set(req.id, { resolve, reject, timer });

    try {
      rnwv.postMessage(JSON.stringify(req));
    } catch (err) {
      clearTimeout(timer);
      pendingBridgeRequests.delete(req.id);
      reject(err);
    }
  });
}

function getSyntheticMobileProvider(wallet: string): SolanaProvider {
  return {
    publicKey: {
      toBase58: () => wallet,
    },
    connect: async () => ({ publicKey: { toBase58: () => wallet } }),
    disconnect: async () => true,
    signMessage: async (message: Uint8Array) => {
      const response = await sendBridgeRequest({
        type: "SEEKY_MOBILE_BRIDGE_REQUEST",
        id: makeBridgeId(),
        method: "signMessage",
        payload: { messageB64: bytesToBase64(message) },
      });

      if (!response.ok) {
        throw new Error(response.error || "MOBILE_SIGN_FAILED");
      }

      const sigB58 = String(response.result?.signatureB58 || "").trim();
      if (!sigB58) {
        throw new Error("MISSING_SIGNATURE");
      }

      return bs58.decode(sigB58);
    },
  };
}

export function getSolanaProvider(): SolanaProvider | null {
  if (!isBrowser()) return null;

  const mobileWallet = getInjectedMobileWallet();
  if (mobileWallet && isMobileWebViewBridgeAvailable()) {
    return getSyntheticMobileProvider(mobileWallet);
  }

  const w = getSeekyWindow();
  const p = w?.solana;

  if (!p || typeof p !== "object") return null;
  return p as SolanaProvider;
}

export function getConnectedWalletPubkey(): string | null {
  if (!isBrowser()) return null;

  const mobileWallet = getInjectedMobileWallet();
  if (mobileWallet) {
    localStorage.setItem(WALLET_STORAGE_KEY, mobileWallet);
    return mobileWallet;
  }

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
  const mobileWallet = getInjectedMobileWallet();
  if (mobileWallet && isMobileWebViewBridgeAvailable()) {
    localStorage.setItem(WALLET_STORAGE_KEY, mobileWallet);
    return getSyntheticMobileProvider(mobileWallet);
  }

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
  const mobileWallet = getInjectedMobileWallet();
  if (mobileWallet) {
    localStorage.setItem(WALLET_STORAGE_KEY, mobileWallet);
    window.dispatchEvent(new Event("seeky:wallet"));
    return mobileWallet;
  }

  const provider = await ensureWalletConnected();
  const pk = provider?.publicKey?.toBase58?.() || null;

  if (pk && isBrowser()) {
    localStorage.setItem(WALLET_STORAGE_KEY, pk);
    window.dispatchEvent(new Event("seeky:wallet"));
  }

  return pk;
}

export async function disconnectWallet(): Promise<void> {
  const mobileWallet = getInjectedMobileWallet();
  if (mobileWallet) {
    if (isBrowser()) {
      localStorage.removeItem(WALLET_STORAGE_KEY);
      window.dispatchEvent(new Event("seeky:wallet"));
    }
    return;
  }

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
