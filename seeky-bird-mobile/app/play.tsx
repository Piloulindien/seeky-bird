import React, { useMemo, useRef } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { VersionedTransaction } from '@solana/web3.js'
import { fromVersionedTransaction } from '@solana/compat'
import bs58 from 'bs58'

const WEB_BASE_URL = 'http://192.168.1.46:3000'

type BridgeRequest = {
  type: 'SEEKY_MOBILE_BRIDGE_REQUEST'
  id: string
  method: 'signMessage' | 'signTransaction' | 'connect' | 'disconnect' | 'buyRun'
  payload?: {
    messageB64?: string
    txB64?: string
    mode?: 'normal' | 'daily' | 'superprize'
  }
}

type BridgeResponse = {
  type: 'SEEKY_MOBILE_BRIDGE_RESPONSE'
  id: string
  ok: boolean
  result?: {
    wallet?: string
    signatureB58?: string
    signature?: string
    receipt?: string
    seed?: number
  }
  error?: string
}

type BuyIntentResponse =
  | {
      ok: true
      mode: 'normal' | 'daily' | 'superprize'
      to: string
      expectedLamports: number
      reference: string
      memo: string
      blockhash: string
      lastValidBlockHeight: number
      txB64: string
    }
  | {
      ok: false
      error?: string
    }

type ConfirmResponse =
  | {
      ok: true
      receipt: string
      seed: number
      remaining?: {
        free: number
        normalPaid: number
        dailyPaid: number
        superprizePaid: number
      }
    }
  | {
      ok: false
      error?: string
    }

type TxSignatureCarrier = {
  signature?: unknown
  signatures?: unknown
  transactionSignature?: unknown
  transactionSignatures?: unknown
}

function escapeForJs(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255
  return out
}

function normalizeTxSignature(value: unknown): string | null {
  if (typeof value === 'string') {
    const s = value.trim()
    return s.length > 20 ? s : null
  }

  if (value instanceof Uint8Array) {
    return bs58.encode(value)
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null

    if (typeof value[0] === 'number') {
      return bs58.encode(new Uint8Array(value as number[]))
    }

    return normalizeTxSignature(value[0])
  }

  if (value && typeof value === 'object') {
    const obj = value as TxSignatureCarrier
    return (
      normalizeTxSignature(obj.signature) ||
      normalizeTxSignature(obj.transactionSignature) ||
      normalizeTxSignature(obj.signatures) ||
      normalizeTxSignature(obj.transactionSignatures)
    )
  }

  return null
}

async function postBuyIntent(
  wallet: string,
  mode: 'normal' | 'daily' | 'superprize',
): Promise<BuyIntentResponse | null> {
  const r = await fetch(`${WEB_BASE_URL}/api/runs/buy-intent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, mode }),
    cache: 'no-store',
  }).catch(() => null)

  if (!r) return null
  return (await r.json().catch(() => null)) as BuyIntentResponse | null
}

async function postConfirm(args: {
  wallet: string
  mode: 'normal' | 'daily' | 'superprize'
  reference: string
  signature: string
}): Promise<ConfirmResponse | null> {
  const r = await fetch(`${WEB_BASE_URL}/api/runs/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
    cache: 'no-store',
  }).catch(() => null)

  if (!r) return null
  return (await r.json().catch(() => null)) as ConfirmResponse | null
}

export default function PlayScreen() {
  const { account, signAndSendTransaction } = useMobileWallet()
  const webViewRef = useRef<WebView>(null)

  const walletAddress = account?.address ?? ''
  const homeUrl = `${WEB_BASE_URL}/?embed=1&mobile=1`

  const injectedJavaScriptBeforeContentLoaded = useMemo(() => {
    const wallet = escapeForJs(walletAddress)

    return `
      (function() {
        try {
          const walletAddress = '${wallet}';

          window.__SEEKY_EMBED__ = true;
          window.__SEEKY_MOBILE__ = true;
          window.__SEEKY_WALLET__ = walletAddress || null;

          try {
            localStorage.setItem('seeky_wallet', walletAddress || '');
            document.documentElement.style.background = '#020617';
            document.body.style.background = '#020617';
            document.body.style.margin = '0';
            document.body.style.padding = '0';
            document.body.style.overflow = 'hidden';
          } catch (_) {}
        } catch (_) {}
      })();
      true;
    `
  }, [walletAddress])

  function sendBridgeResponse(payload: BridgeResponse) {
    const json = JSON.stringify(payload)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')

    webViewRef.current?.injectJavaScript(`
      (function() {
        try {
          const data = JSON.parse('${json}');
          window.dispatchEvent(new MessageEvent('message', { data: data }));
          document.dispatchEvent(new MessageEvent('message', { data: data }));
        } catch (_) {}
      })();
      true;
    `)
  }

  async function onMessage(event: WebViewMessageEvent) {
    let msg: BridgeRequest | null = null

    try {
      msg = JSON.parse(event.nativeEvent.data) as BridgeRequest
    } catch {
      return
    }

    if (!msg || msg.type !== 'SEEKY_MOBILE_BRIDGE_REQUEST' || !msg.id) {
      return
    }

    if (msg.method === 'connect') {
      sendBridgeResponse({
        type: 'SEEKY_MOBILE_BRIDGE_RESPONSE',
        id: msg.id,
        ok: !!walletAddress,
        result: walletAddress ? { wallet: walletAddress } : undefined,
        error: walletAddress ? undefined : 'NO_WALLET',
      })
      return
    }

    if (msg.method === 'disconnect') {
      sendBridgeResponse({
        type: 'SEEKY_MOBILE_BRIDGE_RESPONSE',
        id: msg.id,
        ok: true,
      })
      return
    }

    if (msg.method === 'signMessage') {
      sendBridgeResponse({
        type: 'SEEKY_MOBILE_BRIDGE_RESPONSE',
        id: msg.id,
        ok: false,
        error: 'SIGN_MESSAGE_UNSUPPORTED_IN_EMBED',
      })
      return
    }

    if (msg.method === 'signTransaction') {
      sendBridgeResponse({
        type: 'SEEKY_MOBILE_BRIDGE_RESPONSE',
        id: msg.id,
        ok: false,
        error: 'SIGN_TX_UNSUPPORTED_IN_EMBED',
      })
      return
    }

    if (msg.method === 'buyRun') {
      try {
        if (!walletAddress) {
          sendBridgeResponse({
            type: 'SEEKY_MOBILE_BRIDGE_RESPONSE',
            id: msg.id,
            ok: false,
            error: 'NO_WALLET',
          })
          return
        }

        if (typeof signAndSendTransaction !== 'function') {
          sendBridgeResponse({
            type: 'SEEKY_MOBILE_BRIDGE_RESPONSE',
            id: msg.id,
            ok: false,
            error: 'BUY_UNAVAILABLE',
          })
          return
        }

        const mode = msg.payload?.mode
        if (mode !== 'normal' && mode !== 'daily' && mode !== 'superprize') {
          sendBridgeResponse({
            type: 'SEEKY_MOBILE_BRIDGE_RESPONSE',
            id: msg.id,
            ok: false,
            error: 'BAD_MODE',
          })
          return
        }

        const intent = await postBuyIntent(walletAddress, mode)
        if (!intent?.ok) {
          sendBridgeResponse({
            type: 'SEEKY_MOBILE_BRIDGE_RESPONSE',
            id: msg.id,
            ok: false,
            error: intent?.error || 'BUY_INTENT_FAILED',
          })
          return
        }

        const txBytes = base64ToBytes(intent.txB64)
        const versionedTx = VersionedTransaction.deserialize(txBytes)
        const kitTx = fromVersionedTransaction(versionedTx)

        const sent = await signAndSendTransaction(kitTx, 0n)
        const signature = normalizeTxSignature(sent)

        if (!signature) {
          sendBridgeResponse({
            type: 'SEEKY_MOBILE_BRIDGE_RESPONSE',
            id: msg.id,
            ok: false,
            error: 'BAD_TX_SIGNATURE',
          })
          return
        }

        const confirmed = await postConfirm({
          wallet: walletAddress,
          mode,
          reference: intent.reference,
          signature,
        })

        if (!confirmed?.ok) {
          sendBridgeResponse({
            type: 'SEEKY_MOBILE_BRIDGE_RESPONSE',
            id: msg.id,
            ok: false,
            error: confirmed?.error || 'CONFIRM_FAILED',
          })
          return
        }

        sendBridgeResponse({
          type: 'SEEKY_MOBILE_BRIDGE_RESPONSE',
          id: msg.id,
          ok: true,
          result: {
            wallet: walletAddress,
            signature,
            receipt: confirmed.receipt,
            seed: confirmed.seed,
          },
        })
      } catch (err) {
        sendBridgeResponse({
          type: 'SEEKY_MOBILE_BRIDGE_RESPONSE',
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : 'BUY_FAILED',
        })
      }
      return
    }
  }

  return (
    <SafeAreaView edges={[]} style={{ flex: 1, backgroundColor: '#020617' }}>
      <WebView
        ref={webViewRef}
        source={{ uri: homeUrl }}
        style={{ flex: 1, backgroundColor: '#020617' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsInlineMediaPlayback
        setSupportMultipleWindows={false}
        bounces={false}
        overScrollMode="never"
        injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
        onMessage={onMessage}
        startInLoadingState
        renderLoading={() => (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#020617',
            }}
          >
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        )}
      />
    </SafeAreaView>
  )
}
