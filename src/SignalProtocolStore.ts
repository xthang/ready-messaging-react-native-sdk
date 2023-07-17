// Copyright 2023 Ready.io

/* eslint-disable no-dupe-class-members */

import { EventEmitter } from 'events'
import {
  Direction,
  PreKeyRecord,
  PrivateKey,
  PublicKey,
  SessionRecord,
  SignedPreKeyRecord,
} from '@readyio/lib-messaging'
import PQueue from 'p-queue'
import { ConversationType } from 'types/chat'
import { assertDev, strictAssert } from 'utils/assert'
import * as Bytes from 'utils/Bytes'
import { sha256, constantTimeEqual, fromBufferToHex, fromHexToArray } from 'utils/crypto/utils'
import { logger } from 'utils/logger'
import { z } from 'zod'
import type {
  DeviceType,
  IdentityKeyType,
  IdentityKeyIdType,
  KeyPairType,
  PreKeyIdType,
  PreKeyType,
  SessionIdType,
  SessionType,
  SignedPreKeyIdType,
  SignedPreKeyType,
  OuterSignedPrekeyType,
  UnprocessedType,
  UnprocessedUpdateType,
} from './textsecure/Types.d'
import { type AccountDBType, type AccountIdStringType } from './types/Account'
import type { Address } from './types/Address'
import * as Errors from './types/errors'
import type { QualifiedAddressStringType } from './types/QualifiedAddress'
import { QualifiedAddress } from './types/QualifiedAddress'
import { ReadyAddress } from './types/ReadyId'
import { MINUTE } from './utils/durations'
import { isMoreRecentThan } from './utils/timestamp'
import { Zone } from './utils/Zone'

const TIMESTAMP_THRESHOLD = 5 * 1000 // 5 seconds

const VerifiedStatus = {
  DEFAULT: 0,
  VERIFIED: 1,
  UNVERIFIED: 2,
}

function validateVerifiedStatus(status: number): boolean {
  return status === VerifiedStatus.DEFAULT || status === VerifiedStatus.VERIFIED || status === VerifiedStatus.UNVERIFIED
}

const identityKeySchema = z.object({
  id: z.string(),
  publicKey: z.instanceof(Uint8Array),
  firstUse: z.boolean(),
  timestamp: z.number().refine((value: number) => value % 1 === 0 && value > 0),
  verified: z.number().refine(validateVerifiedStatus),
  nonblockingApproval: z.boolean(),
})

function validateIdentityKey(attrs: unknown): attrs is IdentityKeyType {
  // We'll throw if this doesn't match
  identityKeySchema.parse(attrs)
  return true
}

type HasIdType<T> = { id: T }

type CacheEntryType<DBType, HydratedType> = { fromDB: DBType; item?: HydratedType }

type MapFields = 'identityKeys' | 'preKeys' | 'senderKeys' | 'sessions' | 'signedPreKeys'

export type SessionTransactionOptions = Readonly<{
  zone?: Zone
}>

export type SetVerifiedExtra = Readonly<{
  firstUse?: boolean
  nonblockingApproval?: boolean
}>

export const GLOBAL_ZONE = new Zone('GLOBAL_ZONE')

async function _fillCaches<ID, T extends HasIdType<ID>, HydratedType>(
  object: SignalProtocolStore,
  field: MapFields,
  itemsPromise: Promise<Array<T>>,
  generateID?: (item: T) => ID
): Promise<void> {
  const items = await itemsPromise

  const cache = new Map<ID, CacheEntryType<T, HydratedType>>()
  for (let i = 0, max = items.length; i < max; i += 1) {
    const fromDB = items[i]!
    const id = generateID?.(fromDB) ?? fromDB.id

    cache.set(id, { fromDB })
  }

  logger.info(`SignalProtocolStore: Finished caching ${field} data`)

  object[field] = cache as any
}

export function freezePreKey(preKey: PreKeyRecord | SignedPreKeyRecord): KeyPairType {
  return {
    pubKey: preKey.publicKey().serialize(),
    privKey: preKey.privateKey().serialize(),
  }
}

type SessionCacheEntry = CacheEntryType<SessionType, SessionRecord>
// type SenderKeyCacheEntry = CacheEntryType<SenderKeyType, SenderKeyRecord>

type ZoneQueueEntryType = Readonly<{
  zone: Zone
  callback(): void
}>

export class SignalProtocolStore extends EventEmitter {
  // Enums used across the app

  VerifiedStatus = VerifiedStatus

  // Cached values

  private ourAccounts = new Map<AccountIdStringType, AccountDBType>()

  // private cachedPniSignatureMessage: PniSignatureMessageType | undefined

  identityKeys?: Map<IdentityKeyIdType, CacheEntryType<IdentityKeyType, PublicKey>>

  // senderKeys?: Map<SenderKeyIdType, SenderKeyCacheEntry>

  sessions?: Map<SessionIdType, SessionCacheEntry>

  preKeys?: Map<PreKeyIdType, CacheEntryType<PreKeyType, PreKeyRecord>>

  signedPreKeys?: Map<SignedPreKeyIdType, CacheEntryType<SignedPreKeyType, SignedPreKeyRecord>>

  senderKeyQueues = new Map<QualifiedAddressStringType, PQueue>()

  sessionQueues = new Map<SessionIdType, PQueue>()

  private readonly identityQueues = new Map<string, PQueue>()

  private currentZone?: Zone

  private currentZoneDepth = 0

  private readonly zoneQueue: Array<ZoneQueueEntryType> = []

  private pendingSessions = new Map<SessionIdType, SessionCacheEntry>()

  // private pendingSenderKeys = new Map<SenderKeyIdType, SenderKeyCacheEntry>()

  private pendingUnprocessed = new Map<string, UnprocessedType>()

  async hydrateCaches(): Promise<void> {
    await Promise.all([
      (async () => {
        this.ourAccounts.clear()
        const map = await window.Ready.Data.getAllAccounts(true)
        if (!map.length) {
          return
        }

        map.forEach((it) => {
          this.ourAccounts.set(it.id, it)
        })
      })(),
      _fillCaches<string, IdentityKeyType, PublicKey>(
        this,
        'identityKeys',
        window.Ready.Data.getAllSignalIdentityKeys(),
        (item: IdentityKeyType) => `${item.ourId}:${item.theirId}`
      ),
      _fillCaches<string, SessionType, SessionRecord>(
        this,
        'sessions',
        window.Ready.Data.getAllSignalSessions(),
        (item: SessionType) => `${item.ourId}:${item.theirId}.${item.deviceId}`
      ),
      _fillCaches<string, PreKeyType, PreKeyRecord>(
        this,
        'preKeys',
        window.Ready.Data.getAllSignalPreKeys(),
        (item: PreKeyType) => `${item.ourId}:${item.keyId}`
      ),
      // _fillCaches<string, SenderKeyType, SenderKeyRecord>(
      //   this,
      //   'senderKeys',
      //   window.Signal.Data.getAllSenderKeys()
      // ),
      _fillCaches<string, SignedPreKeyType, SignedPreKeyRecord>(
        this,
        'signedPreKeys',
        window.Ready.Data.loadAllSignalSignedPreKeys(),
        (item: PreKeyType) => `${item.ourId}:${item.keyId}`
      ),
    ])
  }

  getAccount(ourAccountId: string): AccountDBType {
    return this.ourAccounts.get(ourAccountId)!
  }

  getIdentityKeyPair(ourAccountId: string): KeyPairType | undefined {
    // return this.ourIdentityKeys.get(ourAccountId)
    // const account = await window.Signal.Data.getAccount(ourAccountId)
    const account = this.ourAccounts.get(ourAccountId)!
    return {
      pubKey: fromHexToArray(account.publicKey),
      privKey: fromHexToArray(account.privateKey),
    }
  }

  async getLocalRegistrationId(accountId: string): Promise<number | undefined> {
    // return this.ourRegistrationIds.get(accountId)

    // const account = await window.Signal.Data.getAccount(accountId)
    const account = this.ourAccounts.get(accountId)!
    return account.registrationId
  }

  // PreKeys

  async loadPreKey(accountId: string, keyId: number): Promise<PreKeyRecord | undefined> {
    if (!this.preKeys) {
      throw new Error('loadPreKey: this.preKeys not yet cached!')
    }

    const id: PreKeyIdType = `${accountId}:${keyId}`

    const entry = this.preKeys.get(id)
    if (!entry) {
      logger.error('Failed to fetch prekey:', id)
      return undefined
    }

    if (entry.item) {
      logger.info('Successfully fetched prekey (cache hit):', id)
      return entry.item
    }

    const item = PreKeyRecord.new(
      keyId,
      PublicKey.deserialize(Buffer.from(entry.fromDB.publicKey)),
      PrivateKey.deserialize(Buffer.from(entry.fromDB.privateKey))
    )
    this.preKeys.set(id, {
      fromDB: entry.fromDB,
      item,
    })
    logger.info('Successfully fetched prekey (cache miss):', id)
    return item
  }

  async storePreKey(ourId: AccountIdStringType, keyId: number, keyPair: KeyPairType): Promise<void> {
    if (!this.preKeys) {
      throw new Error('storePreKey: this.preKeys not yet cached!')
    }

    const id: PreKeyIdType = `${ourId}:${keyId}`
    if (this.preKeys.has(id)) {
      throw new Error(`storePreKey: prekey ${id} already exists!`)
    }

    const fromDB: PreKeyType = {
      id,
      ourId,
      keyId,
      publicKey: keyPair.pubKey,
      privateKey: keyPair.privKey,
    }

    await window.Ready.Data.createSignalPreKey({
      accountId: ourId,
      keyId,
      publicKey: fromBufferToHex(keyPair.pubKey),
      privateKey: fromBufferToHex(keyPair.privKey),
    })
    this.preKeys.set(id, { fromDB })
  }

  async removePreKey(accountId: string, keyId: number): Promise<void> {
    if (!this.preKeys) {
      throw new Error('removePreKey: this.preKeys not yet cached!')
    }

    const id: PreKeyIdType = `${accountId}:${keyId}`

    try {
      this.emit('removePreKey', accountId)
    } catch (error) {
      logger.error('removePreKey error triggering removePreKey:', Errors.toLogFormat(error))
    }

    this.preKeys.delete(id)
    await window.Ready.Data.deleteSignalPreKey(accountId, keyId)
  }

  async clearPreKeyStore(): Promise<void> {
    if (this.preKeys) {
      this.preKeys.clear()
    }
    await window.Ready.Data.removeAllSignalPreKeys()
  }

  // Signed PreKeys

  async loadSignedPreKey(accountId: string, keyId: number): Promise<SignedPreKeyRecord | undefined> {
    if (!this.signedPreKeys) {
      throw new Error('loadSignedPreKey: this.signedPreKeys not yet cached!')
    }

    const id: SignedPreKeyIdType = `${accountId}:${keyId}`

    const entry = this.signedPreKeys.get(id)
    if (!entry) {
      logger.error('Failed to fetch signed prekey:', id)
      return undefined
    }

    if (entry.item) {
      logger.info('Successfully fetched signed prekey (cache hit):', id)
      return entry.item
    }

    const item = SignedPreKeyRecord.new(
      keyId,
      0,
      PublicKey.deserialize(Buffer.from(entry.fromDB.publicKey)),
      PrivateKey.deserialize(Buffer.from(entry.fromDB.privateKey)),
      Buffer.from([])
    )
    this.signedPreKeys.set(id, {
      item,
      fromDB: entry.fromDB,
    })
    logger.info('Successfully fetched signed prekey (cache miss):', id)
    return item
  }

  async loadSignedPreKeys(ourAccountId: AccountIdStringType): Promise<Array<OuterSignedPrekeyType>> {
    if (!this.signedPreKeys) {
      throw new Error('loadSignedPreKeys: this.signedPreKeys not yet cached!')
    }

    if (arguments.length > 1) {
      throw new Error('loadSignedPreKeys takes one argument')
    }

    return Array.from(this.signedPreKeys.values())
      .filter(({ fromDB }) => fromDB.ourId === ourAccountId)
      .map((entry) => {
        const preKey = entry.fromDB
        return {
          pubKey: preKey.publicKey,
          privKey: preKey.privateKey,
          createdAt: preKey.created_at,
          keyId: preKey.keyId,
          confirmed: preKey.confirmed,
        }
      })
  }

  // Note that this is also called in update scenarios, for confirming that signed prekeys
  //   have indeed been accepted by the server.
  async storeSignedPreKey(
    ourAccountId: string,
    keyId: number,
    keyPair: KeyPairType,
    confirmed?: boolean,
    createdAt = Date.now()
  ): Promise<void> {
    if (!this.signedPreKeys) {
      throw new Error('storeSignedPreKey: this.signedPreKeys not yet cached!')
    }

    const id: SignedPreKeyIdType = `${ourAccountId}:${keyId}`

    const fromDB: SignedPreKeyType = {
      id,
      ourId: ourAccountId,
      keyId,
      publicKey: keyPair.pubKey,
      privateKey: keyPair.privKey,
      created_at: createdAt,
      confirmed: Boolean(confirmed),
    }

    await window.Ready.Data.createSignalSignedPreKey({
      accountId: ourAccountId,
      keyId,
      publicKey: fromBufferToHex(keyPair.pubKey),
      privateKey: fromBufferToHex(keyPair.privKey),
      confirmed,
    })
    this.signedPreKeys.set(id, { fromDB })
  }

  async removeSignedPreKey(accountId: string, keyId: number): Promise<void> {
    if (!this.signedPreKeys) {
      throw new Error('removeSignedPreKey: this.signedPreKeys not yet cached!')
    }

    const id: SignedPreKeyIdType = `${accountId}:${keyId}`
    this.signedPreKeys.delete(id)
    await window.Ready.Data.deleteSignalSignedPreKey(accountId, keyId)
  }

  async clearSignedPreKeysStore(): Promise<void> {
    if (this.signedPreKeys) {
      this.signedPreKeys.clear()
    }
    await window.Ready.Data.removeAllSignalSignedPreKeys()
  }

  // Sender Key

  // Re-entrant sender key transaction routine. Only one sender key transaction could
  // be running at the same time.
  //
  // While in transaction:
  //
  // - `saveSenderKey()` adds the updated session to the `pendingSenderKeys`
  // - `getSenderKey()` looks up the session first in `pendingSenderKeys` and only
  //   then in the main `senderKeys` store
  //
  // When transaction ends:
  //
  // - successfully: pending sender key stores are batched into the database
  // - with an error: pending sender key stores are reverted

  // async enqueueSenderKeyJob<T>(
  //   qualifiedAddress: QualifiedAddress,
  //   task: () => Promise<T>,
  //   zone = GLOBAL_ZONE
  // ): Promise<T> {
  //   return this.withZone(zone, 'enqueueSenderKeyJob', async () => {
  //     const queue = this._getSenderKeyQueue(qualifiedAddress)

  //     return queue.add<T>(task)
  //   })
  // }

  // private _getSenderKeyQueue(senderId: QualifiedAddress): PQueue {
  //   const cachedQueue = this.senderKeyQueues.get(senderId.toString())
  //   if (cachedQueue) {
  //     return cachedQueue
  //   }

  //   const freshQueue = new PQueue({
  //     concurrency: 1,
  //     timeout: MINUTE * 30,
  //     throwOnTimeout: true,
  //   })
  //   this.senderKeyQueues.set(senderId.toString(), freshQueue)
  //   return freshQueue
  // }

  // private getSenderKeyId(senderKeyId: QualifiedAddress, distributionId: string): SenderKeyIdType {
  //   return `${senderKeyId.toString()}--${distributionId}`
  // }

  // async saveSenderKey(
  //   qualifiedAddress: QualifiedAddress,
  //   distributionId: string,
  //   record: SenderKeyRecord,
  //   { zone = GLOBAL_ZONE }: SessionTransactionOptions = {}
  // ): Promise<void> {
  //   await this.withZone(zone, 'saveSenderKey', async () => {
  //     if (!this.senderKeys) {
  //       throw new Error('saveSenderKey: this.senderKeys not yet cached!')
  //     }

  //     const senderId = qualifiedAddress.toString()

  //     try {
  //       const id = this.getSenderKeyId(qualifiedAddress, distributionId)

  //       const fromDB: SenderKeyType = {
  //         id,
  //         senderId,
  //         distributionId,
  //         data: record.serialize(),
  //         lastUpdatedDate: Date.now(),
  //       }

  //       this.pendingSenderKeys.set(id, { fromDB, item: record })

  //       // Current zone doesn't support pending sessions - commit immediately
  //       if (!zone.supportsPendingSenderKeys()) {
  //         await this.commitZoneChanges('saveSenderKey')
  //       }
  //     } catch (error) {
  //       const errorString = Errors.toLogFormat(error)
  //       logger.error(
  //         `saveSenderKey: failed to save senderKey ${senderId}/${distributionId}: ${errorString}`
  //       )
  //     }
  //   })
  // }

  // async getSenderKey(
  //   qualifiedAddress: QualifiedAddress,
  //   distributionId: string,
  //   { zone = GLOBAL_ZONE }: SessionTransactionOptions = {}
  // ): Promise<SenderKeyRecord | undefined> {
  //   return this.withZone(zone, 'getSenderKey', async () => {
  //     if (!this.senderKeys) {
  //       throw new Error('getSenderKey: this.senderKeys not yet cached!')
  //     }

  //     const senderId = qualifiedAddress.toString()

  //     try {
  //       const id = this.getSenderKeyId(qualifiedAddress, distributionId)

  //       const map = this.pendingSenderKeys.has(id) ? this.pendingSenderKeys : this.senderKeys
  //       const entry = map.get(id)

  //       if (!entry) {
  //         logger.error('Failed to fetch sender key:', id)
  //         return undefined
  //       }

  //       if (entry.item) {
  //         logger.info('Successfully fetched sender key (cache hit):', id)
  //         return entry.item
  //       }

  //       const item = SenderKeyRecord.deserialize(Buffer.from(entry.fromDB.data))
  //       this.senderKeys.set(id, { item, fromDB: entry.fromDB })
  //       logger.info('Successfully fetched sender key(cache miss):', id)
  //       return item
  //     } catch (error) {
  //       const errorString = Errors.toLogFormat(error)
  //       logger.error(
  //         `getSenderKey: failed to load sender key ${senderId}/${distributionId}: ${errorString}`
  //       )
  //       return undefined
  //     }
  //   })
  // }

  // async removeSenderKey(qualifiedAddress: QualifiedAddress, distributionId: string): Promise<void> {
  //   if (!this.senderKeys) {
  //     throw new Error('getSenderKey: this.senderKeys not yet cached!')
  //   }

  //   const senderId = qualifiedAddress.toString()

  //   try {
  //     const id = this.getSenderKeyId(qualifiedAddress, distributionId)

  //     await window.Signal.Data.removeSenderKeyById(id)

  //     this.senderKeys.delete(id)
  //   } catch (error) {
  //     const errorString = Errors.toLogFormat(error)
  //     logger.error(
  //       `removeSenderKey: failed to remove senderKey ${senderId}/${distributionId}: ${errorString}`
  //     )
  //   }
  // }

  // async removeAllSenderKeys(): Promise<void> {
  //   return this.withZone(GLOBAL_ZONE, 'removeAllSenderKeys', async () => {
  //     if (this.senderKeys) {
  //       this.senderKeys.clear()
  //     }
  //     if (this.pendingSenderKeys) {
  //       this.pendingSenderKeys.clear()
  //     }
  //     await window.Signal.Data.removeAllSenderKeys()
  //   })
  // }

  // Session Queue

  async enqueueSessionJob<T>(
    qualifiedAddress: QualifiedAddress,
    task: () => Promise<T>,
    zone: Zone = GLOBAL_ZONE
  ): Promise<T> {
    return this.withZone(zone, 'enqueueSessionJob', async () => {
      const queue = this._getSessionQueue(qualifiedAddress)

      return queue.add<T>(task)
    })
  }

  private _getSessionQueue(id: QualifiedAddress): PQueue {
    const cachedQueue = this.sessionQueues.get(id.toString())
    if (cachedQueue) {
      return cachedQueue
    }

    const freshQueue = new PQueue({
      concurrency: 1,
      timeout: MINUTE * 30,
      throwOnTimeout: true,
    })
    this.sessionQueues.set(id.toString(), freshQueue)
    return freshQueue
  }

  // Identity Queue

  private _getIdentityQueue(theirId: ReadyAddress): PQueue {
    const cachedQueue = this.identityQueues.get(theirId.toString())
    if (cachedQueue) {
      return cachedQueue
    }

    const freshQueue = new PQueue({
      concurrency: 1,
      timeout: MINUTE * 30,
      throwOnTimeout: true,
    })
    this.identityQueues.set(theirId.toString(), freshQueue)
    return freshQueue
  }

  // Sessions

  // Re-entrant session transaction routine. Only one session transaction could
  // be running at the same time.
  //
  // While in transaction:
  //
  // - `storeSession()` adds the updated session to the `pendingSessions`
  // - `loadSession()` looks up the session first in `pendingSessions` and only
  //   then in the main `sessions` store
  //
  // When transaction ends:
  //
  // - successfully: pending session stores are batched into the database
  // - with an error: pending session stores are reverted

  public async withZone<T>(zone: Zone, name: string, body: () => Promise<T>): Promise<T> {
    const debugName = `withZone(${zone.name}:${name})`

    // Allow re-entering from LibSignalStores
    if (this.currentZone && this.currentZone !== zone) {
      const start = Date.now()

      logger.info(`${debugName}: locked by ${this.currentZone.name}, waiting`)

      return new Promise<T>((resolve, reject) => {
        const callback = async () => {
          const duration = Date.now() - start
          logger.info(`${debugName}: unlocked after ${duration}ms`)

          // Call `.withZone` synchronously from `this.zoneQueue` to avoid
          // extra in-between ticks while we are on microtasks queue.
          try {
            resolve(await this.withZone(zone, name, body))
          } catch (error) {
            reject(error)
          }
        }

        this.zoneQueue.push({ zone, callback })
      })
    }

    this.enterZone(zone, name)

    let result: T
    try {
      result = await body()
    } catch (error: any) {
      if (this.isInTopLevelZone()) {
        await this.revertZoneChanges(name, error)
      }
      this.leaveZone(zone)
      throw error
    }

    if (this.isInTopLevelZone()) {
      await this.commitZoneChanges(name)
    }
    this.leaveZone(zone)

    return result
  }

  private async commitZoneChanges(name: string): Promise<void> {
    const { pendingSessions, pendingUnprocessed } = this

    if (
      // pendingSenderKeys.size === 0 &&
      pendingSessions.size === 0 &&
      pendingUnprocessed.size === 0
    ) {
      return
    }

    logger.info(
      `commitZoneChanges(${name}): ` +
        // `pending sender keys ${pendingSenderKeys.size}, ` +
        `pending sessions ${pendingSessions.size}, ` +
        `pending unprocessed ${pendingUnprocessed.size}`
    )

    // this.pendingSenderKeys = new Map()
    this.pendingSessions = new Map()
    this.pendingUnprocessed = new Map()

    // Commit both sender keys, sessions and unprocessed in the same database transaction
    //   to unroll both on error.
    await window.Ready.Data.commitDecryptResult({
      // senderKeys: Array.from(pendingSenderKeys.values()).map(({ fromDB }) => fromDB),
      sessions: Array.from(pendingSessions.values()).map(({ fromDB }) => fromDB),
      unprocessed: Array.from(pendingUnprocessed.values()),
    })

    // Apply changes to in-memory storage after successful DB write.

    const { sessions } = this
    assertDev(sessions !== undefined, "Can't commit unhydrated session storage")
    pendingSessions.forEach((value, key) => {
      sessions.set(key, value)
    })

    // const { senderKeys } = this
    // assertDev(senderKeys !== undefined, "Can't commit unhydrated sender key storage")
    // pendingSenderKeys.forEach((value, key) => {
    //   senderKeys.set(key, value)
    // })
  }

  private async revertZoneChanges(name: string, error: Error): Promise<void> {
    logger.info(
      `revertZoneChanges(${name}): ` +
        // `pending sender keys size ${this.pendingSenderKeys.size}, ` +
        `pending sessions size ${this.pendingSessions.size}, ` +
        `pending unprocessed size ${this.pendingUnprocessed.size}`,
      Errors.toLogFormat(error)
    )
    // this.pendingSenderKeys.clear()
    this.pendingSessions.clear()
    this.pendingUnprocessed.clear()
  }

  private isInTopLevelZone(): boolean {
    return this.currentZoneDepth === 1
  }

  private enterZone(zone: Zone, name: string): void {
    this.currentZoneDepth += 1
    if (this.currentZoneDepth === 1) {
      assertDev(this.currentZone === undefined, 'Should not be in the zone')
      this.currentZone = zone

      if (zone !== GLOBAL_ZONE) {
        logger.info(`SignalProtocolStore.enterZone(${zone.name}:${name})`)
      }
    }
  }

  private leaveZone(zone: Zone): void {
    assertDev(this.currentZone === zone, 'Should be in the correct zone')

    this.currentZoneDepth -= 1
    assertDev(this.currentZoneDepth >= 0, 'Unmatched number of leaveZone calls')

    // Since we allow re-entering zones we might actually be in two overlapping
    // async calls. Leave the zone and yield to another one only if there are
    // no active zone users anymore.
    if (this.currentZoneDepth !== 0) {
      return
    }

    if (zone !== GLOBAL_ZONE) {
      logger.info(`SignalProtocolStore.leaveZone(${zone.name})`)
    }

    this.currentZone = undefined

    const next = this.zoneQueue.shift()
    if (!next) {
      return
    }

    const toEnter = [next]

    while (this.zoneQueue[0]?.zone === next.zone) {
      const elem = this.zoneQueue.shift()
      assertDev(elem, 'Zone element should be present')

      toEnter.push(elem)
    }

    logger.info(`SignalProtocolStore: running blocked ${toEnter.length} jobs in zone ${next.zone.name}`)
    toEnter.forEach(({ callback }) => callback())
  }

  async loadSession(
    qualifiedAddress: QualifiedAddress,
    { zone = GLOBAL_ZONE }: SessionTransactionOptions = {}
  ): Promise<SessionRecord | undefined> {
    return this.withZone(zone, 'loadSession', async () => {
      if (!this.sessions) {
        throw new Error('loadSession: this.sessions not yet cached!')
      }

      if (qualifiedAddress == null) {
        throw new Error('loadSession: qualifiedAddress was undefined/null')
      }

      const id = qualifiedAddress.toString()

      try {
        const map = this.pendingSessions.has(id) ? this.pendingSessions : this.sessions
        const entry = map.get(id)

        if (!entry) {
          return undefined
        }

        if (entry.item) {
          return entry.item
        }

        // We'll either just hydrate the item or we'll fully migrate the session
        //   and save it to the database.
        return await this._maybeMigrateSession(entry.fromDB, { zone })
      } catch (error) {
        const errorString = Errors.toLogFormat(error)
        logger.error(`loadSession: failed to load session ${id}: ${errorString}`)
        return undefined
      }
    })
  }

  async loadSessions(
    qualifiedAddresses: Array<QualifiedAddress>,
    { zone = GLOBAL_ZONE }: SessionTransactionOptions = {}
  ): Promise<Array<SessionRecord>> {
    return this.withZone(zone, 'loadSessions', async () => {
      const sessions = await Promise.all(
        qualifiedAddresses.map(async (address) => (await this.loadSession(address, { zone }))!)
      )

      return sessions.filter((it) => it)
    })
  }

  private async _maybeMigrateSession(
    session: SessionType,
    { zone = GLOBAL_ZONE }: SessionTransactionOptions = {}
  ): Promise<SessionRecord> {
    if (!this.sessions) {
      throw new Error('_maybeMigrateSession: this.sessions not yet cached!')
    }

    // Not yet converted, need to translate to new format and save
    if (session.version !== undefined) {
      throw new Error('_maybeMigrateSession: Unknown session version type!')
    }

    // const item = SessionRecord.deserialize(Buffer.from(session.record, 'base64'))
    const item = SessionRecord.deserialize(session.record)

    const id: SessionIdType = `${session.ourId}:${session.theirId}.${session.deviceId}`

    const map = this.pendingSessions.has(id) ? this.pendingSessions : this.sessions
    map.set(id, { item, fromDB: session })

    return item
  }

  async storeSession(
    qualifiedAddress: QualifiedAddress,
    record: SessionRecord,
    { zone = GLOBAL_ZONE }: SessionTransactionOptions = {}
  ): Promise<void> {
    await this.withZone(zone, 'storeSession', async () => {
      if (!this.sessions) {
        throw new Error('storeSession: this.sessions not yet cached!')
      }

      if (qualifiedAddress == null) {
        throw new Error('storeSession: qualifiedAddress was undefined/null')
      }
      const { ourAccountId, identifier, deviceId } = qualifiedAddress

      const conversation = await window.Ready.conversationController.getOrCreate(
        'SignalPS.storeSession',
        ourAccountId.toString(),
        identifier.toString(),
        ConversationType.PRIVATE,
        undefined
      )
      strictAssert(conversation !== undefined, 'storeSession: Ensure contact ids failed')
      const id = qualifiedAddress.toString()

      try {
        const fromDB: SessionType = {
          id,
          version: 2,
          ourId: ourAccountId.toString(),
          theirId: identifier.toString(),
          deviceId,
          conversationId: conversation.id,
          record: record.serialize(), // .toString('base64'),
        }

        const newSession: SessionCacheEntry = { fromDB, item: record }

        assertDev(this.currentZone, 'Must run in the zone')

        this.pendingSessions.set(id, newSession)

        // Current zone doesn't support pending sessions - commit immediately
        if (!zone.supportsPendingSessions()) {
          await this.commitZoneChanges('storeSession')
        }
      } catch (error) {
        const errorString = Errors.toLogFormat(error)
        logger.error(`storeSession: Save failed for ${id}: ${errorString}`)
        throw error
      }
    })
  }

  async getOpenDevices(
    tag: string,
    ourAccountId: string,
    identifiers: ReadonlyArray<string>,
    { zone = GLOBAL_ZONE }: SessionTransactionOptions = {}
  ): Promise<{
    devices: Array<DeviceType>
    emptyIdentifiers: Array<string>
  }> {
    return this.withZone(zone, 'getOpenDevices', async () => {
      if (!this.sessions) {
        throw new Error('getOpenDevices: this.sessions not yet cached!')
      }
      if (identifiers.length === 0) {
        return { devices: [], emptyIdentifiers: [] }
      }

      try {
        const uuidsOrIdentifiers = new Set(identifiers)

        const allSessions = this._getAllSessions()
        const entries = allSessions.filter(
          ({ fromDB }) => fromDB.ourId === ourAccountId && uuidsOrIdentifiers.has(fromDB.theirId)
        )
        const openEntries: Array<
          | undefined
          | {
              entry: SessionCacheEntry
              record: SessionRecord
            }
        > = await Promise.all(
          entries.map(async (entry) => {
            if (entry.item) {
              const record = entry.item
              if (record.haveOpenSession()) {
                return { record, entry }
              }

              return undefined
            }

            const record = await this._maybeMigrateSession(entry.fromDB, { zone })
            if (record.haveOpenSession()) {
              return { record, entry }
            }

            return undefined
          })
        )

        const devices = openEntries
          .map((item) => {
            if (!item) {
              return undefined
            }
            const { entry, record } = item

            const { theirId: accountId } = entry.fromDB
            uuidsOrIdentifiers.delete(accountId)

            const id = entry.fromDB.deviceId

            const registrationId = record.remoteRegistrationId()

            return {
              identifier: accountId,
              id,
              registrationId,
            }
          })
          .filter((it) => it)
        const emptyIdentifiers = Array.from(uuidsOrIdentifiers.values())

        return {
          devices,
          emptyIdentifiers,
        }
      } catch (error) {
        logger.error('getOpenDevices: Failed to get devices', Errors.toLogFormat(error))
        throw error
      }
    })
  }

  async getDeviceIds(
    tag: string,
    {
      accountId,
      identifier,
    }: Readonly<{
      accountId: AccountIdStringType
      identifier: string
    }>
  ): Promise<Array<number>> {
    const { devices } = await this.getOpenDevices(tag, accountId, [identifier])
    return devices.map((device) => device.id)
  }

  async removeSession(qualifiedAddress: QualifiedAddress): Promise<void> {
    return this.withZone(GLOBAL_ZONE, 'removeSession', async () => {
      if (!this.sessions) {
        throw new Error('removeSession: this.sessions not yet cached!')
      }

      const id = qualifiedAddress.toString()
      logger.info('removeSession: deleting session for', id)
      try {
        await window.Ready.Data.removeSignalSessionById(id)
        this.sessions.delete(id)
        this.pendingSessions.delete(id)
      } catch (e) {
        logger.error(`removeSession: Failed to delete session for ${id}`)
      }
    })
  }

  async removeSessionsByConversation(accountId: string, identifier: string): Promise<void> {
    return this.withZone(GLOBAL_ZONE, 'removeSessionsByConversation', async () => {
      if (!this.sessions) {
        throw new Error('removeSessionsByConversation: this.sessions not yet cached!')
      }

      if (accountId == null) {
        throw new Error('removeSessionsByConversation: accountId was undefined/null')
      }
      if (identifier == null) {
        throw new Error('removeSessionsByConversation: identifier was undefined/null')
      }

      logger.info(`removeSessionsByConversation: deleting sessions for ${accountId} | ${identifier}`)

      const id = await window.Ready.conversationController.getConversationId(accountId, identifier)
      strictAssert(id, `removeSessionsByConversation: Conversation not found: ${accountId} | ${identifier}`)

      const entries = Array.from(this.sessions.values())

      for (let i = 0, max = entries.length; i < max; i += 1) {
        const entry = entries[i]!
        if (entry.fromDB.conversationId === id) {
          this.sessions.delete(entry.fromDB.id)
          this.pendingSessions.delete(entry.fromDB.id)
        }
      }

      await window.Ready.Data.clearSignalSessions(id)
    })
  }

  async removeSessionsByAccountID(accountId: string): Promise<void> {
    return this.withZone(GLOBAL_ZONE, 'removeSessionsByAccountID', async () => {
      if (!this.sessions) {
        throw new Error('removeSessionsByAccountID: this.sessions not yet cached!')
      }

      logger.info('removeSessionsByAccountID: deleting sessions for', accountId)

      const entries = Array.from(this.sessions.values())

      for (let i = 0, max = entries.length; i < max; i += 1) {
        const entry = entries[i]!
        if (entry.fromDB.theirId === accountId) {
          this.sessions.delete(entry.fromDB.id)
          this.pendingSessions.delete(entry.fromDB.id)
        }
      }

      await window.Ready.Data.removeSignalSessionByAccountId(accountId)
    })
  }

  private async _archiveSession(entry?: SessionCacheEntry, zone?: Zone) {
    if (!entry) {
      return
    }

    const addr = QualifiedAddress.parse(entry.fromDB.id)

    await this.enqueueSessionJob(
      addr,
      async () => {
        const item = entry.item ? entry.item : await this._maybeMigrateSession(entry.fromDB, { zone })

        if (!item.haveOpenSession()) {
          return
        }

        item.archiveCurrentState()

        await this.storeSession(addr, item, { zone })
      },
      zone
    )
  }

  async archiveSession(qualifiedAddress: QualifiedAddress): Promise<void> {
    return this.withZone(GLOBAL_ZONE, 'archiveSession', async () => {
      if (!this.sessions) {
        throw new Error('archiveSession: this.sessions not yet cached!')
      }

      const id = qualifiedAddress.toString()

      logger.info(`archiveSession: session for ${id}`)

      const entry = this.pendingSessions.get(id) || this.sessions.get(id)

      await this._archiveSession(entry)
    })
  }

  async archiveSiblingSessions(
    encodedAddress: Address,
    { zone = GLOBAL_ZONE }: SessionTransactionOptions = {}
  ): Promise<void> {
    return this.withZone(zone, 'archiveSiblingSessions', async () => {
      if (!this.sessions) {
        throw new Error('archiveSiblingSessions: this.sessions not yet cached!')
      }

      logger.info('archiveSiblingSessions: archiving sibling sessions for', encodedAddress.toString())

      const { identifier: theirId, deviceId } = encodedAddress

      const allEntries = this._getAllSessions()
      const entries = allEntries.filter(
        (entry) => entry.fromDB.theirId === theirId.toString() && entry.fromDB.deviceId !== deviceId
      )

      await Promise.all(
        entries.map(async (entry) => {
          await this._archiveSession(entry, zone)
        })
      )
    })
  }

  async archiveAllSessions(theirId: ReadyAddress): Promise<void> {
    return this.withZone(GLOBAL_ZONE, 'archiveAllSessions', async () => {
      if (!this.sessions) {
        throw new Error('archiveAllSessions: this.sessions not yet cached!')
      }

      logger.info('archiveAllSessions: archiving all sessions for', theirId)

      const allEntries = this._getAllSessions()
      const entries = allEntries.filter((entry) => entry.fromDB.theirId === theirId.toString())

      await Promise.all(
        entries.map(async (entry) => {
          await this._archiveSession(entry)
        })
      )
    })
  }

  async clearSessionStore(): Promise<void> {
    return this.withZone(GLOBAL_ZONE, 'clearSessionStore', async () => {
      if (this.sessions) {
        this.sessions.clear()
      }
      this.pendingSessions.clear()
      await window.Ready.Data.removeAllSignalSessions()
    })
  }

  // async lightSessionReset(qualifiedAddress: QualifiedAddress): Promise<void> {
  //   const id = qualifiedAddress.toString();

  //   const sessionResets = window.storage.get(
  //     'sessionResets',
  //     {} as SessionResetsType
  //   );

  //   const lastReset = sessionResets[id];

  //   const ONE_HOUR = 60 * 60 * 1000;
  //   if (lastReset && isMoreRecentThan(lastReset, ONE_HOUR)) {
  //     logger.warn(
  //       `lightSessionReset/${id}: Skipping session reset, last reset at ${lastReset}`
  //     );
  //     return;
  //   }

  //   sessionResets[id] = Date.now();
  //   await window.storage.put('sessionResets', sessionResets);

  //   try {
  //     const { uuid } = qualifiedAddress;

  //     // First, fetch this conversation
  //     const conversation = window.ConversationController.lookupOrCreate({
  //       uuid: uuid.toString(),
  //       reason: 'SignalProtocolStore.lightSessionReset',
  //     });
  //     assertDev(conversation, `lightSessionReset/${id}: missing conversation`);

  //     logger.warn(`lightSessionReset/${id}: Resetting session`);

  //     // Archive open session with this device
  //     await this.archiveSession(qualifiedAddress);

  //     // Enqueue a null message with newly-created session
  //     await conversationJobQueue.add({
  //       type: 'NullMessage',
  //       conversationId: conversation.id,
  //       idForTracking: id,
  //     });
  //   } catch (error) {
  //     // If we failed to queue the session reset, then we'll allow another attempt sooner
  //     //   than one hour from now.
  //     delete sessionResets[id];
  //     await window.storage.put('sessionResets', sessionResets);

  //     logger.error(
  //       `lightSessionReset/${id}: Encountered error`,
  //       Errors.toLogFormat(error)
  //     );
  //   }
  // }

  // Identity Keys

  getIdentityRecord(ourId: AccountIdStringType, theirId: ReadyAddress): IdentityKeyType | undefined {
    if (!this.identityKeys) {
      throw new Error('getIdentityRecord: this.identityKeys not yet cached!')
    }

    try {
      const entry = this.identityKeys.get(`${ourId}:${theirId.toString()}`)
      if (!entry) {
        return undefined
      }

      return entry.fromDB
    } catch (e) {
      logger.error(`getIdentityRecord: Failed to get identity record for identifier ${theirId}`)
      return undefined
    }
  }

  async getOrMigrateIdentityRecord(
    ourId: AccountIdStringType,
    theirId: ReadyAddress
  ): Promise<IdentityKeyType | undefined> {
    if (!this.identityKeys) {
      throw new Error('getOrMigrateIdentityRecord: this.identityKeys not yet cached!')
    }

    // TODO: migrate to new IdentityKey data structure
    return this.getIdentityRecord(ourId, theirId)
  }

  // https://github.com/signalapp/Signal-Android/blob/fc3db538bcaa38dc149712a483d3032c9c1f3998/app/src/main/java/org/thoughtcrime/securesms/crypto/storage/SignalBaseIdentityKeyStore.java#L128
  async isTrustedIdentity(
    ourId: AccountIdStringType,
    encodedAddress: Address,
    publicKey: Uint8Array,
    direction: Direction
  ): Promise<boolean> {
    if (!this.identityKeys) {
      throw new Error('isTrustedIdentity: this.identityKeys not yet cached!')
    }

    if (encodedAddress == null) {
      throw new Error('isTrustedIdentity: encodedAddress was undefined/null')
    }

    const identityRecord = await this.getOrMigrateIdentityRecord(ourId, encodedAddress.identifier)

    // const isOurIdentifier = window.textsecure.storage.user.isOurUuid(encodedAddress.identifier)
    // if (isOurIdentifier) {
    //   if (identityRecord && identityRecord.publicKey) {
    //     return constantTimeEqual(identityRecord.publicKey, publicKey);
    //   }
    //   logger.warn(
    //     'isTrustedIdentity: No local record for our own identifier. Returning true.'
    //   );
    //   return true;
    // }

    switch (direction) {
      case Direction.Sending:
        return this.isTrustedForSending(encodedAddress.identifier, publicKey, identityRecord)
      case Direction.Receiving:
        return true
      default:
        throw new Error(`isTrustedIdentity: Unknown direction: ${direction}`)
    }
  }

  // https://github.com/signalapp/Signal-Android/blob/fc3db538bcaa38dc149712a483d3032c9c1f3998/app/src/main/java/org/thoughtcrime/securesms/crypto/storage/SignalBaseIdentityKeyStore.java#L233
  isTrustedForSending(theirId: ReadyAddress, publicKey: Uint8Array, identityRecord?: IdentityKeyType): boolean {
    if (!identityRecord) {
      return true
    }

    const existing = identityRecord.publicKey

    if (!existing) {
      logger.info('isTrustedForSending: Nothing here, returning true...')
      return true
    }
    if (!constantTimeEqual(existing, publicKey)) {
      logger.info("isTrustedForSending: Identity keys don't match...")
      return false
    }
    if (identityRecord.verified === VerifiedStatus.UNVERIFIED) {
      logger.error('isTrustedForSending: Needs unverified approval!')
      return false
    }
    if (this.isNonBlockingApprovalRequired(identityRecord)) {
      logger.error('isTrustedForSending: Needs non-blocking approval!')
      return false
    }

    return true
  }

  async loadIdentityKey(ourId: string, theirId: ReadyAddress): Promise<Uint8Array | undefined> {
    if (!ourId) {
      throw new Error('loadIdentityKey: ourId was undefined/null')
    }
    if (!theirId) {
      throw new Error('loadIdentityKey: theirId was undefined/null')
    }
    const identityRecord = await this.getOrMigrateIdentityRecord(ourId, theirId)

    if (identityRecord) {
      return identityRecord.publicKey
    }

    return undefined
  }

  async getFingerprint(ourId: string, identifier: ReadyAddress): Promise<string | undefined> {
    if (ourId == null) {
      throw new Error('loadIdentityKey: ourId was undefined/null')
    }
    if (!identifier) {
      throw new Error('loadIdentityKey: identifier was undefined/null')
    }

    const pubKey = await this.loadIdentityKey(ourId, identifier)

    if (!pubKey) {
      return undefined
    }

    const hash = sha256(pubKey)
    const fingerprint = hash.slice(0, 4)

    return Bytes.toBase64(fingerprint)
  }

  private async _saveIdentityKey(data: Omit<IdentityKeyType, 'id'>): Promise<void> {
    if (!this.identityKeys) {
      throw new Error('_saveIdentityKey: this.identityKeys not yet cached!')
    }

    const id: IdentityKeyIdType = `${data.ourId}:${data.theirId}`

    await window.Ready.Data.createOrUpdateSignalIdentityKey({ ...data, id })
    this.identityKeys.set(id, { fromDB: { ...data, id } })
  }

  // https://github.com/signalapp/Signal-Android/blob/fc3db538bcaa38dc149712a483d3032c9c1f3998/app/src/main/java/org/thoughtcrime/securesms/crypto/storage/SignalBaseIdentityKeyStore.java#L69
  async saveIdentity(
    ourId: AccountIdStringType,
    encodedAddress: Address,
    publicKey: Uint8Array,
    nonblockingApproval = false,
    { zone }: SessionTransactionOptions = {}
  ): Promise<boolean> {
    if (!this.identityKeys) {
      throw new Error('saveIdentity: this.identityKeys not yet cached!')
    }

    if (encodedAddress == null) {
      throw new Error('saveIdentity: encodedAddress was undefined/null')
    }

    if (!(publicKey instanceof Uint8Array)) {
      publicKey = Bytes.fromBinary(publicKey)
    }
    if (typeof nonblockingApproval !== 'boolean') {
      nonblockingApproval = false
    }

    return this._getIdentityQueue(encodedAddress.identifier).add(async () => {
      const identityRecord = await this.getOrMigrateIdentityRecord(ourId, encodedAddress.identifier)

      const theirId = encodedAddress.identifier.toString()
      const logId = `saveIdentity(${theirId})`

      if (!identityRecord || !identityRecord.publicKey) {
        // Lookup failed, or the current key was removed, so save this one.
        logger.info(`${logId}: Saving new identity...`)
        await this._saveIdentityKey({
          ourId,
          theirId,
          publicKey,
          firstUse: true,
          timestamp: Date.now(),
          verified: VerifiedStatus.DEFAULT,
          nonblockingApproval,
        })

        // this.checkPreviousKey(encodedAddress.accountId, publicKey, 'saveIdentity')

        return false
      }

      const identityKeyChanged = !constantTimeEqual(identityRecord.publicKey, publicKey)

      if (identityKeyChanged) {
        // const isOurIdentifier = window.textsecure.storage.user.isOurUuid(
        //   encodedAddress.uuid
        // );

        // if (isOurIdentifier && identityKeyChanged) {
        //   logger.warn(`${logId}: ignoring identity for ourselves`);
        //   return false;
        // }

        logger.info(`${logId}: Replacing existing identity...`)
        const previousStatus = identityRecord.verified
        let verifiedStatus: number
        if (previousStatus === VerifiedStatus.VERIFIED || previousStatus === VerifiedStatus.UNVERIFIED) {
          verifiedStatus = VerifiedStatus.UNVERIFIED
        } else {
          verifiedStatus = VerifiedStatus.DEFAULT
        }

        await this._saveIdentityKey({
          ourId,
          theirId,
          publicKey,
          firstUse: false,
          timestamp: Date.now(),
          verified: verifiedStatus,
          nonblockingApproval,
        })

        // See `addKeyChange` in `ts/models/conversations.ts` for sender key info
        // update caused by this.
        try {
          this.emit('keychange', encodedAddress.identifier, 'saveIdentity - change')
        } catch (error) {
          logger.error(`${logId}: error triggering keychange:`, Errors.toLogFormat(error))
        }

        // Pass the zone to facilitate transactional session use in
        // MessageReceiver.ts
        await this.archiveSiblingSessions(encodedAddress, {
          zone,
        })

        return true
      }
      if (this.isNonBlockingApprovalRequired(identityRecord)) {
        logger.info(`${logId}: Setting approval status...`)

        identityRecord.nonblockingApproval = nonblockingApproval
        await this._saveIdentityKey(identityRecord)

        return false
      }

      return false
    })
  }

  // https://github.com/signalapp/Signal-Android/blob/fc3db538bcaa38dc149712a483d3032c9c1f3998/app/src/main/java/org/thoughtcrime/securesms/crypto/storage/SignalBaseIdentityKeyStore.java#L257
  private isNonBlockingApprovalRequired(identityRecord: IdentityKeyType): boolean {
    return (
      !identityRecord.firstUse &&
      isMoreRecentThan(identityRecord.timestamp, TIMESTAMP_THRESHOLD) &&
      !identityRecord.nonblockingApproval
    )
  }

  async saveIdentityWithAttributes(
    ourId: AccountIdStringType,
    theirId: ReadyAddress,
    attributes: Partial<IdentityKeyType>
  ): Promise<void> {
    return this._getIdentityQueue(theirId).add(async () =>
      this.saveIdentityWithAttributesOnQueue(ourId, theirId, attributes)
    )
  }

  private async saveIdentityWithAttributesOnQueue(
    ourId: AccountIdStringType,
    theirId: ReadyAddress,
    attributes: Partial<IdentityKeyType>
  ): Promise<void> {
    if (ourId == null) {
      throw new Error('saveIdentityWithAttributes: accountId was undefined/null')
    }
    if (theirId == null) {
      throw new Error('saveIdentityWithAttributes: theirId was undefined/null')
    }

    const identityRecord = await this.getOrMigrateIdentityRecord(ourId, theirId)
    const id = theirId.toString()

    // When saving a PNI identity - don't create a separate conversation
    // const uuidKind = window.textsecure.storage.user.getOurUuidKind(uuid);
    // if (uuidKind !== UUIDKind.PNI) {
    //   window.ConversationController.getOrCreate(id, 'private');
    // }

    const updates: Omit<IdentityKeyType, 'id'> = {
      ...identityRecord,
      ...attributes,
      ourId,
      theirId: id,
    }

    if (validateIdentityKey(updates)) {
      await this._saveIdentityKey(updates)
    }
  }

  // async setApproval(ourId: AccountIdStringType, theirId: ReadyAddress, nonblockingApproval: boolean): Promise<void> {
  //   if (ourId == null) {
  //     throw new Error('setApproval: ourId was undefined/null')
  //   }
  //   if (theirId == null) {
  //     throw new Error('setApproval: theirId was undefined/null')
  //   }
  //   if (typeof nonblockingApproval !== 'boolean') {
  //     throw new Error('setApproval: Invalid approval status')
  //   }

  //   return this._getIdentityQueue(theirId).add(async () => {
  //     const identityRecord = await this.getOrMigrateIdentityRecord(ourId, theirId)

  //     if (!identityRecord) {
  //       throw new Error(`setApproval: No identity record for ${theirId}`)
  //     }

  //     identityRecord.nonblockingApproval = nonblockingApproval
  //     await this._saveIdentityKey(identityRecord)
  //   })
  // }

  // https://github.com/signalapp/Signal-Android/blob/fc3db538bcaa38dc149712a483d3032c9c1f3998/app/src/main/java/org/thoughtcrime/securesms/crypto/storage/SignalBaseIdentityKeyStore.java#L215
  // and https://github.com/signalapp/Signal-Android/blob/fc3db538bcaa38dc149712a483d3032c9c1f3998/app/src/main/java/org/thoughtcrime/securesms/verify/VerifyDisplayFragment.java#L544
  // async setVerified(
  //   ourId: AccountIdStringType,
  //   theirId: UUID,
  //   verifiedStatus: number,
  //   extra: SetVerifiedExtra = {}
  // ): Promise<void> {
  //   if (ourId == null) {
  //     throw new Error('setVerified: ourId was undefined/null')
  //   }
  //   if (theirId == null) {
  //     throw new Error('setVerified: theirId was undefined/null')
  //   }
  //   if (!validateVerifiedStatus(verifiedStatus)) {
  //     throw new Error('setVerified: Invalid verified status')
  //   }

  //   return this._getIdentityQueue(theirId).add(async () => {
  //     const identityRecord = await this.getOrMigrateIdentityRecord(ourId, theirId)

  //     if (!identityRecord) {
  //       throw new Error(`setVerified: No identity record for ${theirId}`)
  //     }

  //     if (validateIdentityKey(identityRecord)) {
  //       await this._saveIdentityKey({
  //         ...identityRecord,
  //         ...extra,
  //         verified: verifiedStatus,
  //       })
  //     }
  //   })
  // }

  // async getVerified(accountId: string): Promise<number> {
  //   if (accountId == null) {
  //     throw new Error('getVerified: accountId was undefined/null')
  //   }

  //   const identityRecord = await this.getOrMigrateIdentityRecord(accountId)
  //   if (!identityRecord) {
  //     throw new Error(`getVerified: No identity record for ${accountId}`)
  //   }

  //   const verifiedStatus = identityRecord.verified
  //   if (validateVerifiedStatus(verifiedStatus)) {
  //     return verifiedStatus
  //   }

  //   return VerifiedStatus.DEFAULT
  // }

  // To track key changes across session switches, we save an old identity key on the
  //   conversation. Whenever we get a new identity key for that contact, we need to
  //   check it against that saved key - no need to pop a key change warning if it is
  //   the same!
  // checkPreviousKey(uuid: UUID, publicKey: Uint8Array, context: string): void {}

  // See https://github.com/signalapp/Signal-Android/blob/fc3db538bcaa38dc149712a483d3032c9c1f3998/app/src/main/java/org/thoughtcrime/securesms/database/IdentityDatabase.java#L184
  // async updateIdentityAfterSync(
  //   accountId: string,
  //   verifiedStatus: number,
  //   publicKey: Uint8Array
  // ): Promise<boolean> {
  //   strictAssert(
  //     validateVerifiedStatus(verifiedStatus),
  //     `Invalid verified status: ${verifiedStatus}`
  //   )

  //   return this._getIdentityQueue(accountId).add(async () => {
  //     const identityRecord = await this.getOrMigrateIdentityRecord(accountId)
  //     const hadEntry = identityRecord !== undefined
  //     const keyMatches = Boolean(
  //       identityRecord?.publicKey && constantTimeEqual(publicKey, identityRecord.publicKey)
  //     )
  //     const statusMatches = keyMatches && verifiedStatus === identityRecord?.verified

  //     if (!keyMatches || !statusMatches) {
  //       await this.saveIdentityWithAttributesOnQueue(accountId, {
  //         publicKey,
  //         verified: verifiedStatus,
  //         firstUse: !hadEntry,
  //         timestamp: Date.now(),
  //         nonblockingApproval: true,
  //       })
  //     }
  //     if (!hadEntry) {
  //       // this.checkPreviousKey(accountId, publicKey, 'updateIdentityAfterSync');
  //     } else if (hadEntry && !keyMatches) {
  //       try {
  //         this.emit('keychange', accountId, 'updateIdentityAfterSync - change')
  //       } catch (error) {
  //         logger.error(
  //           'updateIdentityAfterSync: error triggering keychange:',
  //           Errors.toLogFormat(error)
  //         )
  //       }
  //     }

  //     // See: https://github.com/signalapp/Signal-Android/blob/fc3db538bcaa38dc149712a483d3032c9c1f3998/app/src/main/java/org/thoughtcrime/securesms/database/RecipientDatabase.kt#L921-L936
  //     if (
  //       verifiedStatus === VerifiedStatus.VERIFIED &&
  //       (!hadEntry || identityRecord?.verified !== VerifiedStatus.VERIFIED)
  //     ) {
  //       // Needs a notification.
  //       return true
  //     }
  //     if (
  //       verifiedStatus !== VerifiedStatus.VERIFIED &&
  //       hadEntry &&
  //       identityRecord?.verified === VerifiedStatus.VERIFIED
  //     ) {
  //       // Needs a notification.
  //       return true
  //     }
  //     return false
  //   })
  // }

  isUntrusted(ourId: AccountIdStringType, theirId: ReadyAddress, timestampThreshold = TIMESTAMP_THRESHOLD): boolean {
    if (ourId == null) {
      throw new Error('isUntrusted: ourId was undefined/null')
    }
    if (theirId == null) {
      throw new Error('isUntrusted: theirId was undefined/null')
    }

    const identityRecord = this.getIdentityRecord(ourId, theirId)
    if (!identityRecord) {
      throw new Error(`isUntrusted: No identity record for ${theirId}`)
    }

    if (
      isMoreRecentThan(identityRecord.timestamp, timestampThreshold) &&
      !identityRecord.nonblockingApproval &&
      !identityRecord.firstUse
    ) {
      return true
    }

    return false
  }

  async removeIdentityKey(ourId: AccountIdStringType, theirId: ReadyAddress): Promise<void> {
    if (!this.identityKeys) {
      throw new Error('removeIdentityKey: this.identityKeys not yet cached!')
    }

    const id: IdentityKeyIdType = `${ourId}:${theirId.toString()}`
    this.identityKeys.delete(id)
    await window.Ready.Data.clearSignalIdentityKey(id)
    await this.removeSessionsByAccountID(id)
  }

  // Not yet processed messages - for resiliency
  // getUnprocessedCount(): Promise<number> {
  //   return this.withZone(GLOBAL_ZONE, 'getUnprocessedCount', async () =>
  //     window.Signal.Data.getUnprocessedCount()
  //   )
  // }

  getAllUnprocessedIds(): Promise<Array<string>> {
    return this.withZone(GLOBAL_ZONE, 'getAllUnprocessedIds', () => window.Ready.Data.getAllUnprocessedIds())
  }

  getUnprocessedByIdsAndIncrementAttempts(ids: ReadonlyArray<string>): Promise<Array<UnprocessedType>> {
    return this.withZone(GLOBAL_ZONE, 'getAllUnprocessedByIdsAndIncrementAttempts', async () =>
      window.Ready.Data.getUnprocessedByIdsAndIncrementAttempts(ids)
    )
  }

  getUnprocessedById(id: string): Promise<UnprocessedType | undefined> {
    return this.withZone(GLOBAL_ZONE, 'getUnprocessedById', async () => window.Ready.Data.getUnprocessedById(id))
  }

  addUnprocessed(data: UnprocessedType, { zone = GLOBAL_ZONE }: SessionTransactionOptions = {}): Promise<void> {
    return this.withZone(zone, 'addUnprocessed', async () => {
      this.pendingUnprocessed.set(data.id, data)

      // Current zone doesn't support pending unprocessed - commit immediately
      if (!zone.supportsPendingUnprocessed()) {
        await this.commitZoneChanges('addUnprocessed')
      }
    })
  }

  addMultipleUnprocessed(
    array: Array<UnprocessedType>,
    { zone = GLOBAL_ZONE }: SessionTransactionOptions = {}
  ): Promise<void> {
    return this.withZone(zone, 'addMultipleUnprocessed', async () => {
      array.forEach((elem) => {
        this.pendingUnprocessed.set(elem.id, elem)
      })
      // Current zone doesn't support pending unprocessed - commit immediately
      if (!zone.supportsPendingUnprocessed()) {
        await this.commitZoneChanges('addMultipleUnprocessed')
      }
    })
  }

  updateUnprocessedWithData(id: string, data: UnprocessedUpdateType): Promise<void> {
    return this.withZone(GLOBAL_ZONE, 'updateUnprocessedWithData', async () => {
      await window.Ready.Data.updateUnprocessedWithData(id, data)
    })
  }

  updateUnprocessedsWithData(items: Array<{ id: string; data: UnprocessedUpdateType }>): Promise<void> {
    return this.withZone(GLOBAL_ZONE, 'updateUnprocessedsWithData', async () => {
      await window.Ready.Data.updateUnprocessedsWithData(items)
    })
  }

  removeUnprocessed(idOrArray: string | Array<string>): Promise<void> {
    return this.withZone(GLOBAL_ZONE, 'removeUnprocessed', async () => {
      await window.Ready.Data.removeUnprocessed(idOrArray)
    })
  }

  /** only for testing */
  removeAllUnprocessed(): Promise<void> {
    logger.info('removeAllUnprocessed')
    return this.withZone(GLOBAL_ZONE, 'removeAllUnprocessed', async () => {
      await window.Ready.Data.removeAllUnprocessed()
    })
  }

  // async removeOurOldPni(oldPni: UUID): Promise<void> {}

  // async updateOurPniKeyMaterial(
  //   pni: UUID,
  //   {
  //     identityKeyPair: identityBytes,
  //     signedPreKey: signedPreKeyBytes,
  //     registrationId,
  //   }: PniKeyMaterialType
  // ): Promise<void> {}

  // async removeAllData(): Promise<void> {
  //   await window.Signal.Data.removeAll()
  //   await this.hydrateCaches()

  //   window.storage.reset()
  //   await window.storage.fetch()

  //   ConversationController.reset()
  //   await ConversationController.load()

  //   this.emit('removeAllData')
  // }

  // async removeAllConfiguration(mode: RemoveAllConfiguration): Promise<void> {
  //   await window.Signal.Data.removeAllConfiguration(mode)
  //   await this.hydrateCaches()

  //   window.storage.reset()
  //   await window.storage.fetch()
  // }

  // signAlternateIdentity(): PniSignatureMessageType | undefined {
  //   const ourACI = window.textsecure.storage.user.getCheckedUuid(UUIDKind.ACI);
  //   const ourPNI = window.textsecure.storage.user.getUuid(UUIDKind.PNI);
  //   if (!ourPNI) {
  //     logger.error('signAlternateIdentity: No local pni');
  //     return undefined;
  //   }

  //   if (this.cachedPniSignatureMessage?.pni === ourPNI.toString()) {
  //     return this.cachedPniSignatureMessage;
  //   }

  //   const aciKeyPair = this.getIdentityKeyPair(ourACI);
  //   const pniKeyPair = this.getIdentityKeyPair(ourPNI);
  //   if (!aciKeyPair) {
  //     logger.error('signAlternateIdentity: No local ACI key pair');
  //     return undefined;
  //   }
  //   if (!pniKeyPair) {
  //     logger.error('signAlternateIdentity: No local PNI key pair');
  //     return undefined;
  //   }

  //   const pniIdentity = new IdentityKeyPair(
  //     PublicKey.deserialize(Buffer.from(pniKeyPair.pubKey)),
  //     PrivateKey.deserialize(Buffer.from(pniKeyPair.privKey))
  //   );
  //   const aciPubKey = PublicKey.deserialize(Buffer.from(aciKeyPair.pubKey));
  //   this.cachedPniSignatureMessage = {
  //     pni: ourPNI.toString(),
  //     signature: pniIdentity.signAlternateIdentity(aciPubKey),
  //   };

  //   return this.cachedPniSignatureMessage;
  // }

  // async verifyAlternateIdentity({
  //   aci,
  //   pni,
  //   signature,
  // }: VerifyAlternateIdentityOptionsType): Promise<boolean> {
  //   const logId = `SignalProtocolStore.verifyAlternateIdentity(${aci}, ${pni})`;
  //   const aciPublicKeyBytes = await this.loadIdentityKey(aci);
  //   if (!aciPublicKeyBytes) {
  //     logger.warn(`${logId}: no ACI public key`);
  //     return false;
  //   }

  //   const pniPublicKeyBytes = await this.loadIdentityKey(pni);
  //   if (!pniPublicKeyBytes) {
  //     logger.warn(`${logId}: no PNI public key`);
  //     return false;
  //   }

  //   const aciPublicKey = PublicKey.deserialize(Buffer.from(aciPublicKeyBytes));
  //   const pniPublicKey = PublicKey.deserialize(Buffer.from(pniPublicKeyBytes));

  //   return pniPublicKey.verifyAlternateIdentity(
  //     aciPublicKey,
  //     Buffer.from(signature)
  //   );
  // }

  private _getAllSessions(): Array<SessionCacheEntry> {
    const union = new Map<string, SessionCacheEntry>()

    this.sessions?.forEach((value, key) => {
      union.set(key, value)
    })
    this.pendingSessions.forEach((value, key) => {
      union.set(key, value)
    })

    return Array.from(union.values())
  }

  //
  // EventEmitter types
  //

  public on(name: 'removePreKey', handler: (accountId: string) => unknown): this

  public on(name: 'keychange', handler: (theirAccountId: ReadyAddress, reason: string) => unknown): this

  public on(name: 'removeAllData', handler: () => unknown): this

  public on(eventName: string | symbol, listener: (...args: Array<any>) => void): this {
    return super.on(eventName, listener)
  }

  public emit(name: 'removePreKey', ourAccountId: AccountIdStringType): boolean

  public emit(name: 'keychange', theirAccountId: ReadyAddress, reason: string): boolean

  public emit(name: 'removeAllData'): boolean

  public emit(eventName: string | symbol, ...args: Array<any>): boolean {
    return super.emit(eventName, ...args)
  }
}

export function getSignalProtocolStore(): SignalProtocolStore {
  return new SignalProtocolStore()
}
