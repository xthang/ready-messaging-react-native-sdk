import { AsyncCurve25519Wrapper, AsyncCurve as AsyncCurveType } from '@privacyresearch/curve25519-typescript'
import { KeyPairType } from '../types'

export class AsyncCurve {
  private _curve25519: AsyncCurveType
  constructor() {
    this._curve25519 = new AsyncCurve25519Wrapper()
  }

  set curve(c: AsyncCurveType) {
    this._curve25519 = c
  }

  async createKeyPair(privKey: ArrayBuffer): Promise<KeyPairType> {
    validatePrivKey(privKey)
    const raw_keys = await this._curve25519.keyPair(privKey)
    return processKeys(raw_keys)
  }

  ECDHE(pubKey: ArrayBuffer, privKey: ArrayBuffer): Promise<ArrayBuffer> {
    pubKey = validatePubKeyFormat(pubKey)
    validatePrivKey(privKey)

    if (pubKey === undefined || pubKey.byteLength !== 32) {
      throw new Error('Invalid public key')
    }

    return this._curve25519.sharedSecret(pubKey, privKey)
  }

  Ed25519Sign(privKey: ArrayBuffer, message: ArrayBuffer): Promise<ArrayBuffer> {
    validatePrivKey(privKey)

    if (message === undefined) {
      throw new Error('Invalid message')
    }

    return this._curve25519.sign(privKey, message)
  }

  async Ed25519Verify(pubKey: ArrayBuffer, msg: ArrayBuffer, sig: ArrayBuffer): Promise<boolean> {
    pubKey = validatePubKeyFormat(pubKey)

    if (pubKey === undefined || pubKey.byteLength !== 32) {
      throw new Error('Invalid public key')
    }

    if (msg === undefined) {
      throw new Error('Invalid message')
    }

    if (sig === undefined || sig.byteLength !== 64) {
      throw new Error('Invalid signature (AsyncCurve.1)')
    }

    const verifyResult = await this._curve25519.verify(pubKey, msg, sig)

    if (verifyResult) {
      throw new Error('Invalid signature (AsyncCurve.2)')
    }

    return !verifyResult
  }
}

function validatePrivKey(privKey: unknown): void {
  if (privKey === undefined || !(privKey instanceof ArrayBuffer) || privKey.byteLength !== 32) {
    throw new Error(
      `Invalid private key [${
        !privKey ? '--' : !(privKey instanceof ArrayBuffer) ? `type: ${typeof privKey}` : privKey?.byteLength
      }]`
    )
  }
}
function validatePubKeyFormat(pubKey: ArrayBuffer): ArrayBuffer {
  if (
    pubKey === undefined ||
    ((pubKey.byteLength !== 33 || new Uint8Array(pubKey)[0] !== 5) && pubKey.byteLength !== 32)
  ) {
    console.warn(`Invalid public key`, { pubKey })
    throw new Error(`Invalid public key: ${pubKey} ${pubKey?.byteLength}`)
  }

  if (pubKey.byteLength === 33) {
    return pubKey.slice(1)
  }

  console.error('WARNING: Expected pubkey of length 33, please report the ST and client that generated the pubkey')
  return pubKey
}

function processKeys(raw_keys: KeyPairType): KeyPairType {
  // prepend version byte
  const origPub = new Uint8Array(raw_keys.pubKey)
  const pub = new Uint8Array(33)
  pub.set(origPub, 1)
  pub[0] = 5

  return { pubKey: uint8ArrayToArrayBuffer(pub), privKey: raw_keys.privKey }
}

function uint8ArrayToArrayBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteLength + arr.byteOffset)
}
