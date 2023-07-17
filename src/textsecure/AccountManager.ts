// Copyright 2023 Ready

/* eslint-disable import/no-unused-modules */

import PQueue from 'p-queue'

import { strictAssert } from 'utils/assert'
import { logger as log } from 'utils/logger'
import { generatePreKey, generateSignedPreKey } from '../Curve'
import { type AccountIdStringType } from '../types/Account'
import { isOlderThan } from '../utils/timestamp'
import EventTarget from './EventTarget'
import createTaskWithTimeout from './TaskWithTimeout'
import type { KeyPairType } from './Types.d'

const DAY = 24 * 60 * 60 * 1000
const MINIMUM_SIGNED_PREKEYS = 5
const ARCHIVE_AGE = 30 * DAY
const PREKEY_ROTATION_AGE = DAY * 1.5
const PROFILE_KEY_LENGTH = 32
export const SIGNED_KEY_GEN_BATCH_SIZE = 100

export type GeneratedKeysType = {
  preKeys: Array<{
    keyId: number
    publicKey: Uint8Array
  }>
  signedPreKey: {
    keyId: number
    publicKey: Uint8Array
    signature: Uint8Array
    keyPair: KeyPairType
  }
  identityKey: Uint8Array
}

export default class AccountManager extends EventTarget {
  pending: Promise<void>

  pendingQueue?: PQueue

  constructor() {
    super()

    this.pending = Promise.resolve()
  }

  // async registerSingleDevice(number: string, verificationCode: string): Promise<void> {}

  // async registerSecondDevice(
  //   setProvisioningUrl: (url: string) => void,
  //   confirmNumber: (number?: string) => Promise<string>
  // ): Promise<void> {}

  // async refreshPreKeys(uuidKind: UUIDKind): Promise<void> {}

  // async rotateSignedPreKey(uuidKind: UUIDKind): Promise<void> {}

  async queueTask<T>(task: () => Promise<T>): Promise<T> {
    this.pendingQueue = this.pendingQueue || new PQueue({ concurrency: 1 })
    const taskWithTimeout = createTaskWithTimeout(task, 'AccountManager task')

    return this.pendingQueue.add(taskWithTimeout)
  }

  async cleanSignedPreKeys(ourAccountId: AccountIdStringType): Promise<void> {
    const store = window.Ready.protocol
    const logId = `AccountManager.cleanSignedPreKeys(${ourAccountId})`

    const allKeys = await store.loadSignedPreKeys(ourAccountId)
    allKeys.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const confirmed = allKeys.filter((key) => key.confirmed)
    const unconfirmed = allKeys.filter((key) => !key.confirmed)

    const recent = allKeys[0] ? allKeys[0].keyId : 'none'
    const recentConfirmed = confirmed[0] ? confirmed[0].keyId : 'none'
    const recentUnconfirmed = unconfirmed[0] ? unconfirmed[0].keyId : 'none'
    log.info(`${logId}: Most recent signed key: ${recent}`)
    log.info(`${logId}: Most recent confirmed signed key: ${recentConfirmed}`)
    log.info(`${logId}: Most recent unconfirmed signed key: ${recentUnconfirmed}`)
    log.info(`${logId}: Total signed key count:`, allKeys.length, '-', confirmed.length, 'confirmed')

    // Keep MINIMUM_SIGNED_PREKEYS keys, then drop if older than ARCHIVE_AGE
    await Promise.all(
      allKeys.map(async (key, index) => {
        if (index < MINIMUM_SIGNED_PREKEYS) {
          return
        }
        const createdAt = key.createdAt || 0

        if (isOlderThan(createdAt, ARCHIVE_AGE)) {
          const timestamp = new Date(createdAt).toJSON()
          const confirmedText = key.confirmed ? ' (confirmed)' : ''
          log.info(`${logId}: Removing signed prekey: ${key.keyId} with ` + `timestamp ${timestamp}${confirmedText}`)
          await store.removeSignedPreKey(ourAccountId, key.keyId)
        }
      })
    )
  }

  // async createAccount({
  //   number,
  //   verificationCode,
  //   aciKeyPair,
  //   pniKeyPair,
  //   profileKey,
  //   deviceName,
  //   userAgent,
  //   readReceipts,
  //   accessKey,
  // }: CreateAccountOptionsType): Promise<void> {}

  async clearSessionsAndPreKeys(): Promise<void> {
    const store = window.Ready.protocol

    log.info('clearing all sessions, prekeys, and signed prekeys')
    await Promise.all([store.clearPreKeyStore(), store.clearSignedPreKeysStore(), store.clearSessionStore()])
  }

  // Takes the same object returned by generateKeys
  async confirmKeys(ourAccountId: AccountIdStringType, keys: GeneratedKeysType): Promise<void> {
    const store = window.Ready.protocol
    const key = keys.signedPreKey
    const confirmed = true

    if (!key) {
      throw new Error('confirmKeys: signedPreKey is null')
    }

    log.info(`AccountManager.confirmKeys(${ourAccountId}): confirming key`, key.keyId)
    await store.storeSignedPreKey(ourAccountId, key.keyId, key.keyPair, confirmed)
  }

  async generateKeys(
    ourAccountId: AccountIdStringType,
    count: number,
    maybeIdentityKey?: KeyPairType
  ): Promise<GeneratedKeysType> {
    const { Data: db, protocol: store } = window.Ready

    const startId = ((await db.getMaxSignalPreKeyId(ourAccountId)) ?? 0) + 1
    const signedKeyId = ((await db.getMaxSignalSignedPreKeyId(ourAccountId)) ?? 0) + 1

    log.log('--  generateKeys', ourAccountId, count, startId, signedKeyId)

    if (typeof startId !== 'number') {
      throw new Error('Invalid maxPreKeyId')
    }
    if (typeof signedKeyId !== 'number') {
      throw new Error('Invalid signedKeyId')
    }

    const identityKey = maybeIdentityKey ?? store.getIdentityKeyPair(ourAccountId)
    strictAssert(identityKey, 'generateKeys: No identity key pair!')

    const result: Omit<GeneratedKeysType, 'signedPreKey'> = {
      preKeys: [],
      identityKey: identityKey.pubKey,
    }
    const promises = []

    for (let keyId = startId; keyId < startId + count; keyId += 1) {
      promises.push(
        (async () => {
          const res = generatePreKey(keyId)
          await store.storePreKey(ourAccountId, res.keyId, res.keyPair)
          result.preKeys.push({
            keyId: res.keyId,
            publicKey: res.keyPair.pubKey,
          })
        })()
      )
    }

    await Promise.all(promises)

    const res = generateSignedPreKey(identityKey, signedKeyId)
    await store.storeSignedPreKey(ourAccountId, res.keyId, res.keyPair)
    const signedPreKey = {
      keyId: res.keyId,
      publicKey: res.keyPair.pubKey,
      signature: res.signature,
      // server.registerKeys doesn't use keyPair, confirmKeys does
      keyPair: res.keyPair,
    }

    // promises.push(storage.put('maxPreKeyId', startId + count))
    // promises.push(storage.put('signedKeyId', signedKeyId + 1))

    // This is primarily for the signed prekey summary it logs out
    this.cleanSignedPreKeys(ourAccountId)

    return {
      ...result,
      signedPreKey,
    }
  }

  // async registrationDone(): Promise<void> {}
}
