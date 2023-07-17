/* eslint-disable import/no-unused-modules */

import cryptoMobile from 'crypto'
import { randomBytes } from 'react-native-randombytes'
import * as Utils from 'utils/crypto/utils'
// import * as util from '../helpers'
// import { KeyPairType } from '../types'
import { KeyPairType } from '../types'
import { AsyncCurve } from './curve'

export class Crypto {
  private _curve: AsyncCurve

  // private _webcrypto: globalThis.Crypto

  constructor() {
    this._curve = new AsyncCurve()
    // this._webcrypto = crypto || webcrypto
  }

  getRandomBytes(n: number): ArrayBuffer {
    // const array = new Uint8Array(n)
    // cryptoMobile.getRandomValues(array)
    // return util.uint8ArrayToArrayBuffer(array)
    return toArrayBuffer(randomBytes(n))
  }

  async encrypt(key: ArrayBuffer, data: ArrayBuffer, iv: ArrayBuffer): Promise<ArrayBuffer> {
    // const impkey = await this._webcrypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, [
    //   'encrypt',
    // ])

    // return this._webcrypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(iv) }, impkey, data)

    const nodeData = toNodeBuffer(data)
    const nodeIv = toNodeBuffer(iv)
    const nodeKey = toNodeBuffer(key)
    const cipher = cryptoMobile.createCipheriv('aes-256-cbc', nodeKey, nodeIv)
    const encBuf = Buffer.concat([cipher.update(nodeData), cipher.final()])
    return Promise.resolve(toArrayBuffer(encBuf))
  }

  async decrypt(key: ArrayBuffer, data: ArrayBuffer, iv: ArrayBuffer): Promise<ArrayBuffer> {
    // const impkey = await this._webcrypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, [
    //   'decrypt',
    // ])

    // return this._webcrypto.subtle.decrypt({ name: 'AES-CBC', iv: new Uint8Array(iv) }, impkey, data)

    const nodeData = toNodeBuffer(data)
    const nodeIv = toNodeBuffer(iv)
    const nodeKey = toNodeBuffer(key)
    const decipher = cryptoMobile.createDecipheriv('aes-256-cbc', nodeKey, nodeIv)
    const decBuf = Buffer.concat([decipher.update(nodeData), decipher.final()])
    return Promise.resolve(toArrayBuffer(decBuf))
  }

  async sign(key: ArrayBuffer, data: ArrayBuffer): Promise<ArrayBuffer> {
    // const impkey = await this._webcrypto.subtle.importKey(
    //   'raw',
    //   key,
    //   { name: 'HMAC', hash: { name: 'SHA-256' } },
    //   false,
    //   ['sign']
    // )

    // // eslint-disable-next-line no-useless-catch
    // try {
    //   return this._webcrypto.subtle.sign({ name: 'HMAC', hash: 'SHA-256' }, impkey, data)
    // } catch (e) {
    //   // console.log({ e, data, impkey })
    //   throw e
    // }

    const buffer = cryptoMobile.createHmac('sha256', Utils.fromBufferToB64(key)).update(data).digest()
    return Promise.resolve(toArrayBuffer(buffer))
  }

  // async hash(data: ArrayBuffer): Promise<ArrayBuffer> {
  //   // return this._webcrypto.subtle.digest({ name: 'SHA-512' }, data)

  //   const nodeValue = toNodeValue(data)
  //   const hash = this._webcrypto.createHash('sha512')
  //   hash.update(nodeValue)
  //   return Promise.resolve(toArrayBuffer(hash.digest()))
  // }

  async HKDF(input: ArrayBuffer, salt: ArrayBuffer, info: ArrayBuffer): Promise<ArrayBuffer[]> {
    // Specific implementation of RFC 5869 that only returns the first 3 32-byte chunks
    if (typeof info === 'string') {
      throw new Error(`HKDF info was a string`)
    }
    const PRK = await crypto.sign(salt, input)
    const infoBuffer = new ArrayBuffer(info.byteLength + 1 + 32)
    const infoArray = new Uint8Array(infoBuffer)
    infoArray.set(new Uint8Array(info), 32)
    infoArray[infoArray.length - 1] = 1
    const T1 = await crypto.sign(PRK, infoBuffer.slice(32))
    infoArray.set(new Uint8Array(T1))
    infoArray[infoArray.length - 1] = 2
    const T2 = await crypto.sign(PRK, infoBuffer)
    infoArray.set(new Uint8Array(T2))
    infoArray[infoArray.length - 1] = 3
    const T3 = await crypto.sign(PRK, infoBuffer)
    return [T1, T2, T3]
  }

  // Curve25519 crypto

  createKeyPair(privKey?: ArrayBuffer): Promise<KeyPairType> {
    if (!privKey) {
      privKey = this.getRandomBytes(32)
    }
    return this._curve.createKeyPair(privKey)
  }

  ECDHE(pubKey: ArrayBuffer, privKey: ArrayBuffer): Promise<ArrayBuffer> {
    return this._curve.ECDHE(pubKey, privKey)
  }

  Ed25519Sign(privKey: ArrayBuffer, message: ArrayBuffer): Promise<ArrayBuffer> {
    return this._curve.Ed25519Sign(privKey, message)
  }

  Ed25519Verify(pubKey: ArrayBuffer, msg: ArrayBuffer, sig: ArrayBuffer): Promise<boolean> {
    return this._curve.Ed25519Verify(pubKey, msg, sig)
  }
}

function toArrayBuffer(value) {
  let buf
  if (typeof value === 'string') {
    buf = Utils.fromUtf8ToArray(value).buffer
  } else {
    buf = new Uint8Array(value).buffer
  }
  return buf
}

function toNodeBuffer(value) {
  return Buffer.from(new Uint8Array(value))
}

// -----------------------------

export const crypto = new Crypto()
