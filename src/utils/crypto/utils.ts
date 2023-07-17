/* eslint-disable import/no-unused-modules */
/* eslint-disable no-bitwise */

import { Buffer } from 'buffer'
import crypto, { Decipher } from 'crypto'
import { randomBytes } from 'react-native-randombytes'

import { strictAssert } from '../assert'
import * as Bytes from '../Bytes'

export enum HashType {
  size256 = 'sha256',
  size512 = 'sha512',
}

export enum CipherType {
  AES256CBC = 'aes-256-cbc',
  AES256CTR = 'aes-256-ctr',
  AES256GCM = 'aes-256-gcm',
}

export function fromUtf8ToB64(str: string): string {
  return Buffer.from(str).toString('base64')
}

export function fromB64ToUtf8(str: string): string {
  return Buffer.from(str, 'base64').toString('utf8')
}

export function fromB64ToArray(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'))
}

export function fromB64ToBuffer(str: string): ArrayBuffer {
  return fromB64ToArray(str).buffer
}

export function fromBufferToB64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('base64')
}

export function fromBufferToUtf8(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('utf8')
}

export function fromBufferToByteString(buffer: ArrayBuffer): string {
  return String.fromCharCode.apply(null, Array.from(new Uint8Array(buffer)))
}

export function fromByteStringToArray(str: string): Uint8Array {
  const arr = new Uint8Array(str.length)

  for (let i = 0; i < str.length; i++) {
    arr[i] = str.charCodeAt(i)
  }
  return arr
}

export function fromUtf8ToArray(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'utf8'))
}

export function fromHexToArray(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'hex'))
}

export function fromHexToBuffer(str: string): ArrayBuffer {
  return fromHexToArray(str).buffer
}

export function fromBufferToHex(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('hex')
}

export function toNodeBuffer(value: ArrayBuffer): Buffer {
  return Buffer.from(new Uint8Array(value) as any)
}

export function toArrayBuffer(value: Buffer | string | ArrayBuffer): ArrayBuffer {
  let buf: ArrayBuffer
  if (typeof value === 'string') {
    buf = fromUtf8ToArray(value).buffer
  } else {
    buf = new Uint8Array(value).buffer
  }
  return buf
}

export function constantTimeEqual(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) {
    return false
  }
  let result = 0
  const ta1 = new Uint8Array(left)
  const ta2 = new Uint8Array(right)
  const max = left.byteLength
  for (let i = 0; i < max; i += 1) {
    result |= ta1[i]! ^ ta2[i]!
  }

  return result === 0
}

// -------------------------------------------

export function computeHash(data: Uint8Array): string {
  return Bytes.toBase64(hash(HashType.size512, data))
}

// High-level Operations

// Encryption

export function hmacSha256(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  return sign(key, plaintext)
}

// We use part of the constantTimeEqual algorithm from below here, but we allow ourMac
//   to be longer than the passed-in length. This allows easy comparisons against
//   arbitrary MAC lengths.
export function verifyHmacSha256(plaintext: Uint8Array, key: Uint8Array, theirMac: Uint8Array, length: number): void {
  const ourMac = hmacSha256(key, plaintext)

  if (theirMac.byteLength !== length || ourMac.byteLength < length) {
    throw new Error('Bad MAC length')
  }
  let result = 0

  for (let i = 0; i < theirMac.byteLength; i += 1) {
    result |= ourMac[i]! ^ theirMac[i]!
  }
  if (result !== 0) {
    throw new Error('Bad MAC')
  }
}

export function encryptAes256CbcPkcsPadding(key: Uint8Array, plaintext: Uint8Array, iv: Uint8Array): Uint8Array {
  return encrypt(CipherType.AES256CBC, {
    key,
    plaintext,
    iv,
  })
}

export function decryptAes256CbcPkcsPadding(key: Uint8Array, ciphertext: Uint8Array, iv: Uint8Array): Uint8Array {
  return decrypt(CipherType.AES256CBC, {
    key,
    ciphertext,
    iv,
  })
}

export function encryptAesCtr(key: Uint8Array, plaintext: Uint8Array, counter: Uint8Array): Uint8Array {
  return encrypt(CipherType.AES256CTR, {
    key,
    plaintext,
    iv: counter,
  })
}

export function decryptAesCtr(key: Uint8Array, ciphertext: Uint8Array, counter: Uint8Array): Uint8Array {
  return decrypt(CipherType.AES256CTR, {
    key,
    ciphertext,
    iv: counter,
  })
}

export function encryptAesGcm(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  return encrypt(CipherType.AES256GCM, {
    key,
    plaintext,
    iv,
    aad,
  })
}

export function decryptAesGcm(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return decrypt(CipherType.AES256GCM, {
    key,
    ciphertext,
    iv,
  })
}

// Hashing

export function sha256(data: Uint8Array): Uint8Array {
  return hash(HashType.size256, data)
}

// Utility

export function getZeroes(n: number): Uint8Array {
  return new Uint8Array(n)
}

export function highBitsToInt(byte: number): number {
  return (byte & 0xff) >> 4
}

export function intsToByteHighAndLow(highValue: number, lowValue: number): number {
  return ((highValue << 4) | lowValue) & 0xff
}

export function getFirstBytes(data: Uint8Array, n: number): Uint8Array {
  return data.subarray(0, n)
}

export function getBytes(data: Uint8Array, start: number, n: number): Uint8Array {
  return data.subarray(start, start + n)
}

export function trimForDisplay(padded: Uint8Array): Uint8Array {
  let paddingEnd = 0
  for (paddingEnd; paddingEnd < padded.length; paddingEnd += 1) {
    if (padded[paddingEnd] === 0x00) {
      break
    }
  }
  return padded.slice(0, paddingEnd)
}

export function generateRegistrationId(): number {
  const registrationId = new Uint16Array(getRandomBytes(2))[0]!
  return registrationId & 0x3fff
}

//
// SignalContext APIs
//

export function sign(key: Uint8Array, data: Uint8Array): Uint8Array {
  return crypto.createHmac('sha256', Buffer.from(key)).update(Buffer.from(data)).digest()
}

export function hash(type: HashType, data: Uint8Array): Uint8Array {
  return crypto.createHash(type).update(Buffer.from(data)).digest()
}

const AUTH_TAG_SIZE = 16

export function encrypt(
  cipherType: CipherType,
  {
    key,
    plaintext,
    iv,
    aad,
  }: Readonly<{
    key: Uint8Array
    plaintext: Uint8Array
    iv: Uint8Array
    aad?: Uint8Array
  }>
): Uint8Array {
  if (cipherType === CipherType.AES256GCM) {
    const gcm = crypto.createCipheriv(cipherType, Buffer.from(key), Buffer.from(iv))

    if (aad) {
      gcm.setAAD(aad)
    }

    const first = gcm.update(Buffer.from(plaintext))
    const last = gcm.final()
    const tag = gcm.getAuthTag()
    strictAssert(tag.length === AUTH_TAG_SIZE, 'Invalid auth tag size')

    return Buffer.concat([first, last, tag])
  }

  strictAssert(aad === undefined, `AAD is not supported for: ${cipherType}`)
  const cipher = crypto.createCipheriv(cipherType, Buffer.from(key), Buffer.from(iv))
  return Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()])
}

export function decrypt(
  cipherType: CipherType,
  {
    key,
    ciphertext,
    iv,
    aad,
  }: Readonly<{
    key: Uint8Array
    ciphertext: Uint8Array
    iv: Uint8Array
    aad?: Uint8Array
  }>
): Uint8Array {
  let decipher: Decipher
  let input = Buffer.from(ciphertext)
  if (cipherType === CipherType.AES256GCM) {
    const gcm = crypto.createDecipheriv(cipherType, Buffer.from(key), Buffer.from(iv))

    if (input.length < AUTH_TAG_SIZE) {
      throw new Error('Invalid GCM ciphertext')
    }

    const tag = input.slice(input.length - AUTH_TAG_SIZE)
    input = input.slice(0, input.length - AUTH_TAG_SIZE)

    gcm.setAuthTag(tag)

    if (aad) {
      gcm.setAAD(aad)
    }

    decipher = gcm
  } else {
    strictAssert(aad === undefined, `AAD is not supported for: ${cipherType}`)
    decipher = crypto.createDecipheriv(cipherType, Buffer.from(key), Buffer.from(iv))
  }
  return Buffer.concat([decipher.update(input), decipher.final()])
}

/**
 * Generate an integer between `min` and `max`, inclusive.
 */
// export function randomInt(min: number, max: number): number {
//   return crypto.randomInt(min, max + 1)
// }

export function getRandomBytes(size: number): Uint8Array {
  return randomBytes(size)
}
