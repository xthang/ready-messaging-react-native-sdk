// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */
/* eslint-disable no-bitwise */

import PQueue from 'p-queue'

import { type AccountIdStringType } from 'types/Account'
import { ServerApi } from 'types/api'
import {
  type DataMessage,
  ConversationType,
  GroupType,
  type MessageDataV2,
  type SyncMessage,
  type SyncSentMessage,
  ReceiptType,
} from 'types/chat'
import { type ReadyAddressStringType } from 'types/ReadyId'
import { type UUIDStringType } from 'types/UUID'
import { assertDev } from 'utils/assert'
import { getRandomBytes } from 'utils/crypto/utils'
import { sendTypesEnum } from 'utils/handleMessageSend'
import { isEmpty } from 'utils/iterables'
import { z } from 'zod'
import { SendMessageProtoError } from './Errors'
import type { SendLogCallbackType } from './OutgoingMessage'
import OutgoingMessage from './OutgoingMessage'
import createTaskWithTimeout from './TaskWithTimeout'
import type { CallbackResultType } from './Types'

export type SendOptionsType = {
  online?: boolean
}

export const singleProtoJobDataSchema = z.object({
  contentHint: z.number(),
  identifier: z.string(),
  isSyncMessage: z.boolean(),
  messageIds: z.array(z.string()).optional(),
  protoBase64: z.string(),
  type: sendTypesEnum,
  urgent: z.boolean().optional(),
})

export type SingleProtoJobData = z.infer<typeof singleProtoJobDataSchema>

export type GroupSendOptionsType = {
  group?: GroupInfoType
  content: DataMessage
  timestamp: number
}

export default class MessageSender {
  pendingMessages: {
    [id: string]: PQueue
  }

  constructor(public readonly server: ServerApi) {
    this.pendingMessages = {}
  }

  async queueJobForIdentifier<T>(
    ourAccountId: AccountIdStringType,
    identifier: string,
    isPublicGroup: boolean,
    runJob: () => Promise<T>
  ): Promise<T> {
    const { id } = await window.Ready.conversationController.getOrCreate(
      'MessageSender.queueJobForIdentifier',
      ourAccountId,
      identifier,
      isPublicGroup ? ConversationType.GROUP : ConversationType.PRIVATE,
      isPublicGroup ? GroupType.PUBLIC : undefined
    )
    this.pendingMessages[id] = this.pendingMessages[id] || new PQueue({ concurrency: 1 })

    const queue = this.pendingMessages[id]!

    const taskWithTimeout = createTaskWithTimeout(runJob, `queueJobForIdentifier ${identifier} ${id}`)

    return queue.add(taskWithTimeout)
  }

  // Attachment upload functions

  static getRandomPadding(): Uint8Array {
    // Generate a random int from 1 and 512
    const buffer = getRandomBytes(2)
    const paddingLength = (new Uint16Array(buffer)[0]! & 0x1ff) + 1

    // Generate a random padding buffer of the chosen size
    return getRandomBytes(paddingLength)
  }

  // Proto assembly

  // getTextAttachmentProto(attachmentAttrs: OutgoingTextAttachmentType): Proto.TextAttachment {}

  async getContentMessage(dataMessage: Readonly<DataMessage>): Promise<MessageDataV2> {
    const contentMessage: MessageDataV2 = { version: '2.0.0' }
    if (dataMessage.editedMessageTimestamp) {
      const editMessage = { dataMessage }
      // editMessage.targetSentTimestamp = Long.fromNumber(options.editedMessageTimestamp)
      contentMessage.editMessage = editMessage
    } else {
      contentMessage.dataMessage = dataMessage
    }

    // const { includePniSignatureMessage } = options
    // if (includePniSignatureMessage) {
    //   strictAssert(
    //     message.recipients.length === 1,
    //     'getContentMessage: includePniSignatureMessage is single recipient only'
    //   )

    //   const conversation = window.Signal.conversationController.get(message.recipients[0])

    // addPniSignatureMessageToProto({
    //   conversation,
    //   proto: contentMessage,
    //   reason: `getContentMessage(${message.timestamp})`,
    // })
    // }

    return contentMessage
  }

  getTypingContentMessage(
    options: Readonly<{
      recipientId?: string
      groupId?: string
      groupMembers: ReadonlyArray<string>
      isTyping: boolean
      timestamp?: number
    }>
  ): MessageDataV2 {
    const { recipientId, groupId, isTyping, timestamp } = options

    if (!recipientId && !groupId) {
      throw new Error('getTypingContentMessage: Need to provide either recipientId or groupId!')
    }

    const typingMessage: MessageDataV2['typingMessage'] = {
      groupId,
      action: isTyping ? 'started' : 'stopped',
      timestamp: timestamp || Date.now(),
    }

    return { version: '2.0.0', typingMessage }
  }

  // getAttrsFromGroupOptions(options: Readonly<GroupSendOptionsType>): MessageOptionsType {
  //   const {
  //     group,
  //     messageText,
  //     attachments,
  //     bodyRanges,
  //     // contact,
  //     // preview,
  //     profileKey,
  //     // quote,
  //     reaction,
  //     sticker,
  //     // storyContext,
  //     deletedForEveryoneTimestamp,
  //     editedMessageTimestamp,
  //     expireTimer,
  //     flags,
  //     // groupCallUpdate,
  //     timestamp,
  //   } = options

  //   if (!group) {
  //     throw new Error('getAttrsFromGroupOptions: No groupv2 information provided!')
  //   }

  //   const groupMembers = group?.members || []

  //   // We should always have a UUID but have this check just in case we don't.
  //   let isNotMe: (recipient: string) => boolean
  //   if (myUuid) {
  //     isNotMe = (r) => r !== myE164 && r !== myUuid.toString()
  //   } else {
  //     isNotMe = (r) => r !== myE164
  //   }

  //   // const blockedIdentifiers = new Set(
  //   //   concat(window.storage.blocked.getBlockedUuids(), window.storage.blocked.getBlockedNumbers())
  //   // )

  //   const recipients = groupMembers.filter(
  //     (recipient) => isNotMe(recipient) && !blockedIdentifiers.has(recipient)
  //   )

  //   return {
  //     recipients,
  //     group,
  //     body: messageText,
  //     bodyRanges,
  //     attachments,
  //     // contact,
  //     // groupCallUpdate,
  //     // preview,
  //     profileKey,
  //     // quote,
  //     reaction,
  //     sticker,
  //     // storyContext,
  //     timestamp,
  //     deletedForEveryoneTimestamp,
  //     editedMessageTimestamp,
  //     expireTimer,
  //     flags,
  //   }
  // }

  static createSyncMessage(): SyncMessage {
    const syncMessage = {} as SyncMessage
    return syncMessage
  }

  // Low-level sends

  sendMessageProto({
    callback,
    ourAccountId,
    recipients,
    groupId,
    groupType,
    guid,
    options,
    proto,
    // contentHint,
    sendLogCallback,
    timestamp,
  }: // urgent,
  Readonly<{
    callback: (result: CallbackResultType) => void
    ourAccountId: AccountIdStringType
    recipients: ReadonlyArray<string> | undefined
    groupId: string | undefined
    groupType?: GroupType
    guid?: UUIDStringType
    options?: SendOptionsType
    proto: MessageDataV2 | DataMessage
    // contentHint: number
    sendLogCallback?: SendLogCallbackType
    timestamp: number
    // urgent: boolean
  }>): void {
    // const rejections = window.textsecure.storage.get('signedKeyRotationRejected', 0)
    // if (rejections > 5) {
    //   throw new SignedPreKeyRotationError()
    // }

    let message: MessageDataV2
    if ('version' in proto) {
      message = proto
    } else {
      message = { version: '2.0.0', dataMessage: proto }
    }

    const outgoing = new OutgoingMessage({
      callback,
      ourAccountId,
      identifiers: recipients,
      groupId,
      guid,
      message,
      encrypt: true,
      options,
      // contentHint,
      sendLogCallback,
      server: this.server,
      timestamp,
      // urgent,
    })

    if (groupId && groupType === GroupType.PUBLIC) {
      this.queueJobForIdentifier(ourAccountId, groupId, true, async () =>
        outgoing.sendToIdentifier('MessageSender.send~group', groupId, true)
      )
    } else {
      recipients!.forEach((identifier) => {
        this.queueJobForIdentifier(ourAccountId, identifier, false, async () =>
          outgoing.sendToIdentifier('MessageSender.send~1-1', identifier, false)
        )
      })
    }
  }

  async sendMessageProtoAndWait({
    timestamp,
    ourAccountId,
    recipients,
    proto,
    groupId,
    options,
  }: // urgent,
  Readonly<{
    timestamp: number
    ourAccountId: AccountIdStringType
    recipients: Array<string>
    proto: MessageDataV2 | DataMessage
    groupId: string | undefined
    options?: SendOptionsType
    // urgent: boolean
  }>): Promise<CallbackResultType> {
    return new Promise((resolve, reject) => {
      const callback = (result: CallbackResultType) => {
        if (result && result.errors && result.errors.length > 0) {
          reject(new SendMessageProtoError(result))
          return
        }
        resolve(result)
      }

      this.sendMessageProto({
        callback,
        ourAccountId,
        groupId,
        recipients,
        options,
        proto,
        timestamp,
        // urgent,
      })
    })
  }

  async sendIndividualProto({
    ourAccountId,
    groupId,
    identifier,
    guid,
    options,
    proto,
    timestamp,
  }: Readonly<{
    ourAccountId: AccountIdStringType
    // contentHint: number
    groupId?: string
    identifier: string | undefined
    guid?: UUIDStringType
    options?: SendOptionsType
    proto: DataMessage | MessageDataV2
    timestamp: number
    // urgent: boolean
  }>): Promise<CallbackResultType> {
    assertDev(identifier, "Identifier can't be undefined")

    return new Promise((resolve, reject) => {
      const callback = (res: CallbackResultType) => {
        if (res && res.errors && res.errors.length > 0) {
          reject(new SendMessageProtoError(res))
        } else {
          resolve(res)
        }
      }
      this.sendMessageProto({
        callback,
        ourAccountId,
        groupId,
        guid,
        options,
        proto,
        recipients: [identifier],
        timestamp,
        // urgent,
      })
    })
  }

  // You might wonder why this takes a groupId. models/messages.resend() can send a group
  //   message to just one person.
  async sendMessageToIdentifier({
    ourAccountId,
    identifier,
    groupId,
    groupType,
    content,
    options,
    timestamp,
  }: // urgent,
  Readonly<{
    ourAccountId: string
    identifier: string | undefined
    groupId: string | undefined
    groupType?: GroupType
    content: DataMessage
    options?: SendOptionsType
    timestamp: number
    // urgent: boolean
  }>): Promise<CallbackResultType> {
    const proto = await this.getContentMessage(content)

    return new Promise((resolve, reject) => {
      this.sendMessageProto({
        callback: (res: CallbackResultType) => {
          if (res.errors && res.errors.length > 0) {
            reject(new SendMessageProtoError(res))
          } else {
            resolve(res)
          }
        },
        ourAccountId,
        groupId,
        groupType,
        recipients: [identifier],
        proto,
        timestamp,
        options,
      })
    })
  }

  // Support for sync messages

  // Note: this is used for sending real messages to your other devices after sending a
  //   message to others.
  async sendSyncMessage({
    ourAccountId,
    ourAddress,
    guid,
    dataMessage,
    editMessage,
    timestamp,
    destination,
    // expirationStartTimestamp,
    conversationIdsSentTo = [],
    isUpdate,
    // urgent,
    options,
  }: Readonly<{
    ourAccountId: AccountIdStringType
    ourAddress: ReadyAddressStringType
    guid: UUIDStringType
    dataMessage?: DataMessage
    editMessage?: DataMessage
    timestamp: number
    destination: string
    // expirationStartTimestamp: number | null
    conversationIdsSentTo?: Iterable<string>
    // conversationIdsWithSealedSender?: Set<string>
    isUpdate?: boolean
    // urgent: boolean
    options?: SendOptionsType
  }>): Promise<CallbackResultType> {
    const sentMessage: SyncSentMessage = { timestamp }

    if (editMessage) {
      sentMessage.editMessage = editMessage
    } else if (dataMessage) {
      sentMessage.message = dataMessage
    }
    if (destination) {
      sentMessage.destinationAddress = destination
    }
    // if (expirationStartTimestamp) {
    //   sentMessage.expirationStartTimestamp = Long.fromNumber(expirationStartTimestamp)
    // }
    // if (storyMessage) {
    //   sentMessage.storyMessage = storyMessage
    // }
    // if (storyMessageRecipients) {
    //   sentMessage.storyMessageRecipients = storyMessageRecipients.slice()
    // }

    if (isUpdate) {
      sentMessage.isRecipientUpdate = true
    }

    // Though this field has 'unidentified' in the name, it should have entries for each
    //   number we sent to.
    if (!isEmpty(conversationIdsSentTo)) {
      // sentMessage.unidentifiedStatus = [
      //   ...map(conversationIdsSentTo, (conversationId) => {
      //     const status = new Proto.SyncMessage.Sent.UnidentifiedDeliveryStatus()
      //     const conv = window.Signal.conversationController.get(conversationId)
      //     if (conv) {
      //       // const e164 = conv.get('e164')
      //       // if (e164) {
      //       //   status.destination = e164
      //       // }
      //       // const uuid = conv.get('uuid')
      //       // if (uuid) {
      //       //   status.destinationUuid = uuid
      //       // }
      //     }
      //     status.unidentified = conversationIdsWithSealedSender.has(conversationId)
      //     return status
      //   }),
      // ]
    }

    const syncMessage = MessageSender.createSyncMessage()
    syncMessage.sent = sentMessage
    const contentMessage: MessageDataV2 = { version: '2.0.0' }
    contentMessage.syncMessage = syncMessage

    // const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

    return this.sendIndividualProto({
      ourAccountId,
      identifier: ourAddress,
      guid,
      proto: contentMessage,
      timestamp,
      // contentHint: ContentHint.RESENDABLE,
      options,
      // urgent,
    })
  }

  // static getRequestBlockSyncMessage(): SingleProtoJobData {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()

  //   const request = new Proto.SyncMessage.Request()
  //   request.type = Proto.SyncMessage.Request.Type.BLOCKED
  //   const syncMessage = MessageSender.createSyncMessage()
  //   syncMessage.request = request
  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return {
  //     contentHint: ContentHint.RESENDABLE,
  //     identifier: myUuid.toString(),
  //     isSyncMessage: true,
  //     protoBase64: Bytes.toBase64(MessageDataV2.encode(contentMessage).finish()),
  //     type: 'blockSyncRequest',
  //     urgent: false,
  //   }
  // }

  // static getRequestConfigurationSyncMessage(): SingleProtoJobData {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()

  //   const request = new Proto.SyncMessage.Request()
  //   request.type = Proto.SyncMessage.Request.Type.CONFIGURATION
  //   const syncMessage = MessageSender.createSyncMessage()
  //   syncMessage.request = request
  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return {
  //     contentHint: ContentHint.RESENDABLE,
  //     identifier: myUuid.toString(),
  //     isSyncMessage: true,
  //     protoBase64: Bytes.toBase64(MessageDataV2.encode(contentMessage).finish()),
  //     type: 'configurationSyncRequest',
  //     urgent: false,
  //   }
  // }

  // static getRequestGroupSyncMessage(): SingleProtoJobData {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()

  //   const request = new Proto.SyncMessage.Request()
  //   request.type = Proto.SyncMessage.Request.Type.GROUPS
  //   const syncMessage = this.createSyncMessage()
  //   syncMessage.request = request
  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return {
  //     contentHint: ContentHint.RESENDABLE,
  //     identifier: myUuid.toString(),
  //     isSyncMessage: true,
  //     protoBase64: Bytes.toBase64(MessageDataV2.encode(contentMessage).finish()),
  //     type: 'groupSyncRequest',
  //     urgent: false,
  //   }
  // }

  // static getRequestContactSyncMessage(): SingleProtoJobData {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()

  //   const request = new Proto.SyncMessage.Request()
  //   request.type = Proto.SyncMessage.Request.Type.CONTACTS
  //   const syncMessage = this.createSyncMessage()
  //   syncMessage.request = request
  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return {
  //     contentHint: ContentHint.RESENDABLE,
  //     identifier: myUuid.toString(),
  //     isSyncMessage: true,
  //     protoBase64: Bytes.toBase64(MessageDataV2.encode(contentMessage).finish()),
  //     type: 'contactSyncRequest',
  //     urgent: true,
  //   }
  // }

  // static getFetchManifestSyncMessage(): SingleProtoJobData {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()

  //   const fetchLatest = new Proto.SyncMessage.FetchLatest()
  //   fetchLatest.type = Proto.SyncMessage.FetchLatest.Type.STORAGE_MANIFEST

  //   const syncMessage = this.createSyncMessage()
  //   syncMessage.fetchLatest = fetchLatest
  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return {
  //     contentHint: ContentHint.RESENDABLE,
  //     identifier: myUuid.toString(),
  //     isSyncMessage: true,
  //     protoBase64: Bytes.toBase64(MessageDataV2.encode(contentMessage).finish()),
  //     type: 'fetchLatestManifestSync',
  //     urgent: false,
  //   }
  // }

  // static getFetchLocalProfileSyncMessage(): SingleProtoJobData {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()

  //   const fetchLatest = new Proto.SyncMessage.FetchLatest()
  //   fetchLatest.type = Proto.SyncMessage.FetchLatest.Type.LOCAL_PROFILE

  //   const syncMessage = this.createSyncMessage()
  //   syncMessage.fetchLatest = fetchLatest
  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return {
  //     contentHint: ContentHint.RESENDABLE,
  //     identifier: myUuid.toString(),
  //     isSyncMessage: true,
  //     protoBase64: Bytes.toBase64(MessageDataV2.encode(contentMessage).finish()),
  //     type: 'fetchLocalProfileSync',
  //     urgent: false,
  //   }
  // }

  // static getRequestKeySyncMessage(): SingleProtoJobData {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()

  //   const request = new Proto.SyncMessage.Request()
  //   request.type = Proto.SyncMessage.Request.Type.KEYS

  //   const syncMessage = this.createSyncMessage()
  //   syncMessage.request = request
  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return {
  //     contentHint: ContentHint.RESENDABLE,
  //     identifier: myUuid.toString(),
  //     isSyncMessage: true,
  //     protoBase64: Bytes.toBase64(MessageDataV2.encode(contentMessage).finish()),
  //     type: 'keySyncRequest',
  //     urgent: true,
  //   }
  // }

  // async syncReadMessages(
  //   reads: ReadonlyArray<{
  //     senderUuid?: string
  //     senderE164?: string
  //     timestamp: number
  //   }>,
  //   options?: Readonly<SendOptionsType>
  // ): Promise<CallbackResultType> {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()

  //   const syncMessage = MessageSender.createSyncMessage()
  //   syncMessage.read = []
  //   for (let i = 0; i < reads.length; i += 1) {
  //     const proto = new Proto.SyncMessage.Read({
  //       ...reads[i],
  //       timestamp: Long.fromNumber(reads[i].timestamp),
  //     })

  //     syncMessage.read.push(proto)
  //   }
  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return this.sendIndividualProto({
  //     identifier: myUuid.toString(),
  //     proto: contentMessage,
  //     timestamp: Date.now(),
  //     contentHint: ContentHint.RESENDABLE,
  //     options,
  //     urgent: true,
  //   })
  // }

  // async syncView(
  //   views: ReadonlyArray<{
  //     senderUuid?: string
  //     senderE164?: string
  //     timestamp: number
  //   }>,
  //   options?: SendOptionsType
  // ): Promise<CallbackResultType> {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()

  //   const syncMessage = MessageSender.createSyncMessage()
  //   syncMessage.viewed = views.map(
  //     (view) =>
  //       new Proto.SyncMessage.Viewed({
  //         ...view,
  //         timestamp: Long.fromNumber(view.timestamp),
  //       })
  //   )
  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return this.sendIndividualProto({
  //     ourAccountId,
  //     identifier: myUuid.toString(),
  //     proto: contentMessage,
  //     timestamp: Date.now(),
  //     contentHint: ContentHint.RESENDABLE,
  //     options,
  //     urgent: false,
  //   })
  // }

  // async syncViewOnceOpen(
  //   viewOnceOpens: ReadonlyArray<{
  //     ourAccountId: string
  //     senderUuid: string
  //     timestamp: number
  //   }>,
  //   options?: Readonly<SendOptionsType>
  // ): Promise<CallbackResultType> {
  //   if (viewOnceOpens.length !== 1) {
  //     throw new Error(
  //       `syncViewOnceOpen: ${viewOnceOpens.length} opens provided. Can only handle one.`
  //     )
  //   }
  //   const { ourAccountId, senderUuid, timestamp } = viewOnceOpens[0]

  //   if (!senderUuid) {
  //     throw new Error('syncViewOnceOpen: Missing senderUuid')
  //   }

  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()

  //   const syncMessage = MessageSender.createSyncMessage()

  //   const viewOnceOpen = new Proto.SyncMessage.ViewOnceOpen()
  //   if (senderE164 !== undefined) {
  //     viewOnceOpen.sender = senderE164
  //   }
  //   viewOnceOpen.senderUuid = senderUuid
  //   viewOnceOpen.timestamp = Long.fromNumber(timestamp)
  //   syncMessage.viewOnceOpen = viewOnceOpen

  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return this.sendIndividualProto({
  //     ourAccountId,
  //     identifier: myUuid.toString(),
  //     proto: contentMessage,
  //     timestamp: Date.now(),
  //     contentHint: ContentHint.RESENDABLE,
  //     options,
  //     urgent: false,
  //   })
  // }

  // static getMessageRequestResponseSync(
  //   options: Readonly<{
  //     threadE164?: string
  //     threadUuid?: string
  //     groupId?: Uint8Array
  //     type: number
  //   }>
  // ): SingleProtoJobData {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()

  //   const syncMessage = MessageSender.createSyncMessage()

  //   const response = new Proto.SyncMessage.MessageRequestResponse()
  //   if (options.threadE164 !== undefined) {
  //     response.threadE164 = options.threadE164
  //   }
  //   if (options.threadUuid !== undefined) {
  //     response.threadUuid = options.threadUuid
  //   }
  //   if (options.groupId) {
  //     response.groupId = options.groupId
  //   }
  //   response.type = options.type
  //   syncMessage.messageRequestResponse = response

  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return {
  //     contentHint: ContentHint.RESENDABLE,
  //     identifier: myUuid.toString(),
  //     isSyncMessage: true,
  //     protoBase64: Bytes.toBase64(MessageDataV2.encode(contentMessage).finish()),
  //     type: 'messageRequestSync',
  //     urgent: false,
  //   }
  // }

  // static getStickerPackSync(
  //   operations: ReadonlyArray<{
  //     packId: string
  //     packKey: string
  //     installed: boolean
  //   }>
  // ): SingleProtoJobData {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()
  //   const ENUM = Proto.SyncMessage.StickerPackOperation.Type

  //   const packOperations = operations.map((item) => {
  //     const { packId, packKey, installed } = item

  //     const operation = new Proto.SyncMessage.StickerPackOperation()
  //     operation.packId = Bytes.fromHex(packId)
  //     operation.packKey = Bytes.fromBase64(packKey)
  //     operation.type = installed ? ENUM.INSTALL : ENUM.REMOVE

  //     return operation
  //   })

  //   const syncMessage = MessageSender.createSyncMessage()
  //   syncMessage.stickerPackOperation = packOperations

  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return {
  //     contentHint: ContentHint.RESENDABLE,
  //     identifier: myUuid.toString(),
  //     isSyncMessage: true,
  //     protoBase64: Bytes.toBase64(MessageDataV2.encode(contentMessage).finish()),
  //     type: 'stickerPackSync',
  //     urgent: false,
  //   }
  // }

  // static getCallEventSync(
  //   peerUuid: string,
  //   callId: string,
  //   isVideoCall: boolean,
  //   isIncoming: boolean,
  //   isAccepted: boolean
  // ): SingleProtoJobData {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()
  //   const syncMessage = MessageSender.createSyncMessage()

  //   const type = isVideoCall
  //     ? Proto.SyncMessage.CallEvent.Type.VIDEO_CALL
  //     : Proto.SyncMessage.CallEvent.Type.AUDIO_CALL
  //   const direction = isIncoming
  //     ? Proto.SyncMessage.CallEvent.Direction.INCOMING
  //     : Proto.SyncMessage.CallEvent.Direction.OUTGOING
  //   const event = isAccepted
  //     ? Proto.SyncMessage.CallEvent.Event.ACCEPTED
  //     : Proto.SyncMessage.CallEvent.Event.NOT_ACCEPTED

  //   syncMessage.callEvent = new Proto.SyncMessage.CallEvent({
  //     peerUuid: uuidToBytes(peerUuid),
  //     callId: Long.fromString(callId),
  //     type,
  //     direction,
  //     event,
  //     timestamp: Long.fromNumber(Date.now()),
  //   })

  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return {
  //     contentHint: ContentHint.RESENDABLE,
  //     identifier: myUuid.toString(),
  //     isSyncMessage: true,
  //     protoBase64: Bytes.toBase64(MessageDataV2.encode(contentMessage).finish()),
  //     type: 'callEventSync',
  //     urgent: false,
  //   }
  // }

  // static getVerificationSync(
  //   destinationE164: string | undefined,
  //   destinationUuid: string | undefined,
  //   state: number,
  //   identityKey: Readonly<Uint8Array>
  // ): SingleProtoJobData {
  //   const myUuid = window.textsecure.storage.user.getCheckedUuid()

  //   if (!destinationE164 && !destinationUuid) {
  //     throw new Error('syncVerification: Neither e164 nor UUID were provided')
  //   }

  //   const padding = MessageSender.getRandomPadding()

  //   const verified = new Proto.Verified()
  //   verified.state = state
  //   if (destinationE164) {
  //     verified.destination = destinationE164
  //   }
  //   if (destinationUuid) {
  //     verified.destinationUuid = destinationUuid
  //   }
  //   verified.identityKey = identityKey
  //   verified.nullMessage = padding

  //   const syncMessage = MessageSender.createSyncMessage()
  //   syncMessage.verified = verified

  //   const contentMessage = new MessageDataV2()
  //   contentMessage.syncMessage = syncMessage

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return {
  //     contentHint: ContentHint.RESENDABLE,
  //     identifier: myUuid.toString(),
  //     isSyncMessage: true,
  //     protoBase64: Bytes.toBase64(MessageDataV2.encode(contentMessage).finish()),
  //     type: 'verificationSync',
  //     urgent: false,
  //   }
  // }

  // Sending messages to contacts

  // async sendCallingMessage(
  //   recipientId: string,
  //   callingMessage: Readonly<Proto.ICallingMessage>,
  //   options?: Readonly<SendOptionsType>
  // ): Promise<CallbackResultType> {
  //   const recipients = [recipientId]
  //   const finalTimestamp = Date.now()

  //   const contentMessage = new MessageDataV2()
  //   contentMessage.callingMessage = callingMessage

  //   // const conversation = window.Signal.conversationController.get(recipientId)

  //   // addPniSignatureMessageToProto({
  //   //   conversation,
  //   //   proto: contentMessage,
  //   //   reason: `sendCallingMessage(${finalTimestamp})`,
  //   // })

  //   const { ContentHint } = Proto.UnidentifiedSenderMessage.Message

  //   return this.sendMessageProtoAndWait({
  //     timestamp: finalTimestamp,
  //     recipients,
  //     proto: contentMessage,
  //     contentHint: ContentHint.DEFAULT,
  //     groupId: undefined,
  //     options,
  //     urgent: true,
  //   })
  // }

  async sendDeliveryReceipt(
    options: Readonly<{
      ourAccountId: AccountIdStringType
      senderId: string
      timestamp: number
      // isDirectConversation: boolean
      options?: Readonly<SendOptionsType>
    }>
  ): Promise<CallbackResultType> {
    return this.sendReceiptMessage({
      ...options,
      type: ReceiptType.DELIVERY,
    })
  }

  async sendReadReceipt(
    options: Readonly<{
      ourAccountId: AccountIdStringType
      senderId: string
      timestamp: number
      // isDirectConversation: boolean
      options?: Readonly<SendOptionsType>
    }>
  ): Promise<CallbackResultType> {
    return this.sendReceiptMessage({
      ...options,
      type: ReceiptType.READ,
    })
  }

  async sendViewedReceipt(
    options: Readonly<{
      ourAccountId: AccountIdStringType
      senderId: string
      timestamp: number
      // isDirectConversation: boolean
      options?: Readonly<SendOptionsType>
    }>
  ): Promise<CallbackResultType> {
    return this.sendReceiptMessage({
      ...options,
      type: ReceiptType.VIEWED,
    })
  }

  private async sendReceiptMessage({
    ourAccountId,
    senderId,
    timestamp,
    type,
    // isDirectConversation,
    options,
  }: Readonly<{
    ourAccountId: AccountIdStringType
    senderId: string
    timestamp: number
    type: ReceiptType
    // isDirectConversation: boolean
    options?: Readonly<SendOptionsType>
  }>): Promise<CallbackResultType> {
    if (!senderId) {
      throw new Error('sendReceiptMessage: senderId was not provided!')
    }

    // const timestamp = Date.now()

    // const receiptMessage = ReceiptMessage
    // receiptMessage.type = type
    // receiptMessage.timestamp = timestamps.map((receiptTimestamp) =>
    //   Long.fromNumber(receiptTimestamp)
    // )

    const contentMessage: MessageDataV2 = {
      version: '2.0.0',
      receiptMessage: { type, timestamp },
    }

    return this.sendIndividualProto({
      ourAccountId,
      identifier: senderId,
      proto: contentMessage,
      timestamp,
      // contentHint: ContentHint.RESENDABLE,
      options,
      // urgent: false,
    })
  }

  // static getNullMessage(
  //   options: Readonly<{
  //     padding?: Uint8Array
  //   }> = {}
  // ): MessageDataV2 {}

  // Group sends

  // Used to ensure that when we send to a group the old way, we save to the send log as
  //   we send to each recipient. Then we don't have a long delay between the first send
  //   and the final save to the database with all recipients.
  // makeSendLogCallback({
  //   contentHint,
  //   messageId,
  //   proto,
  //   sendType,
  //   timestamp,
  //   urgent,
  //   hasPniSignatureMessage,
  // }: Readonly<{
  //   contentHint: number
  //   messageId?: string
  //   proto: Buffer
  //   sendType: SendTypesType
  //   timestamp: number
  //   urgent: boolean
  //   hasPniSignatureMessage: boolean
  // }>): SendLogCallbackType {
  //   let initialSavePromise: Promise<number>

  //   return async ({ identifier, deviceIds }: { identifier: string; deviceIds: Array<number> }) => {
  //     if (!shouldSaveProto(sendType)) {
  //       return
  //     }

  //     const conversation = window.Signal.conversationController.get(identifier)
  //     if (!conversation) {
  //       log.warn(`makeSendLogCallback: Unable to find conversation for identifier ${identifier}`)
  //       return
  //     }
  //     const recipientUuid = conversation.get('uuid')
  //     if (!recipientUuid) {
  //       log.warn(`makeSendLogCallback: Conversation ${conversation.idForLogging()} had no UUID`)
  //       return
  //     }

  //     if (initialSavePromise === undefined) {
  //       initialSavePromise = window.Signal.Data.insertSentProto(
  //         {
  //           contentHint,
  //           proto,
  //           timestamp,
  //           urgent,
  //           hasPniSignatureMessage,
  //         },
  //         {
  //           recipients: { [recipientUuid]: deviceIds },
  //           messageIds: messageId ? [messageId] : [],
  //         }
  //       )
  //       await initialSavePromise
  //     } else {
  //       const id = await initialSavePromise
  //       await window.Signal.Data.insertProtoRecipients({
  //         id,
  //         recipientUuid,
  //         deviceIds,
  //       })
  //     }
  //   }
  // }

  // No functions should really call this; since most group sends are now via Sender Key
  async sendGroupProto({
    ourAccountId,
    groupId,
    // contentHint,
    options,
    proto,
    recipients,
    sendLogCallback,
    // story,
    timestamp = Date.now(),
  }: // urgent,
  Readonly<{
    ourAccountId: AccountIdStringType
    groupId: string | undefined
    // contentHint: number
    options?: SendOptionsType
    proto: MessageDataV2
    recipients: ReadonlyArray<string>
    sendLogCallback?: SendLogCallbackType
    timestamp: number
    // urgent: boolean
  }>): Promise<CallbackResultType> {
    // const myE164 = window.textsecure.storage.user.getNumber()
    // const myUuid = window.textsecure.storage.user.getUuid()?.toString()
    const identifiers = recipients.filter((id) => id !== ourAccountId)

    if (identifiers.length === 0) {
      const dataMessage = proto.dataMessage ? DataMessage.encode(proto.dataMessage).finish() : undefined

      const editMessage = proto.editMessage ? Proto.EditMessage.encode(proto.editMessage).finish() : undefined

      return {
        dataMessage,
        editMessage,
        errors: [],
        failoverIdentifiers: [],
        successfulIdentifiers: [],
        // unidentifiedDeliveries: [],
        // contentHint,
        // urgent,
      }
    }

    return new Promise((resolve, reject) => {
      const callback = (res: CallbackResultType) => {
        if (res.errors && res.errors.length > 0) {
          reject(new SendMessageProtoError(res))
        } else {
          resolve(res)
        }
      }

      this.sendMessageProto({
        callback,
        ourAccountId,
        // contentHint,
        groupId,
        options,
        proto,
        recipients: identifiers,
        sendLogCallback,
        // story,
        timestamp,
        // urgent,
      })
    })
  }

  // async getSenderKeyDistributionMessage(
  //   distributionId: string,
  //   { throwIfNotInDatabase, timestamp }: { throwIfNotInDatabase?: boolean; timestamp: number }
  // ): Promise<MessageDataV2> {}

  // The one group send exception - a message that should never be sent via sender key
  // async sendSenderKeyDistributionMessage(
  //   {
  //     contentHint,
  //     distributionId,
  //     groupId,
  //     identifiers,
  //     throwIfNotInDatabase,
  //     story,
  //     urgent,
  //   }: Readonly<{
  //     contentHint?: number
  //     distributionId: string
  //     groupId: string | undefined
  //     identifiers: ReadonlyArray<string>
  //     throwIfNotInDatabase?: boolean
  //     story?: boolean
  //     urgent: boolean
  //   }>,
  //   options?: Readonly<SendOptionsType>
  // ): Promise<CallbackResultType> {}

  // Simple pass-throughs

  // Note: instead of updating these functions, or adding new ones, remove these and go
  //   directly to window.textsecure.messaging.server.<function>

  // async getProfile(
  //   uuid: UUID,
  //   options: GetProfileOptionsType | GetProfileUnauthOptionsType
  // ): ReturnType<WebAPIType['getProfile']> {
  //   if (options.accessKey !== undefined) {
  //     return this.server.getProfileUnauth(uuid.toString(), options)
  //   }

  //   return this.server.getProfile(uuid.toString(), options)
  // }

  // async getAvatar(path: string): Promise<ReturnType<WebAPIType['getAvatar']>> {
  //   return this.server.getAvatar(path)
  // }

  // async getSticker(
  //   packId: string,
  //   stickerId: number
  // ): Promise<ReturnType<WebAPIType['getSticker']>> {
  //   return this.server.getSticker(packId, stickerId)
  // }

  // async getStickerPackManifest(
  //   packId: string
  // ): Promise<ReturnType<WebAPIType['getStickerPackManifest']>> {
  //   return this.server.getStickerPackManifest(packId)
  // }

  // async createGroup(
  //   group: Readonly<Proto.IGroup>,
  //   options: Readonly<GroupCredentialsType>
  // ): Promise<void> {
  //   return this.server.createGroup(group, options)
  // }

  // async uploadGroupAvatar(
  //   avatar: Readonly<Uint8Array>,
  //   options: Readonly<GroupCredentialsType>
  // ): Promise<string> {
  //   return this.server.uploadGroupAvatar(avatar, options)
  // }

  // async getGroup(options: Readonly<GroupCredentialsType>): Promise<Proto.Group> {
  //   return this.server.getGroup(options)
  // }

  // async getGroupFromLink(
  //   groupInviteLink: string | undefined,
  //   auth: Readonly<GroupCredentialsType>
  // ): Promise<Proto.GroupJoinInfo> {
  //   return this.server.getGroupFromLink(groupInviteLink, auth)
  // }

  // async getGroupLog(
  //   options: GetGroupLogOptionsType,
  //   credentials: GroupCredentialsType
  // ): Promise<GroupLogResponseType> {
  //   return this.server.getGroupLog(options, credentials)
  // }

  // async getGroupAvatar(key: string): Promise<Uint8Array> {
  //   return this.server.getGroupAvatar(key)
  // }

  // async modifyGroup(
  //   changes: Readonly<Proto.GroupChange.IActions>,
  //   options: Readonly<GroupCredentialsType>,
  //   inviteLinkBase64?: string
  // ): Promise<Proto.IGroupChange> {
  //   return this.server.modifyGroup(changes, options, inviteLinkBase64)
  // }

  // async fetchLinkPreviewMetadata(
  //   href: string,
  //   abortSignal: AbortSignal
  // ): Promise<null | LinkPreviewMetadata> {
  //   return this.server.fetchLinkPreviewMetadata(href, abortSignal)
  // }

  // async fetchLinkPreviewImage(
  //   href: string,
  //   abortSignal: AbortSignal
  // ): Promise<null | LinkPreviewImage> {
  //   return this.server.fetchLinkPreviewImage(href, abortSignal)
  // }

  // async makeProxiedRequest(
  //   url: string,
  //   options?: Readonly<ProxiedRequestOptionsType>
  // ): Promise<ReturnType<WebAPIType['makeProxiedRequest']>> {
  //   return this.server.makeProxiedRequest(url, options)
  // }

  // async getStorageCredentials(): Promise<StorageServiceCredentials> {
  //   return this.server.getStorageCredentials()
  // }

  // async getStorageManifest(options: Readonly<StorageServiceCallOptionsType>): Promise<Uint8Array> {
  //   return this.server.getStorageManifest(options)
  // }

  // async getStorageRecords(
  //   data: Readonly<Uint8Array>,
  //   options: Readonly<StorageServiceCallOptionsType>
  // ): Promise<Uint8Array> {
  //   return this.server.getStorageRecords(data, options)
  // }

  // async modifyStorageRecords(
  //   data: Readonly<Uint8Array>,
  //   options: Readonly<StorageServiceCallOptionsType>
  // ): Promise<Uint8Array> {
  //   return this.server.modifyStorageRecords(data, options)
  // }

  // async getGroupMembershipToken(
  //   options: Readonly<GroupCredentialsType>
  // ): Promise<Proto.GroupExternalCredential> {
  //   return this.server.getGroupExternalCredential(options)
  // }

  // public async sendChallengeResponse(challengeResponse: Readonly<ChallengeType>): Promise<void> {
  //   return this.server.sendChallengeResponse(challengeResponse)
  // }

  // async putProfile(
  //   jsonData: Readonly<ProfileRequestDataType>
  // ): Promise<UploadAvatarHeadersType | undefined> {
  //   return this.server.putProfile(jsonData)
  // }

  // async uploadAvatar(
  //   requestHeaders: Readonly<UploadAvatarHeadersType>,
  //   avatarData: Readonly<Uint8Array>
  // ): Promise<string> {
  //   return this.server.uploadAvatar(requestHeaders, avatarData)
  // }
}
