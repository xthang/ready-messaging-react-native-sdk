// Copyright 2023 Ready.io

/* eslint-disable no-bitwise */

import * as client from '@readyio/lib-messaging'

import { constantTimeEqual } from 'utils/crypto/utils'
import type { KeyPairType, CompatPreKeyType, CompatSignedPreKeyType } from './textsecure/Types.d'

export function isNonNegativeInteger(n: unknown): n is number {
  return typeof n === 'number' && n % 1 === 0 && n >= 0
}

export function generateSignedPreKey(identityKeyPair: KeyPairType, keyId: number): CompatSignedPreKeyType {
  if (!isNonNegativeInteger(keyId)) {
    throw new TypeError(`generateSignedPreKey: Invalid argument for keyId: ${keyId}`)
  }

  if (
    !(identityKeyPair.privKey instanceof Uint8Array) ||
    identityKeyPair.privKey.byteLength !== 32 ||
    !(identityKeyPair.pubKey instanceof Uint8Array) ||
    identityKeyPair.pubKey.byteLength !== 33
  ) {
    throw new TypeError('generateSignedPreKey: Invalid argument for identityKeyPair')
  }

  const keyPair = generateKeyPair()
  const signature = calculateSignature(identityKeyPair.privKey, keyPair.pubKey)

  return {
    keyId,
    keyPair,
    signature,
  }
}
export function generatePreKey(keyId: number): CompatPreKeyType {
  if (!isNonNegativeInteger(keyId)) {
    throw new TypeError(`generatePreKey: Invalid argument for keyId: ${keyId}`)
  }

  const keyPair = generateKeyPair()

  return {
    keyId,
    keyPair,
  }
}

export function generateKeyPair(): KeyPairType {
  const privKey = client.PrivateKey.generate()
  const pubKey = privKey.getPublicKey()

  return {
    privKey: privKey.serialize(),
    pubKey: pubKey.serialize(),
  }
}

export function createKeyPair(incomingKey: Uint8Array): KeyPairType {
  const copy = new Uint8Array(incomingKey)
  clampPrivateKey(copy)
  if (!constantTimeEqual(copy, incomingKey)) {
    // log.warn('createKeyPair: incoming private key was not clamped!')
  }

  const incomingKeyBuffer = Buffer.from(incomingKey)

  if (incomingKeyBuffer.length !== 32) {
    throw new Error('key must be 32 bytes long')
  }

  const privKey = client.PrivateKey.deserialize(incomingKeyBuffer)
  const pubKey = privKey.getPublicKey()

  return {
    privKey: privKey.serialize(),
    pubKey: convertPublicKeyToAddress(pubKey.serialize()),
  }
}

function convertPublicKeyToAddress(pubKey: Buffer): Buffer {
  // prepend version byte
  const origPub = new Uint8Array(pubKey)
  const pub = new Uint8Array(33)
  pub.set(origPub, 1)
  pub[0] = 5
  return Buffer.from(pub.buffer.slice(pub.byteOffset, pub.byteLength + pub.byteOffset))
}

// export function prefixPublicKey(pubKey: Uint8Array): Uint8Array {
//   return Bytes.concatenate([new Uint8Array([0x05]), validatePubKeyFormat(pubKey)])
// }

// export function calculateAgreement(pubKey: Uint8Array, privKey: Uint8Array): Uint8Array {
//   const privKeyBuffer = Buffer.from(privKey)

//   const pubKeyObj = client.PublicKey.deserialize(Buffer.from(prefixPublicKey(pubKey)))
//   const privKeyObj = client.PrivateKey.deserialize(privKeyBuffer)
//   const sharedSecret = privKeyObj.agree(pubKeyObj)
//   return sharedSecret
// }

// export function verifySignature(pubKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
//   const pubKeyBuffer = Buffer.from(pubKey)
//   const messageBuffer = Buffer.from(message)
//   const signatureBuffer = Buffer.from(signature)

//   const pubKeyObj = client.PublicKey.deserialize(pubKeyBuffer)
//   const result = pubKeyObj.verify(messageBuffer, signatureBuffer)

//   return result
// }

export function calculateSignature(privKey: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const privKeyBuffer = Buffer.from(privKey)
  const plaintextBuffer = Buffer.from(plaintext)

  const privKeyObj = client.PrivateKey.deserialize(privKeyBuffer)
  const signature = privKeyObj.sign(plaintextBuffer)
  return signature
}

// function validatePubKeyFormat(pubKey: Uint8Array): Uint8Array {
//   if (
//     pubKey === undefined ||
//     ((pubKey.byteLength !== 33 || pubKey[0] !== 5) && pubKey.byteLength !== 32)
//   ) {
//     throw new Error('Invalid public key')
//   }
//   if (pubKey.byteLength === 33) {
//     return pubKey.slice(1)
//   }

//   return pubKey
// }

export function setPublicKeyTypeByte(publicKey: Uint8Array): void {
  publicKey[0] = 5
}

export function clampPrivateKey(privateKey: Uint8Array): void {
  privateKey[0] &= 248

  privateKey[31] &= 127

  privateKey[31] |= 64
}
