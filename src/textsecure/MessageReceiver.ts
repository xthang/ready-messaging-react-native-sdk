// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */
/* eslint-disable no-dupe-class-members */

import {
  DecryptionErrorMessage,
  PreKeySignalMessage,
  ProtocolAddress,
  signalDecrypt,
  signalDecryptPreKey,
  SignalMessage,
} from '@readyio/lib-messaging'
import { isBoolean } from 'lodash'
import PQueue from 'p-queue'

import {
  type DataMessage,
  type MessageDataV2,
  type SyncMessage,
  type SyncSentMessage,
  mapMessageContentTypeToDB,
} from 'types/chat'
import { type SocketEnvelop, SocketEnvelopType } from 'types/socket'
import { strictAssert } from 'utils/assert'
import * as Bytes from 'utils/Bytes'
import { logger as log } from 'utils/logger'
import { parseSocketMessage } from '../helpers'
import { IdentityKeys, PreKeys, Sessions, SignedPreKeys } from '../LibSignalStores'
import { SignalProtocolStore } from '../SignalProtocolStore'
import { type AccountIdStringType } from '../types/Account'
import { Address } from '../types/Address'
import * as Errors from '../types/errors'
import { QualifiedAddress } from '../types/QualifiedAddress'
import { UUID, type UUIDStringType } from '../types/UUID'
import { type BatcherType, createBatcher } from '../utils/batcher'
import * as durations from '../utils/durations'
import { type SendTypesType } from '../utils/handleMessageSend'
import { chunk } from '../utils/iterables'
import { Zone } from '../utils/Zone'
import EventTarget, { type EventHandler } from './EventTarget'
import {
  DecryptionErrorEvent,
  DeliveryEvent,
  EnvelopeEvent,
  MessageEvent,
  ProgressEvent,
  ReadEvent,
  RetryRequestEvent,
  SentEvent,
  TypingEvent,
  ViewEvent,
} from './messageReceiverEvents'
import createTaskWithTimeout from './TaskWithTimeout'
import { type ProcessedDataMessage, type ProcessedEnvelope, type UnprocessedType } from './Types.d'

const RETRY_TIMEOUT = 2 * 60 * 1000

type UnsealedEnvelope = Readonly<
  Omit<ProcessedEnvelope, 'sourceAddress' | 'sourceUuid' | 'publicGroupId'> & {
    sourceAddress: string
    sourceUuid: UUIDStringType
    // unidentifiedDeliveryReceived?: boolean
    // contentHint?: number
    groupId?: UUIDStringType
    // cipherTextBytes?: Uint8Array
    // cipherTextType?: number
    // certificate?: SenderCertificate
    // unsealedContent?: UnidentifiedSenderMessageContent
  }
>

type DecryptResult = Readonly<
  | {
      envelope: UnsealedEnvelope
      plaintext: Uint8Array
    }
  | {
      envelope?: UnsealedEnvelope
      plaintext?: undefined
    }
>

// type DecryptSealedSenderResult = Readonly<{
//   plaintext?: Uint8Array
//   unsealedPlaintext?: SealedSenderDecryptionResult
//   wasEncrypted: boolean
// }>

type InnerDecryptResultType = Readonly<{
  plaintext: Uint8Array
  wasEncrypted: boolean
}>

type CacheAddItemType = {
  envelope: ProcessedEnvelope
  data: UnprocessedType
}

type LockedStores = {
  // readonly senderKeyStore: SenderKeys
  readonly sessionStore: Sessions
  readonly identityKeyStore: IdentityKeys
  readonly zone?: Zone
}

enum TaskType {
  Encrypted = 'Encrypted',
  Decrypted = 'Decrypted',
}

export type MessageReceiverOptions = {
  protocol: SignalProtocolStore
  // downloadAttachment: (params: {
  //   spaceId: string
  //   attachmentId: string
  //   conversationId: string
  //   name: string
  //   secure?: boolean
  //   decryptionKey?: string
  //   fileType?: AttachmentType
  //   groupId?: string
  // }) => Promise<void>
}

const TASK_WITH_TIMEOUT_OPTIONS = {
  timeout: 2 * durations.MINUTE,
}

const LOG_UNEXPECTED_URGENT_VALUES = false
const MUST_BE_URGENT_TYPES: Array<SendTypesType> = ['message', 'deleteForEveryone', 'reaction', 'readSync']
const CAN_BE_URGENT_TYPES: Array<SendTypesType> = [
  'callingMessage',
  'senderKeyDistributionMessage',

  // Deprecated
  'resetSession',
  'legacyGroupChange',
]

function logUnexpectedUrgentValue(envelope: ProcessedEnvelope, type: SendTypesType) {
  if (!LOG_UNEXPECTED_URGENT_VALUES) {
    return
  }

  const mustBeUrgent = MUST_BE_URGENT_TYPES.includes(type)
  const canBeUrgent = mustBeUrgent || CAN_BE_URGENT_TYPES.includes(type)

  if (envelope.urgent && !canBeUrgent) {
    const envelopeId = getEnvelopeId(envelope)
    log.warn(`${envelopeId}: Message of type '${type}' was marked urgent, but shouldn't be!`)
  }
  if (!envelope.urgent && mustBeUrgent) {
    const envelopeId = getEnvelopeId(envelope)
    log.warn(`${envelopeId}: Message of type '${type}' wasn't marked urgent, but should be!`)
  }
}

function getEnvelopeId(envelope: ProcessedEnvelope): string {
  const { timestamp } = envelope

  let prefix = ''

  if (envelope.sourceUuid || envelope.sourceAddress) {
    const sender = envelope.sourceUuid || envelope.sourceAddress
    prefix += `${sender}.${envelope.sourceDevice} `
  }

  prefix += `> ${envelope.destinationUuid?.toString() ?? `gr-${envelope.groupId}`}`

  return `${prefix} ${timestamp} (${envelope.id})`
}

export default class MessageReceiver extends EventTarget {
  private protocol: SignalProtocolStore

  // private downloadAttachment: (params: {
  //   spaceId: string
  //   attachmentId: string
  //   conversationId: string
  //   name: string
  //   secure?: boolean
  //   decryptionKey?: string
  //   fileType?: AttachmentType
  //   groupId?: string
  // }) => Promise<void>

  private appQueue: PQueue

  private decryptAndCacheBatcher: BatcherType<CacheAddItemType>

  private cacheRemoveBatcher: BatcherType<string>

  private count: number

  private processedCount: number

  private incomingQueue: PQueue

  private isEmptied?: boolean

  private encryptedQueue: PQueue

  private decryptedQueue: PQueue

  private retryCachedTimeout: NodeJS.Timeout | undefined

  private stoppingProcessing?: boolean

  constructor({ protocol }: MessageReceiverOptions) {
    log.log('------- init MessageReceiver')

    super()

    this.protocol = protocol
    // this.downloadAttachment = downloadAttachment

    this.count = 0
    this.processedCount = 0

    this.incomingQueue = new PQueue({
      concurrency: 1,
      throwOnTimeout: true,
    })
    this.appQueue = new PQueue({
      concurrency: 1,
      throwOnTimeout: true,
    })

    // All envelopes start in encryptedQueue and progress to decryptedQueue
    this.encryptedQueue = new PQueue({
      concurrency: 1,
      throwOnTimeout: true,
    })
    this.decryptedQueue = new PQueue({
      concurrency: 1,
      throwOnTimeout: true,
    })

    this.decryptAndCacheBatcher = createBatcher<CacheAddItemType>({
      name: 'MessageReceiver.decryptAndCacheBatcher',
      wait: 75,
      maxSize: 30,
      processBatch: (items: Array<CacheAddItemType>) => {
        // Not returning the promise here because we don't want to stall the batch.
        this.decryptAndCacheBatch(items)
      },
    })
    this.cacheRemoveBatcher = createBatcher<string>({
      name: 'MessageReceiver.cacheRemoveBatcher',
      wait: 75,
      maxSize: 30,
      processBatch: this.cacheRemoveBatch.bind(this),
    })
  }

  public getAndResetProcessedCount(): number {
    const count = this.processedCount
    this.processedCount = 0
    return count
  }

  public handleNewMessage({
    account,
    envelope,
    background,
  }: {
    account: { id: string; address: string }
    envelope: SocketEnvelop
    background?: boolean
  }): void {
    console.log('<----- handleNewMessage:', account.id, account.address, background, envelope)
    const job = async () => {
      try {
        const processedEnvelope: ProcessedEnvelope = {
          // Make non-private envelope IDs dashless so they don't get redacted from logs
          id: envelope.guid.replace(/-/g, ''),
          guid: envelope.guid as UUIDStringType,
          ourAccountId: account.id,

          sourceUuid: envelope.source_uuid as UUIDStringType,
          sourceAddress: envelope.source,
          sourceDevice: envelope.source_device,

          destinationUuid: envelope.destination_uuid ? new UUID(envelope.destination_uuid) : undefined,

          conversationDestinationAddress: envelope.real_destination,
          groupId: envelope.destination as UUIDStringType,
          publicGroupMessageId: envelope.message_id,

          type: SocketEnvelopType[
            Object.fromEntries(Object.entries(SocketEnvelopType).map(([k, v]) => [v, k]))[envelope.type]!
          ],

          contentType: envelope.content,
          content:
            envelope.type === SocketEnvelopType.PLAINTEXT_CONTENT.valueOf()
              ? new TextEncoder().encode(envelope.message || envelope.legacy_message)
              : Buffer.from(envelope.message || envelope.legacy_message, 'binary'),

          timestamp: envelope.timestamp,
          // serverGuid: envelope.serverGuid,
          serverTimestamp: envelope.server_timestamp,
          // receivedAtCounter,
          receivedAt: Date.now(),
          // messageAgeSec,
        }

        this.decryptAndCacheBatcher.add({
          envelope: processedEnvelope,
          data: {
            id: processedEnvelope.id,
            guid: processedEnvelope.guid,

            accountId: account.id,

            version: 1,

            envelope: JSON.stringify(envelope),

            timestamp: processedEnvelope.receivedAt,
            // receivedAtCounter,

            attempts: 0,

            background,
          },
        })
        this.processedCount += 1
      } catch (e) {
        log.error('Error handling incoming message:', Errors.toLogFormat(e))
        await this.dispatchAndWait('websocket request', new ErrorEvent(e))
      }
    }

    this.incomingQueue.add(createTaskWithTimeout(job, 'incomingQueue/websocket', TASK_WITH_TIMEOUT_OPTIONS))
  }

  public reset(): void {
    // We always process our cache before processing a new websocket message
    this.incomingQueue.add(
      createTaskWithTimeout(async () => this.queueAllCached(), 'incomingQueue/queueAllCached', {
        timeout: 10 * durations.MINUTE,
      })
    )

    this.count = 0
    this.isEmptied = false
    this.stoppingProcessing = false
  }

  public stopProcessing(): void {
    log.info('MessageReceiver.stopProcessing')
    this.stoppingProcessing = true
  }

  public hasEmptied(): boolean {
    return Boolean(this.isEmptied)
  }

  public async drain(): Promise<void> {
    const waitForEncryptedQueue = async () =>
      this.addToQueue(
        async () => {
          log.info('drained')
        },
        'drain/waitForDecrypted',
        TaskType.Decrypted
      )

    const waitForIncomingQueue = async () =>
      this.addToQueue(waitForEncryptedQueue, 'drain/waitForEncrypted', TaskType.Encrypted)

    return this.incomingQueue.add(
      createTaskWithTimeout(waitForIncomingQueue, 'drain/waitForIncoming', TASK_WITH_TIMEOUT_OPTIONS)
    )
  }

  //
  // EventTarget types
  //

  // public addEventListener(name: 'empty', handler: (ev: EmptyEvent) => void): void

  // public addEventListener(name: 'progress', handler: (ev: ProgressEvent) => void): void

  public addEventListener(name: 'typing', handler: (ev: TypingEvent) => void): void

  public addEventListener(name: 'error', handler: (ev: ErrorEvent) => void): void

  public addEventListener(name: 'delivery', handler: (ev: DeliveryEvent) => void): void

  public addEventListener(name: 'decryption-error', handler: (ev: DecryptionErrorEvent) => void): void

  // public addEventListener(
  //   name: 'invalid-plaintext',
  //   handler: (ev: InvalidPlaintextEvent) => void
  // ): void

  public addEventListener(name: 'sent', handler: (ev: SentEvent) => void): void

  // public addEventListener(
  //   name: 'profileKeyUpdate',
  //   handler: (ev: ProfileKeyUpdateEvent) => void
  // ): void

  public addEventListener(name: 'message', handler: (ev: MessageEvent) => void): void

  // public addEventListener(name: 'retry-request', handler: (ev: RetryRequestEvent) => void): void

  public addEventListener(name: 'read', handler: (ev: ReadEvent) => void): void

  public addEventListener(name: 'view', handler: (ev: ViewEvent) => void): void

  // public addEventListener(name: 'configuration', handler: (ev: ConfigurationEvent) => void): void

  // public addEventListener(
  //   name: 'viewOnceOpenSync',
  //   handler: (ev: ViewOnceOpenSyncEvent) => void
  // ): void

  // public addEventListener(
  //   name: 'messageRequestResponse',
  //   handler: (ev: MessageRequestResponseEvent) => void
  // ): void

  // public addEventListener(name: 'fetchLatest', handler: (ev: FetchLatestEvent) => void): void

  // public addEventListener(name: 'keys', handler: (ev: KeysEvent) => void): void

  // public addEventListener(name: 'sticker-pack', handler: (ev: StickerPackEvent) => void): void

  // public addEventListener(name: 'readSync', handler: (ev: ReadSyncEvent) => void): void

  // public addEventListener(name: 'viewSync', handler: (ev: ViewSyncEvent) => void): void

  // public addEventListener(name: 'contactSync', handler: (ev: ContactSyncEvent) => void): void

  // public addEventListener(name: 'group', handler: (ev: GroupEvent) => void): void

  // public addEventListener(name: 'groupSync', handler: (ev: GroupSyncEvent) => void): void

  public addEventListener(name: 'envelope', handler: (ev: EnvelopeEvent) => void): void

  // public addEventListener(
  //   name: 'storyRecipientUpdate',
  //   handler: (ev: StoryRecipientUpdateEvent) => void
  // ): void

  // public addEventListener(name: 'callEventSync', handler: (ev: CallEventSyncEvent) => void): void

  public addEventListener(name: string, handler: EventHandler): void {
    return super.addEventListener(name, handler)
  }

  // public removeEventListener(name: string, handler: EventHandler): void {
  //   return super.removeEventListener(name, handler)
  // }

  //
  // Private
  //

  private async dispatchAndWait(id: string, event: Event): Promise<void> {
    this.appQueue.add(
      createTaskWithTimeout(
        async () => Promise.all(this.dispatchEvent(event)),
        `dispatchEvent(${event.type}, ${id})`,
        TASK_WITH_TIMEOUT_OPTIONS
      )
    )
  }

  // private calculateMessageAge(headers: ReadonlyArray<string>, serverTimestamp?: number): number {}

  private async addToQueue<T>(task: () => Promise<T>, id: string, taskType: TaskType): Promise<T> {
    if (taskType === TaskType.Encrypted) {
      this.count += 1
    }

    const queue = taskType === TaskType.Encrypted ? this.encryptedQueue : this.decryptedQueue

    try {
      return await queue.add(createTaskWithTimeout(task, id, TASK_WITH_TIMEOUT_OPTIONS))
    } finally {
      this.updateProgress(this.count)
    }
  }

  // private onEmpty(): void {}

  private updateProgress(count: number): void {
    // count by 10s
    if (count % 10 !== 0) {
      return
    }
    this.dispatchEvent(new ProgressEvent({ count }))
  }

  private async queueAllCached(): Promise<void> {
    if (this.stoppingProcessing) {
      log.info('MessageReceiver.queueAllCached: not running due to stopped processing')
      return
    }

    for await (const batch of this.getAllFromCache()) {
      const max = batch.length
      for (let i = 0; i < max; i += 1) {
        await this.queueCached(batch[i]!)
      }
    }
    log.info('MessageReceiver.queueAllCached - finished')
  }

  private async queueCached(item: UnprocessedType): Promise<void> {
    log.info('MessageReceiver.queueCached', item.id)
    try {
      const decoded: SocketEnvelop = JSON.parse(item.envelope!)

      // const ourAccountId = this.storage.user.getCheckedUuid()

      const envelope: ProcessedEnvelope = {
        id: item.id,
        guid: item.guid as UUIDStringType,

        ourAccountId: item.accountId,

        // Proto.Envelope fields
        type: decoded.type,

        sourceAddress: item.source,
        sourceUuid:
          (item.sourceUuid as UUIDStringType) || (decoded.source_uuid ? UUID.cast(decoded.source_uuid) : undefined),
        sourceDevice: decoded.source_device || item.sourceDevice,

        destinationUuid: new UUID(
          decoded.destination_uuid || item.destinationUuid // || ourAccountId.toString()
        ),
        // updatedPni: decoded.updatedPni ? new UUID(decoded.updatedPni) : undefined,

        conversationDestinationAddress: item.conversationDestinationAddress,

        contentType: decoded.content,
        content: new TextEncoder().encode(decoded.message || decoded.legacy_message),

        publicGroupMessageId: decoded.message_id,

        timestamp: decoded.timestamp,
        // receivedAtCounter: item.receivedAtCounter ?? item.timestamp,
        // receivedAtDate: item.receivedAtCounter == null ? Date.now() : item.timestamp,
        receivedAt: Date.now(),
        // messageAgeSec: item.messageAgeSec || 0,
        // serverGuid: decoded.serverGuid,
        serverTimestamp: item.serverTimestamp || decoded.server_timestamp,

        urgent: isBoolean(item.urgent) ? item.urgent : true,
        // story: Boolean(item.story),
        // reportingToken: item.reportingToken ? Bytes.fromBase64(item.reportingToken) : undefined,
      }

      const { decrypted } = item
      if (decrypted) {
        let payloadPlaintext: Uint8Array

        if (item.version === 2) {
          payloadPlaintext = Bytes.fromBase64(decrypted)
        } else if (typeof decrypted === 'string') {
          payloadPlaintext = Bytes.fromBinary(decrypted)
        } else {
          throw new Error('Cached decrypted value was not a string!')
        }

        strictAssert(envelope.sourceUuid, 'Decrypted envelope must have source uuid')

        // Pacify typescript
        const decryptedEnvelope: UnsealedEnvelope = {
          ...envelope,
          sourceAddress: envelope.sourceAddress!,
          sourceUuid: envelope.sourceUuid,
        }

        // Maintain invariant: encrypted queue => decrypted queue
        this.addToQueue(
          async () => {
            this.queueDecryptedEnvelope(decryptedEnvelope, payloadPlaintext, item.background)
          },
          `queueDecryptedEnvelope(${getEnvelopeId(decryptedEnvelope)})`,
          TaskType.Encrypted
        )
      } else {
        this.queueCachedEnvelope(item, envelope)
      }
    } catch (error) {
      log.error('queueCached error handling item', item.id, 'removing it. Error:', Errors.toLogFormat(error))

      try {
        const { id } = item
        await this.protocol.removeUnprocessed(id)
      } catch (deleteError) {
        log.error('queueCached error deleting item', item.id, 'Error:', Errors.toLogFormat(deleteError))
      }
    }
  }

  private clearRetryTimeout(): void {
    if (this.retryCachedTimeout) clearTimeout(this.retryCachedTimeout)
    this.retryCachedTimeout = undefined
  }

  private maybeScheduleRetryTimeout(): void {
    if (this.isEmptied) {
      this.clearRetryTimeout()
      this.retryCachedTimeout = setTimeout(() => {
        this.incomingQueue.add(
          createTaskWithTimeout(async () => this.queueAllCached(), 'queueAllCached', TASK_WITH_TIMEOUT_OPTIONS)
        )
      }, RETRY_TIMEOUT)
    }
  }

  private async *getAllFromCache(): AsyncIterable<Array<UnprocessedType>> {
    log.info('getAllFromCache')

    const ids = await this.protocol.getAllUnprocessedIds()

    log.info(`getAllFromCache - ${ids.length} unprocessed`)

    for (const batch of chunk(ids, 1000)) {
      log.info(`getAllFromCache - yielding batch of ${batch.length}`)
      yield this.protocol.getUnprocessedByIdsAndIncrementAttempts(batch)
    }
    log.info(`getAllFromCache - done retrieving ${ids.length} unprocessed`)
  }

  private async decryptAndCacheBatch(items: Array<CacheAddItemType>): Promise<void> {
    // log.info('--  MessageReceiver.decryptAndCacheBatch', items.length)

    const decrypted: Array<
      Readonly<{
        plaintext: Uint8Array
        data: UnprocessedType
        envelope: UnsealedEnvelope
      }>
    > = []

    const storageProtocol = window.Ready.protocol

    try {
      const zone = new Zone('decryptAndCacheBatch', {
        pendingSenderKeys: true,
        pendingSessions: true,
        pendingUnprocessed: true,
      })

      const storesMap = new Map<AccountIdStringType, LockedStores>()
      const failed: Array<UnprocessedType> = []

      // Below we:
      //
      // 1. Enter zone
      // 2. Decrypt all batched envelopes
      // 3. Persist both decrypted envelopes and envelopes that we failed to
      //    decrypt (for future retries, see `attempts` field)
      // 4. Leave zone and commit all pending sessions and unprocesseds
      // 5. Acknowledge envelopes (can't fail)
      // 6. Finally process decrypted envelopes
      await storageProtocol.withZone(zone, 'MessageReceiver', async () => {
        await Promise.all<void>(
          items.map(async ({ data, envelope }) => {
            const logId = getEnvelopeId(envelope)
            try {
              const { destinationUuid, ourAccountId } = envelope

              let stores: LockedStores | undefined
              if (destinationUuid) {
                stores = storesMap.get(destinationUuid.toString())
                if (!stores) {
                  stores = {
                    // senderKeyStore: new SenderKeys({
                    //   ourAccountId: destinationUuid,
                    //   zone,
                    // }),
                    sessionStore: new Sessions({
                      zone,
                      ourId: ourAccountId,
                    }),
                    identityKeyStore: new IdentityKeys({
                      zone,
                      ourId: ourAccountId,
                    }),
                    zone,
                  }
                  storesMap.set(destinationUuid.toString(), stores)
                }
              }

              const ignore = false
              // [
              //   MessageContentType.IMG,
              //   MessageContentType.FILE,
              //   MessageContentType.AUDIO,
              //   MessageContentType.VIDEO,
              //   MessageContentType.MEDIA,
              // ].includes(envelope.contentType) && data.background // Don't decrypt file in background
              if (!ignore) {
                const result = await this.queueEncryptedEnvelope(stores, envelope)
                if (result.plaintext) {
                  decrypted.push({
                    plaintext: result.plaintext,
                    envelope: result.envelope,
                    data,
                  })
                }
              } else {
                decrypted.push({
                  plaintext: envelope.content!,
                  envelope: envelope as UnsealedEnvelope,
                  data,
                })
              }
            } catch (error) {
              failed.push(data)
              log.error(
                `!-  MessageReceiver.decryptAndCacheBatch error when processing the envelope ${logId}`,
                Errors.toLogFormat(error)
              )
            }
          })
        )

        log.info(
          `--  MessageReceiver.decryptAndCacheBatch storing ${decrypted.length} decrypted envelopes, keeping ${failed.length} failed envelopes.`
        )

        // Store both decrypted and failed unprocessed envelopes
        const unprocesseds = decrypted.map<UnprocessedType>(({ envelope, data, plaintext }) => ({
          ...data,

          source: envelope.sourceAddress,
          sourceUuid: envelope.sourceAddress,
          sourceDevice: envelope.sourceDevice,

          destinationUuid: envelope.destinationUuid?.toString(),
          // updatedPni: envelope.updatedPni?.toString(),

          conversationDestinationAddress: envelope.conversationDestinationAddress,

          // serverGuid: envelope.serverGuid,
          serverTimestamp: envelope.serverTimestamp,

          decrypted: Bytes.toBase64(plaintext),
        }))

        await storageProtocol.addMultipleUnprocessed(unprocesseds.concat(failed), { zone })
      })
    } catch (error) {
      log.error('!-  decryptAndCache error trying to add messages to cache:', Errors.toLogFormat(error))

      return
    }

    await Promise.all(
      decrypted.map(async ({ envelope, data, plaintext }) => {
        try {
          await this.queueDecryptedEnvelope(envelope, plaintext, data.background)
        } catch (error) {
          log.error('!-  decryptAndCache error when processing decrypted envelope', Errors.toLogFormat(error))
        }
      })
    )

    log.info('--  MessageReceiver.decryptAndCacheBatch fully processed')

    this.maybeScheduleRetryTimeout()
  }

  private async cacheRemoveBatch(items: Array<string>): Promise<void> {
    await this.protocol.removeUnprocessed(items)
  }

  private removeFromCache(envelope: ProcessedEnvelope): void {
    const { id } = envelope
    this.cacheRemoveBatcher.add(id)
  }

  private async queueEncryptedEnvelope(
    stores: LockedStores | undefined,
    envelope: ProcessedEnvelope
  ): Promise<DecryptResult> {
    let logId = getEnvelopeId(envelope)
    // log.info('--  queueing encrypted envelope', logId)

    const task = async (): Promise<DecryptResult> => {
      // const { destinationUuid } = envelope
      // const uuidKind = this.storage.user.getOurUuidKind(destinationUuid)
      // if (uuidKind === UUIDKind.Unknown) {
      //   log.warn(
      //     'MessageReceiver.decryptAndCacheBatch: ' +
      //       `Rejecting envelope ${getEnvelopeId(envelope)}, ` +
      //       `unknown uuid: ${destinationUuid}`
      //   )
      //   return { plaintext: undefined, envelope: undefined }
      // }

      // const unsealedEnvelope = await this.unsealEnvelope(stores, envelope, uuidKind)

      // Dropped early
      // if (!unsealedEnvelope) {
      //   return { plaintext: undefined, envelope: undefined }
      // }

      logId = getEnvelopeId(envelope)

      const taskId = `dispatchEvent(EnvelopeEvent(${logId}))`
      this.addToQueue(async () => this.dispatchAndWait(taskId, new EnvelopeEvent(envelope)), taskId, TaskType.Decrypted)

      const unsealedEnvelope: UnsealedEnvelope = {
        ...envelope,
        sourceAddress: envelope.sourceAddress!,
        sourceUuid: envelope.sourceUuid!,
      }

      return this.decryptEnvelope(stores, unsealedEnvelope)
    }

    return this.addToQueue(task, `MessageReceiver: unseal and decrypt ${logId}`, TaskType.Encrypted)
  }

  private async queueDecryptedEnvelope(
    envelope: UnsealedEnvelope,
    plaintext: Uint8Array,
    background: boolean
  ): Promise<void> {
    const id = getEnvelopeId(envelope)
    // log.info('--  queueing decrypted envelope', id)

    const task = this.handleDecryptedEnvelope.bind(this, envelope, plaintext, background)
    const taskWithTimeout = createTaskWithTimeout(task, `queueDecryptedEnvelope ${id}`, TASK_WITH_TIMEOUT_OPTIONS)

    try {
      await this.addToQueue(taskWithTimeout, `handleDecryptedEnvelope(${id})`, TaskType.Decrypted)
    } catch (error) {
      log.error(`queueDecryptedEnvelope error handling envelope ${id}:`, Errors.toLogFormat(error))
    }
  }

  private async queueCachedEnvelope(data: UnprocessedType, envelope: ProcessedEnvelope): Promise<void> {
    this.decryptAndCacheBatcher.add({ envelope, data })
  }

  // private async unsealEnvelope(
  //   stores: LockedStores,
  //   envelope: ProcessedEnvelope,
  //   uuidKind: UUIDKind
  // ): Promise<UnsealedEnvelope | undefined> {}

  // private validateUnsealedEnvelope(envelope: UnsealedEnvelope): void {}

  private async decryptEnvelope(stores: LockedStores | undefined, envelope: UnsealedEnvelope): Promise<DecryptResult> {
    const logId = `MessageReceiver.decryptEnvelope(${getEnvelopeId(envelope)})`

    if (this.stoppingProcessing) {
      log.warn(`${logId}: dropping unsealed`)
      throw new Error('Unsealed envelope dropped due to stopping processing')
    }

    // if (envelope.type === SocketEnvelopType.RECEIPT) {
    //   strictAssert(envelope.source, 'Unsealed delivery receipt must have sourceUuid')
    //   await this.onDeliveryReceipt(envelope)
    //   return { plaintext: undefined, envelope }
    // }

    if (!envelope.content) {
      this.removeFromCache(envelope)
      strictAssert(false, 'Contentless envelope should be handled by unsealEnvelope')
    }

    // log.info('-- ', logId)

    const decryptResult = await this.decrypt(stores, envelope)

    if (!decryptResult) {
      log.warn(`${logId}: plaintext was falsey`)
      return { plaintext: undefined, envelope }
    }

    const { plaintext, wasEncrypted } = decryptResult

    return { plaintext, envelope }
  }

  // private async decryptSealedSender(
  //   { sessionStore, identityKeyStore, zone }: LockedStores,
  //   envelope: UnsealedEnvelope,
  //   ciphertext: Uint8Array
  // ): Promise<DecryptSealedSenderResult> {}

  private async decrypt(
    stores: LockedStores | undefined,
    envelope: UnsealedEnvelope
  ): Promise<InnerDecryptResultType | undefined> {
    try {
      const logId = getEnvelopeId(envelope)
      const envelopeTypeEnum = SocketEnvelopType

      if (envelope.type === envelopeTypeEnum.PLAINTEXT_CONTENT) {
        log.info(`--  decrypt/${logId}: plaintext message`)

        return {
          plaintext: envelope.content!,
          wasEncrypted: false,
        }
      }

      const { sessionStore, identityKeyStore, zone } = stores!

      const { sourceAddress: sourceIdentifier, sourceDevice, ourAccountId } = envelope

      const preKeyStore = new PreKeys({ ourAccountId })
      const signedPreKeyStore = new SignedPreKeys({ ourAccountId })

      strictAssert(sourceIdentifier, 'Empty source identifier')
      strictAssert(sourceDevice, 'Empty source device')

      const address = new QualifiedAddress(ourAccountId, Address.create(sourceIdentifier, sourceDevice))

      // if (uuidKind === UUIDKind.PNI && envelope.type !== envelopeTypeEnum.PREKEY_BUNDLE) {
      //   log.warn(`MessageReceiver.innerDecrypt(${logId}): non-PreKey envelope on PNI`)
      //   return undefined
      // }

      // strictAssert(
      //   uuidKind === UUIDKind.PNI || uuidKind === UUIDKind.ACI,
      //   `Unsupported uuidKind: ${uuidKind}`
      // )

      if (envelope.type === envelopeTypeEnum.CIPHERTEXT) {
        log.info(`--  decrypt/${logId}: ciphertext message`)

        const signalMessage = SignalMessage.deserialize(Buffer.from(envelope.content!))

        const plaintext = await this.protocol.enqueueSessionJob(
          address,
          async () =>
            // this.unpad(
            signalDecrypt(
              signalMessage,
              new ProtocolAddress(sourceIdentifier, sourceDevice),
              sessionStore,
              identityKeyStore
              // )
            ),
          zone
        )
        return { plaintext: new Uint8Array(plaintext), wasEncrypted: true }
      }
      if (envelope.type === envelopeTypeEnum.PREKEY_BUNDLE) {
        log.info(`decrypt/${logId}: prekey message`)

        const preKeySignalMessage = PreKeySignalMessage.deserialize(envelope.content!)

        const plaintext = await this.protocol.enqueueSessionJob(
          address,
          async () =>
            // this.unpad(
            signalDecryptPreKey(
              preKeySignalMessage,
              new ProtocolAddress(sourceIdentifier, sourceDevice),
              sessionStore,
              identityKeyStore,
              preKeyStore,
              signedPreKeyStore
              // )
            ),
          zone
        )
        return { plaintext, wasEncrypted: true }
      }
      // if (envelope.type === envelopeTypeEnum.UNIDENTIFIED_SENDER) {
      // }

      throw new Error(`Unknown message type ${envelope.type}`)
    } catch (error: any) {
      const fromId = envelope.sourceAddress
      const deviceId = envelope.sourceDevice
      // const ourId = window.rootStore.userStore.selectedAccount.address

      // const isFromMe = fromId === ourId

      // Job timed out, not a decryption error
      if (error?.name === 'TimeoutError' || error?.message?.includes?.('task did not complete in time')) {
        this.removeFromCache(envelope)
        throw error
      }

      // We don't do anything if it's just a duplicated message
      if (error?.message?.includes?.('message with old counter')) {
        this.removeFromCache(envelope)
        throw error
      }

      // We don't do a light session reset if it's an error with the sealed sender
      //   wrapper, since we don't trust the sender information.
      if (error?.message?.includes?.('trust root validation failed')) {
        this.removeFromCache(envelope)
        throw error
      }

      if (
        (envelope.sourceAddress && this.isBlocked(envelope.sourceAddress)) ||
        (envelope.sourceAddress && this.isUuidBlocked(envelope.sourceAddress))
      ) {
        log.info('MessageReceiver.decrypt: Error from blocked sender; no further processing')
        this.removeFromCache(envelope)
        throw error
      }

      const envelopeId = getEnvelopeId(envelope)

      if (fromId && deviceId) {
        const event = new DecryptionErrorEvent(
          {
            // cipherTextBytes,
            // cipherTextType,
            // contentHint: envelope.contentHint ?? (isFromMe ? ContentHint.Resendable : undefined),
            groupId: envelope.groupId,
            // receivedAtCounter: envelope.receivedAtCounter,
            receivedAtDate: envelope.receivedAt,
            senderDevice: deviceId,
            senderUuid: fromId,
            timestamp: envelope.timestamp,
          },
          () => this.removeFromCache(envelope)
        )

        // Avoid deadlocks by scheduling processing on decrypted queue
        this.addToQueue(
          async () => this.dispatchEvent(event),
          `decrypted/dispatchEvent/DecryptionErrorEvent(${envelopeId})`,
          TaskType.Decrypted
        )
      } else {
        this.removeFromCache(envelope)
        log.error(`MessageReceiver.decrypt: Envelope ${envelopeId} missing uuid or deviceId`)
      }

      throw error
    }
  }

  // private async innerDecrypt(
  //   stores: LockedStores,
  //   envelope: UnsealedEnvelope,
  //   ciphertext: Uint8Array,
  //   uuidKind: UUIDKind
  // ): Promise<InnerDecryptResultType | undefined> {}

  // private async onDeliveryReceipt(envelope: ProcessedEnvelope): Promise<void> {}

  // Called after `decryptEnvelope` decrypted the message.
  private async handleDecryptedEnvelope(
    envelope: UnsealedEnvelope,
    plaintext: Uint8Array,
    background: boolean
  ): Promise<void> {
    if (this.stoppingProcessing) {
      return
    }

    if (!envelope.content) {
      this.removeFromCache(envelope)
      throw new Error('Received message with no content')
    }

    await this.innerHandleContentMessage(envelope, plaintext, background)
  }

  // private unpad(paddedPlaintext: Uint8Array): Uint8Array {
  //   for (let i = paddedPlaintext.length - 1; i >= 0; i -= 1) {
  //     if (paddedPlaintext[i] === 0x80) {
  //       return new Uint8Array(paddedPlaintext.slice(0, i))
  //     }
  //     if (paddedPlaintext[i] !== 0x00) {
  //       throw new Error('Invalid padding')
  //     }
  //   }

  //   return paddedPlaintext
  // }

  private async innerHandleContentMessage(
    incomingEnvelope: UnsealedEnvelope,
    plaintext: Uint8Array,
    background: boolean
  ): Promise<void> {
    // const content = Proto.Content.decode(plaintext)
    const parseResult = parseSocketMessage({
      envelope: {
        ...incomingEnvelope,
        destinationUuid: incomingEnvelope.destinationUuid?.toString(),
        conversationDestinationAddress: incomingEnvelope.conversationDestinationAddress,
        groupId: incomingEnvelope.groupId,
      },
      message: new TextDecoder().decode(plaintext),
    })
    if (!parseResult) {
      this.handleDecryptionError(incomingEnvelope, new TextEncoder().encode('parseSocketMessage: failed to parse'))
      return
    }

    const { parsedContent: content } = parseResult

    const envelope = await this.maybeUpdateTimestamp(incomingEnvelope)

    // if (content.decryptionErrorMessage && Bytes.isNotEmpty(content.decryptionErrorMessage)) {
    //   this.handleDecryptionError(envelope, content.decryptionErrorMessage)
    //   return
    // }
    if (content.dataMessage) {
      await this.handleDataMessage(envelope, content.dataMessage, background)
      return
    }
    if (content.syncMessage) {
      await this.handleSyncMessage(envelope, content.syncMessage, background)
      return
    }
    // if (content.nullMessage) {
    //   this.handleNullMessage(envelope)
    //   return
    // }
    // if (content.callingMessage) {
    //   await this.handleCallingMessage(envelope, content.callingMessage)
    //   return
    // }
    if (content.receiptMessage) {
      await this.handleReceiptMessage(envelope, content.receiptMessage)
      return
    }
    if (content.typingMessage) {
      this.handleTypingMessage(envelope, content.typingMessage)
      return
    }
    // if (content.storyMessage) {
    //   await this.handleStoryMessage(envelope, content.storyMessage)
    //   return
    // }
    // if (content.editMessage) {
    //   await this.handleEditMessage(envelope, content.editMessage)
    //   return
    // }

    this.removeFromCache(envelope)

    // if (Bytes.isEmpty(content.senderKeyDistributionMessage)) {
    //   throw new Error('Unsupported content message')
    // }
  }

  private async handleSentMessage(envelope: UnsealedEnvelope, sentContainer: SyncSentMessage, background: boolean) {
    // log.info('MessageReceiver.handleSentMessage', getEnvelopeId(envelope))

    logUnexpectedUrgentValue(envelope, 'sentSync')

    const { destinationAddress, timestamp, message: msg } = sentContainer

    if (!msg) {
      throw new Error('MessageReceiver.handleSentMessage: message was falsey!')
    }

    const message = this.processDecrypted(envelope, msg)
    const groupId = this.getProcessedGroupId(message)
    const isBlocked = groupId ? this.isGroupBlocked(groupId) : false

    if (groupId && isBlocked) {
      log.warn(`Message ${getEnvelopeId(envelope)} ignored; destined for blocked group`)
      this.removeFromCache(envelope)
      return undefined
    }

    const ev = new SentEvent(
      {
        name: 'sent-event',

        guid: envelope.guid,

        accountId: envelope.ourAccountId,

        sourceAddress: envelope.sourceAddress,
        sourceUuid: envelope.sourceUuid,
        sourceDevice: envelope.sourceDevice,

        destinationAddress,

        message,
        publicGroupMessageId: envelope.publicGroupMessageId,

        timestamp,
        serverTimestamp: envelope.serverTimestamp,
        // unidentifiedStatus,
        // isRecipientUpdate: Boolean(isRecipientUpdate),
        // receivedAtCounter: envelope.receivedAtCounter,
        receivedAt: envelope.receivedAt,
        // expirationStartTimestamp: expirationStartTimestamp?.toNumber(),
      },
      this.removeFromCache.bind(this, envelope),
      background
    )
    return this.dispatchAndWait(getEnvelopeId(envelope), ev)
  }

  // private async handleStoryMessage(
  //   envelope: UnsealedEnvelope,
  //   msg: Proto.IStoryMessage,
  //   sentMessage?: ProcessedSent
  // ): Promise<void> {}

  // private async handleEditMessage(
  //   envelope: UnsealedEnvelope,
  //   msg: Proto.IEditMessage
  // ): Promise<void> {}

  private async handleDataMessage(envelope: UnsealedEnvelope, msg: DataMessage, background: boolean): Promise<void> {
    const logId = getEnvelopeId(envelope)
    // log.info('--  MessageReceiver.handleDataMessage', logId)

    const destination = envelope.sourceUuid
    if (!destination || !envelope.sourceAddress) {
      throw new Error('MessageReceiver.handleDataMessage: source and sourceUuid were falsey')
    }

    let type: SendTypesType

    if (msg.text) {
      type = 'message'
    } else if (msg.reactions) {
      type = 'reaction'
    } else if (msg.deleted) {
      type = 'deleteForEveryone'
      // } else if (msg.flags && msg.flags & Proto.DataMessage.Flags.EXPIRATION_TIMER_UPDATE) {
      //   type = 'expirationTimerUpdate'
    }
    // Note: other data messages without any of these attributes will fall into the
    //   'message' bucket - like stickers, gift badges, etc.

    logUnexpectedUrgentValue(envelope, type)

    const message = this.processDecrypted(envelope, msg)
    const groupId = this.getProcessedGroupId(message)
    const isGroupBlocked = groupId ? this.isGroupBlocked(groupId) : false

    if (groupId && isGroupBlocked) {
      log.warn(`Message ${getEnvelopeId(envelope)} ignored; destined for blocked group`)
      this.removeFromCache(envelope)
      return undefined
    }

    const ev = new MessageEvent(
      {
        name: 'message-event',

        guid: envelope.guid,

        accountId: envelope.ourAccountId,

        sourceAddress: envelope.sourceAddress,
        sourceUuid: envelope.sourceUuid,
        sourceDevice: envelope.sourceDevice,

        destinationAddress: envelope.conversationDestinationAddress,

        message,
        publicGroupMessageId: envelope.publicGroupMessageId,

        timestamp: envelope.timestamp,
        // serverGuid: envelope.serverGuid,
        serverTimestamp: envelope.serverTimestamp,
        // unidentifiedDeliveryReceived: Boolean(envelope.unidentifiedDeliveryReceived),
        // receivedAtCounter: envelope.receivedAtCounter,
        receivedAt: envelope.receivedAt,
      },
      this.removeFromCache.bind(this, envelope),
      background
    )

    return this.dispatchAndWait(logId, ev)
  }

  private async maybeUpdateTimestamp(envelope: UnsealedEnvelope): Promise<UnsealedEnvelope> {
    return envelope
  }

  private handleDecryptionError(envelope: UnsealedEnvelope, decryptionError: Uint8Array): void {
    const logId = getEnvelopeId(envelope)
    log.info(`handleDecryptionError: ${logId}`)

    logUnexpectedUrgentValue(envelope, 'retryRequest')

    const buffer = Buffer.from(decryptionError)
    const request = DecryptionErrorMessage.deserialize(buffer)

    const { sourceUuid, sourceDevice } = envelope
    if (!sourceUuid || !sourceDevice) {
      log.error(`handleDecryptionError/${logId}: Missing uuid or device!`)
      this.removeFromCache(envelope)
      return
    }

    const event = new RetryRequestEvent(
      {
        groupId: envelope.groupId,
        requesterDevice: sourceDevice,
        requesterUuid: sourceUuid,
        ratchetKey: request.ratchetKey(),
        senderDevice: request.deviceId(),
        sentAt: request.timestamp(),
      },
      () => this.removeFromCache(envelope)
    )
    this.dispatchEvent(event)
  }

  // private async handleSenderKeyDistributionMessage(
  //   stores: LockedStores,
  //   envelope: UnsealedEnvelope,
  //   distributionMessage: Uint8Array
  // ): Promise<void> {}

  // private async handlePniSignatureMessage(
  //   envelope: UnsealedEnvelope,
  //   pniSignatureMessage: Proto.IPniSignatureMessage
  // ): Promise<void> {}

  // private async handleCallingMessage(
  //   envelope: UnsealedEnvelope,
  //   callingMessage: Proto.ICallingMessage
  // ): Promise<void> {}

  private async handleReceiptMessage(
    envelope: UnsealedEnvelope,
    receiptMessage: MessageDataV2['receiptMessage']
  ): Promise<void> {
    strictAssert(receiptMessage!.timestamp, 'Receipt message without timestamp')

    const EventClass: typeof DeliveryEvent | typeof ReadEvent | typeof ViewEvent = ReadEvent
    const type: SendTypesType = 'viewedReceipt'
    logUnexpectedUrgentValue(envelope, type)

    const logId = getEnvelopeId(envelope)

    const ev = new EventClass(
      {
        timestamp: receiptMessage!.timestamp,
        envelopeTimestamp: envelope.timestamp,
        source: envelope.sourceAddress,
        sourceUuid: envelope.sourceUuid,
        sourceDevice: envelope.sourceDevice,
        wasSentEncrypted: true,
      },
      this.removeFromCache.bind(this, envelope)
    )
    await this.dispatchAndWait(logId, ev)
  }

  private handleTypingMessage(envelope: UnsealedEnvelope, typingMessage: MessageDataV2['typingMessage']): void {
    this.removeFromCache(envelope)

    logUnexpectedUrgentValue(envelope, 'typing')

    strictAssert(envelope.sourceDevice !== undefined, 'TypingMessage requires sourceDevice in the envelope')

    this.dispatchEvent(
      new TypingEvent({
        sender: envelope.sourceAddress,
        senderUuid: envelope.sourceUuid,
        senderDevice: envelope.sourceDevice,
        typing: {
          // typingMessage,
          groupId: typingMessage!.groupId,
          timestamp: Date.now(),
          started: true,
          stopped: false,
        },
      })
    )
  }

  // private handleNullMessage(envelope: UnsealedEnvelope): void {}

  // private isInvalidGroupData(message: Proto.IDataMessage, envelope: ProcessedEnvelope): boolean {}

  private getProcessedGroupId(message: ProcessedDataMessage): string | undefined {
    return message.group?.id
  }

  // private getGroupId(message: Proto.IDataMessage): string | undefined {}

  // private getDestination(sentMessage: Proto.SyncMessage.ISent) {}

  private async handleSyncMessage(
    envelope: UnsealedEnvelope,
    syncMessage: SyncMessage,
    background: boolean
  ): Promise<void> {
    // const ourAccount = window.rootStore.userStore.selectedAccount
    // if (envelope.sourceAddress !== ourAccount.address) {
    //   throw new Error('Received sync message from another address')
    // }
    // const ourDeviceId = ourAccount.deviceUserId
    // // eslint-disable-next-line eqeqeq
    // if (envelope.sourceDevice == ourDeviceId) {
    //   throw new Error('Received sync message from our own device')
    // }

    if (syncMessage.sent) {
      const sentMessage = syncMessage.sent

      if (!sentMessage.message) {
        throw new Error('MessageReceiver.handleSyncMessage: sync sent message was missing message')
      }

      // if (this.isInvalidGroupData(sentMessage.message, envelope)) {
      //   this.removeFromCache(envelope)
      //   return
      // }

      strictAssert(sentMessage.timestamp, 'sent message without timestamp')

      log.info(
        `--  sent message to ${sentMessage.destinationAddress}${
          sentMessage.message.group ? ` in group${sentMessage.message.group.id}` : ''
        } ${sentMessage.timestamp} from ${getEnvelopeId(envelope)}`
      )

      return this.handleSentMessage(envelope, sentMessage, background)
    }
    // if (syncMessage.contacts) {
    //   // Note: this method will download attachment and thus might block
    //   // message processing, but we would like to fully process contact sync
    //   // before moving on since it updates conversation state.
    //   return this.handleContacts(envelope, syncMessage.contacts)
    // }
    // if (syncMessage.groups) {
    //   void this.handleGroups(envelope, syncMessage.groups)
    //   return
    // }
    // if (syncMessage.blocked) {
    //   return this.handleBlocked(envelope, syncMessage.blocked)
    // }
    // if (syncMessage.request) {
    //   log.info('Got SyncMessage Request')
    //   this.removeFromCache(envelope)
    //   return
    // }
    // if (syncMessage.read && syncMessage.read.length) {
    //   return this.handleRead(envelope, syncMessage.read)
    // }
    // if (syncMessage.verified) {
    //   log.info('Got verified sync message, dropping')
    //   this.removeFromCache(envelope)
    //   return
    // }
    // if (syncMessage.configuration) {
    //   return this.handleConfiguration(envelope, syncMessage.configuration)
    // }
    // if (syncMessage.stickerPackOperation && syncMessage.stickerPackOperation.length > 0) {
    //   return this.handleStickerPackOperation(envelope, syncMessage.stickerPackOperation)
    // }
    // if (syncMessage.viewOnceOpen) {
    //   return this.handleViewOnceOpen(envelope, syncMessage.viewOnceOpen)
    // }
    // if (syncMessage.messageRequestResponse) {
    //   return this.handleMessageRequestResponse(envelope, syncMessage.messageRequestResponse)
    // }
    // if (syncMessage.fetchLatest) {
    //   return this.handleFetchLatest(envelope, syncMessage.fetchLatest)
    // }
    // if (syncMessage.keys) {
    //   return this.handleKeys(envelope, syncMessage.keys)
    // }
    // if (syncMessage.viewed && syncMessage.viewed.length) {
    //   return this.handleViewed(envelope, syncMessage.viewed)
    // }
    // if (syncMessage.callEvent) {
    //   return this.handleCallEvent(envelope, syncMessage.callEvent)
    // }

    this.removeFromCache(envelope)
    // const envelopeId = getEnvelopeId(envelope)
    // const unknownFieldTags = inspectUnknownFieldTags(syncMessage).join(',')
    // log.warn(
    //   `handleSyncMessage/${envelopeId}: Got unknown SyncMessage (Unknown field tags: ${unknownFieldTags})`
    // )
  }

  // private async handleSentEditMessage(
  //   envelope: UnsealedEnvelope,
  //   sentMessage: ProcessedSent
  // ): Promise<void> {}

  // private async handleConfiguration(
  //   envelope: ProcessedEnvelope,
  //   configuration: Proto.SyncMessage.IConfiguration
  // ): Promise<void> {}

  // private async handleViewOnceOpen(
  //   envelope: ProcessedEnvelope,
  //   sync: Proto.SyncMessage.IViewOnceOpen
  // ): Promise<void> {}

  // private async handleMessageRequestResponse(
  //   envelope: ProcessedEnvelope,
  //   sync: Proto.SyncMessage.IMessageRequestResponse
  // ): Promise<void> {}

  // private async handleFetchLatest(
  //   envelope: ProcessedEnvelope,
  //   sync: Proto.SyncMessage.IFetchLatest
  // ): Promise<void> {}

  // private async handleKeys(
  //   envelope: ProcessedEnvelope,
  //   sync: Proto.SyncMessage.IKeys
  // ): Promise<void> {}

  // Runs on TaskType.Encrypted queue
  // private async handlePNIChangeNumber(
  //   envelope: ProcessedEnvelope,
  //   { identityKeyPair, signedPreKey, registrationId }: Proto.SyncMessage.IPniChangeNumber
  // ): Promise<void> {}

  // private async handleStickerPackOperation(
  //   envelope: ProcessedEnvelope,
  //   operations: Array<Proto.SyncMessage.IStickerPackOperation>
  // ): Promise<void> {}

  // private async handleRead(
  //   envelope: ProcessedEnvelope,
  //   read: Array<Proto.SyncMessage.IRead>
  // ): Promise<void> {}

  // private async handleViewed(
  //   envelope: ProcessedEnvelope,
  //   viewed: ReadonlyArray<Proto.SyncMessage.IViewed>
  // ): Promise<void> {}

  // private async handleCallEvent(
  //   envelope: ProcessedEnvelope,
  //   callEvent: Proto.SyncMessage.ICallEvent
  // ): Promise<void> {}

  // private async handleContacts(
  //   envelope: ProcessedEnvelope,
  //   contacts: Proto.SyncMessage.IContacts
  // ): Promise<void> {}

  // private async handleGroups(
  //   envelope: ProcessedEnvelope,
  //   groups: Proto.SyncMessage.IGroups
  // ): Promise<void> {}

  // private async handleBlocked(
  //   envelope: ProcessedEnvelope,
  //   blocked: Proto.SyncMessage.IBlocked
  // ): Promise<void> {}

  private isBlocked(number: string): boolean {
    return false // this.storage.blocked.isBlocked(number)
  }

  private isUuidBlocked(uuid: string): boolean {
    return false // this.storage.blocked.isUuidBlocked(uuid)
  }

  private isGroupBlocked(groupId: string): boolean {
    return false // this.storage.blocked.isGroupBlocked(groupId)
  }

  // private async handleAttachment(
  //   attachment: Proto.IAttachmentPointer
  // ): Promise<DownloadedAttachmentType> {
  //   const cleaned = processAttachment(attachment)
  //   return this.downloadAttachment(cleaned)
  // }

  // private async handleEndSession(envelope: ProcessedEnvelope, theirUuid: UUID): Promise<void> {}

  private processDecrypted(envelope: UnsealedEnvelope, decrypted: DataMessage): ProcessedDataMessage {
    return {
      ...decrypted,

      group: envelope.groupId
        ? {
            id: envelope.groupId,
            type: envelope.type === SocketEnvelopType.PLAINTEXT_CONTENT ? 'public' : 'private',
          }
        : decrypted.group
        ? { id: decrypted.group.id, type: 'secret' }
        : undefined,

      contentType: mapMessageContentTypeToDB(envelope.contentType!)!,
    }
  }
}
