// Copyright 2023 Ready.io

import {
  ErrorCode,
  LibSignalErrorBase,
  CiphertextMessageType,
  ProtocolAddress,
  signalEncrypt,
  type CiphertextMessage,
} from '@readyio/lib-messaging'

import { ApiError, ServerApi } from 'types/api'
import { ApiMessageData, SendChatMessageData, SendPublicGroupMessageData } from 'types/api/requests/chat'
import { EmptyResult, SendChatMessageResult, SendPublicChatMessageResult } from 'types/api/responses'
import { MessageContentType, mapMessageToContentType, type MessageDataV2, type DataMessage } from 'types/chat'
import { SocketEnvelopType } from 'types/socket'
import * as Utils from 'utils/crypto/utils'
import { logger as log } from 'utils/logger'
import { Sessions, IdentityKeys } from '../LibSignalStores'
import { type AccountIdStringType } from '../types/Account'
import { Address } from '../types/Address'
import * as Errors from '../types/errors'
import { QualifiedAddress } from '../types/QualifiedAddress'
import { ReadyAddress, isValidReadyId } from '../types/ReadyId'
import { type UUIDStringType, isValidUuid } from '../types/UUID'
import {
  OutgoingIdentityKeyError,
  OutgoingMessageError,
  SendMessageNetworkError,
  UnregisteredUserError,
  HTTPError,
} from './Errors'
import { getKeysForIdentifier } from './getKeysForIdentifier'
import type { SendOptionsType } from './MessageSender'
import type { CallbackResultType, CustomError } from './Types.d'

// export const enum SenderCertificateMode {
//   WithE164,
//   WithoutE164,
// }

export type SendLogCallbackType = (options: { identifier: string; deviceIds: Array<number> }) => Promise<void>

// export const serializedCertificateSchema = z.object({
//   expires: z.number().optional(),
//   serialized: z.instanceof(Uint8Array),
// })

// export type SerializedCertificateType = z.infer<typeof serializedCertificateSchema>

type OutgoingMessageOptionsType = SendOptionsType & {
  online?: boolean
}

function ciphertextMessageTypeToEnvelopeType(type: number) {
  if (type === CiphertextMessageType.PreKey) {
    return SocketEnvelopType.PREKEY_BUNDLE
  }
  if (type === CiphertextMessageType.Whisper) {
    return SocketEnvelopType.CIPHERTEXT
  }
  if (type === CiphertextMessageType.Plaintext) {
    return SocketEnvelopType.PLAINTEXT_CONTENT
  }
  throw new Error(`ciphertextMessageTypeToEnvelopeType: Unrecognized type ${type}`)
}

export default class OutgoingMessage {
  ourAccountId: Readonly<AccountIdStringType>

  identifiers: ReadonlyArray<string>

  server: ServerApi

  timestamp: number

  message: MessageDataV2
  encrypt: boolean

  callback: (result: CallbackResultType) => void

  plaintext?: Uint8Array

  identifiersCompleted: number

  errors: Array<CustomError>

  guid?: UUIDStringType
  message_id?: number

  successfulIdentifiers: Array<string>

  failoverIdentifiers: Array<string>

  unidentifiedDeliveries: Array<string>

  // sendMetadata?: SendMetadataType

  online?: boolean

  groupId?: string

  // contentHint: number

  // urgent: boolean

  // story?: boolean

  recipients: Record<string, Array<number>>

  sendLogCallback?: SendLogCallbackType

  constructor({
    callback,
    ourAccountId,
    // contentHint,
    groupId,
    identifiers,
    guid,
    message,
    encrypt,
    options,
    sendLogCallback,
    server,
    // story,
    timestamp,
  }: // urgent,
  {
    callback: (result: CallbackResultType) => void
    ourAccountId: AccountIdStringType
    // contentHint: number
    groupId: string | undefined
    identifiers: ReadonlyArray<string>
    guid?: UUIDStringType
    message: MessageDataV2
    encrypt: boolean
    options?: OutgoingMessageOptionsType
    sendLogCallback?: SendLogCallbackType
    server: ServerApi
    // story?: boolean
    timestamp: number
    // urgent: boolean
  }) {
    this.ourAccountId = ourAccountId
    this.identifiers = identifiers
    this.groupId = groupId

    this.guid = guid

    this.server = server
    this.timestamp = timestamp

    this.message = message
    this.encrypt = encrypt

    // this.contentHint = contentHint
    // this.story = story
    // this.urgent = urgent

    this.callback = callback
    this.identifiersCompleted = 0
    this.errors = []
    this.successfulIdentifiers = []
    this.failoverIdentifiers = []
    this.unidentifiedDeliveries = []
    this.recipients = {}
    this.sendLogCallback = sendLogCallback

    // this.sendMetadata = options?.sendMetadata
    this.online = options?.online
  }

  numberCompleted(): void {
    this.identifiersCompleted += 1
    if (this.identifiersCompleted >= this.identifiers.length) {
      const proto = this.message
      // const contentProto = this.getContentProtoBytes()
      const { timestamp, recipients } = this
      let dataMessage: DataMessage | undefined
      let editMessage: DataMessage | undefined
      // let hasPniSignatureMessage = false

      if (proto.dataMessage) {
        dataMessage = proto.dataMessage
      } else if (proto.editMessage) {
        editMessage = proto.editMessage
      }
      // hasPniSignatureMessage = Boolean(proto.pniSignatureMessage)

      this.callback({
        successfulIdentifiers: this.successfulIdentifiers,
        failoverIdentifiers: this.failoverIdentifiers,
        errors: this.errors,
        // unidentifiedDeliveries: this.unidentifiedDeliveries,

        // contentHint,
        dataMessage,
        editMessage,
        recipients,
        // contentProto,

        guid: this.guid,
        message_id: this.message_id,

        timestamp,
        // urgent,
        // hasPniSignatureMessage,
      })
    }
  }

  registerError(identifier: string, reason: string, providedError?: Error): void {
    let error = providedError

    /* if (error && error instanceof HTTPError && error.code === 428) {
      error = new SendMessageChallengeError(identifier, error)
    } else */
    if (!error || (error instanceof HTTPError && error.code !== 404)) {
      error = new OutgoingMessageError(identifier, null, null, error as HTTPError)
    }

    error.cause = reason

    this.errors[this.errors.length] = error
    this.numberCompleted()
  }

  reloadDevicesAndSend(identifier: string, recurse?: boolean): () => Promise<void> {
    return async () => {
      const deviceIds = await window.Ready.protocol.getDeviceIds('reloadDevicesAndSend', {
        accountId: this.ourAccountId,
        identifier,
      })
      if (deviceIds.length === 0) {
        if (this.message.syncMessage) {
          this.numberCompleted()
          return
        }

        this.registerError(
          identifier,
          'reloadDevicesAndSend: Got empty device list when loading device keys',
          undefined
        )
        return undefined
      }
      return this.doSendMessage(identifier, deviceIds, recurse)
    }
  }

  async getKeysForIdentifier(identifier: string, updateDevices?: Array<number>): Promise<void | Array<void | null>> {
    const { accessKeyFailed } = await getKeysForIdentifier(this.ourAccountId, identifier, updateDevices)
    if (accessKeyFailed && !this.failoverIdentifiers.includes(identifier)) {
      this.failoverIdentifiers.push(identifier)
    }
  }

  async transmitMessage(
    identifier: string,
    jsonData: ReadonlyArray<ApiMessageData>,
    timestamp: number
  ): Promise<SendChatMessageResult> {
    try {
      const result = await this.server.sendMessage(
        {
          timestamp: timestamp / 1000,
          online: this.online,
          messages: jsonData,
          // for SYNC message
          guid: this.guid,
          real_destination: this.message.syncMessage?.sent?.destinationAddress,
        },
        identifier
      )

      // re-convert back to HTTP error
      if (result.kind === 'conflict') throw new HTTPError('', { code: 409, headers: {}, response: result.data })
      if (result.kind === 'gone') throw new HTTPError('', { code: 410, headers: {}, response: result.data })
      if (result.kind !== 'ok') throw new ApiError(result)

      return result
    } catch (e) {
      if (e instanceof HTTPError && e.code !== 409 && e.code !== 410) {
        // 409 and 410 should bubble and be handled by doSendMessage
        // 404 should throw UnregisteredUserError
        // 428 should throw SendMessageChallengeError
        // all other network errors can be retried later.
        if (e.code === 404) {
          throw new UnregisteredUserError(identifier, e)
        }
        // if (e.code === 428) {
        //   throw new SendMessageChallengeError(identifier, e)
        // }
        throw new SendMessageNetworkError(identifier, jsonData, e)
      }
      throw e
    }
  }

  getPlaintext(): Uint8Array {
    if (!this.plaintext) {
      const dataMessage = this.message.dataMessage ?? this.message.syncMessage?.sent?.message
      this.plaintext = Utils.fromUtf8ToArray(
        JSON.stringify({
          ...this.message,
          // these below is for V1 version support. TODO: remove
          ...dataMessage,
          seenTime: this.message.receiptMessage?.timestamp,
        })
      )
    }
    return this.plaintext
  }

  // getContentProtoBytes(): Uint8Array | undefined {
  //   if (this.message instanceof Proto.Content) {
  //     return new Uint8Array(Proto.Content.encode(this.message).finish())
  //   }

  //   return undefined
  // }

  async getCiphertextMessage({
    identityKeyStore,
    protocolAddress,
    sessionStore,
  }: {
    identityKeyStore: IdentityKeys
    protocolAddress: ProtocolAddress
    sessionStore: Sessions
  }): Promise<CiphertextMessage> {
    return signalEncrypt(this.getPlaintext().buffer, protocolAddress, sessionStore, identityKeyStore)
  }

  async doSendMessage(identifier: string, deviceIds: Array<number>, recurse?: boolean): Promise<void> {
    const theirUuid = ReadyAddress.checkedLookup(identifier)
    // We don't send to ourselves unless sealedSender is enabled
    const sessionStore = new Sessions({ ourId: this.ourAccountId })
    const identityKeyStore = new IdentityKeys({ ourId: this.ourAccountId })
    const dataMessage = this.message.dataMessage ?? this.message.syncMessage?.sent?.message!
    console.debug('------>', this.message, deviceIds)

    return Promise.all(
      deviceIds.map(async (destinationDeviceId) => {
        const address = new QualifiedAddress(this.ourAccountId, new Address(theirUuid, destinationDeviceId))

        return window.Ready.protocol.enqueueSessionJob<ApiMessageData>(address, async () => {
          const protocolAddress = new ProtocolAddress(theirUuid.toString(), destinationDeviceId)

          const activeSession = await sessionStore.getSession(protocolAddress)
          if (!activeSession) {
            throw new Error('OutgoingMessage.doSendMessage: No active session!')
          }

          const destinationRegistrationId = activeSession.remoteRegistrationId()

          const ciphertextMessage = await this.getCiphertextMessage({
            identityKeyStore,
            protocolAddress,
            sessionStore,
          })
          const type = ciphertextMessageTypeToEnvelopeType(ciphertextMessage.type())

          const content = ciphertextMessage.serialize().toString('base64')

          return {
            type,
            destination_device_id: destinationDeviceId,
            destination_registration_id: destinationRegistrationId,
            body: content,
            content: Utils.fromUtf8ToB64(
              this.message.typingMessage
                ? MessageContentType.TYPING
                : this.message.receiptMessage
                ? MessageContentType.SEEN
                : mapMessageToContentType(dataMessage)
            ), // to support V1 version. TODO: remove this
          }
        })
      })
    )
      .then(async (jsonData: Array<ApiMessageData>) => {
        const result = await this.transmitMessage(identifier, jsonData, this.timestamp)

        if (result.kind === 'ok') {
          this.guid = result.data.messages_info[0]!.guid as UUIDStringType
        }

        this.successfulIdentifiers.push(identifier)
        this.recipients[identifier] = deviceIds
        this.numberCompleted()

        if (this.sendLogCallback) {
          this.sendLogCallback({ identifier, deviceIds })
        } else if (this.successfulIdentifiers.length > 1) {
          log.warn(
            `OutgoingMessage.doSendMessage: no sendLogCallback provided for message ${this.timestamp}, but multiple recipients`
          )
        }
      })
      .catch(async (error) => {
        if (error instanceof HTTPError && (error.code === 410 || error.code === 409)) {
          log.error('!<- OutgoingMessage.doSendMessage: ERROR:', error, 'content:', error.response)

          if (!recurse) {
            this.registerError(identifier, 'Hit retry limit attempting to reload device list', error)
            return undefined
          }

          const errorResp = error.response as any
          const response = {
            extraDevices: errorResp.extra_device_ids as number[],
            staleDevices: errorResp.stale_device_ids as number[],
            missingDevices: errorResp.missing_device_ids as number[],
          }

          if (error.code === 409) {
            await this.removeDeviceIdsForIdentifier(identifier, response.extraDevices || [])
          } else {
            await Promise.all(
              (response.staleDevices || []).map(async (deviceId: number) => {
                await window.Ready.protocol.archiveSession(
                  new QualifiedAddress(this.ourAccountId, new Address(theirUuid, deviceId))
                )
              })
            )
          }

          const resetDevices = error.code === 410 ? response.staleDevices : response.missingDevices
          return this.getKeysForIdentifier(identifier, resetDevices).then(
            // We continue to retry as long as the error code was 409; the assumption is
            //   that we'll request new device info and the next request will succeed.
            this.reloadDevicesAndSend(identifier, error.code === 409)
          )
        }

        let newError = error
        if (error instanceof LibSignalErrorBase && error.code === ErrorCode.UntrustedIdentity) {
          newError = new OutgoingIdentityKeyError(identifier, error)
          log.error(
            'Got "key changed" error from encrypt - no identityKey for application layer',
            identifier,
            deviceIds
          )

          log.info('closing all sessions for', identifier)
          window.Ready.protocol.archiveAllSessions(theirUuid).then(
            () => {
              throw error
            },
            (innerError) => {
              log.error(`doSendMessage: Error closing sessions: ${Errors.toLogFormat(innerError)}`)
              throw error
            }
          )
        } else if (typeof error === 'object' && 'kind' in error) {
          newError = new ApiError(error)
        }

        this.registerError(identifier, 'Failed to create or send message', newError)

        return undefined
      })
  }

  async doSendMessageToPublicGroup(identifier: string): Promise<void> {
    const dataMessage = this.message.dataMessage ?? this.message.syncMessage?.sent?.message!
    console.debug('------>', this.message)

    try {
      if (dataMessage.deleted) {
        let res: EmptyResult
        if (!dataMessage.deleted.attachments) {
          res = await this.server.deletePublicGroupMessage(identifier, dataMessage.deleted.guid)
        } else {
          res = await this.server.deletePublicGroupAttachment(identifier, dataMessage.deleted.attachments[0]!.cloudUrl)
        }

        if (res.kind !== 'ok') {
          throw new ApiError(res)
        }
      } else if (dataMessage.reactions) {
        const res = await this.server.reactMessagePublicGroup(
          identifier,
          dataMessage.reactedMessage!.guid,
          dataMessage.reactions[0]!.reaction
        )

        if (res.kind !== 'ok') {
          throw new ApiError(res)
        }
      } else {
        const payload: SendPublicGroupMessageData = {
          timestamp: this.timestamp,
          online: false, // isTyping,
          message: {
            type: SocketEnvelopType.PLAINTEXT_CONTENT,
            destination: identifier,
            body: Utils.fromUtf8ToB64(
              JSON.stringify({
                ...this.message,
                ...dataMessage, // to support V1 version. TODO: remove this
              })
            ),
            content: Utils.fromUtf8ToB64(
              this.message.typingMessage
                ? MessageContentType.TYPING
                : this.message.receiptMessage
                ? MessageContentType.SEEN
                : mapMessageToContentType(dataMessage)
            ), // to support V1 version. TODO: remove this
          },
        }

        const res = await this.server.sendPublicGroupMessage(payload)

        if (res.kind !== 'ok') {
          throw new ApiError(res)
        }

        this.guid = res.data.messages_info.guid as UUIDStringType
        this.message_id = res.data.messages_info.message_id
      }

      this.successfulIdentifiers.push(identifier)
      this.numberCompleted()

      if (this.sendLogCallback) {
        this.sendLogCallback({ identifier, deviceIds: [] })
      }
    } catch (error: any) {
      this.registerError(identifier, 'Failed to create or send message', error)
    }
  }

  async removeDeviceIdsForIdentifier(identifier: string, deviceIdsToRemove: Array<number>): Promise<void> {
    const theirUuid = ReadyAddress.checkedLookup(identifier)

    await Promise.all(
      deviceIdsToRemove.map(async (deviceId) => {
        await window.Ready.protocol.archiveSession(
          new QualifiedAddress(this.ourAccountId, new Address(theirUuid, deviceId))
        )
      })
    )
  }

  async sendToIdentifier(tag: string, providedIdentifier: string, isPublicGroup: boolean): Promise<void> {
    const identifier = providedIdentifier
    try {
      if (isValidReadyId(identifier) || (isPublicGroup && isValidUuid(identifier))) {
        // We're good!
      } else {
        throw new Error(`sendToIdentifier [${tag}]: identifier ${identifier} was neither a UUID or E164`)
      }

      if (isPublicGroup) {
        this.doSendMessageToPublicGroup(identifier)
      } else {
        const deviceIds = await window.Ready.protocol.getDeviceIds('sendToIdentifier', {
          accountId: this.ourAccountId,
          identifier,
        })
        if (deviceIds.length === 0) {
          await this.getKeysForIdentifier(identifier)
        }
        if (deviceIds.length === 0 && this.message.syncMessage) {
          this.numberCompleted()
          return
        }
        await this.reloadDevicesAndSend(identifier, true)()
      }
    } catch (error: any) {
      if (error instanceof LibSignalErrorBase && error.code === ErrorCode.UntrustedIdentity) {
        const newError = new OutgoingIdentityKeyError(identifier, error)
        this.registerError(identifier, 'Untrusted identity', newError)
      } else {
        this.registerError(identifier, `Failed to retrieve new device keys for identifier ${identifier}`, error)
      }
    }
  }
}
