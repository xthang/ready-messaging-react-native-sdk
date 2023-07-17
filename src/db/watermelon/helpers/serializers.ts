import { ReceiveStatus } from 'messages/MessageReceiveStatus'
import { type SendStates } from 'messages/MessageSendStatus'
import { type AccountDBType, type AccountIdStringType } from 'types/Account'
import { type AttachmentDBType, type ConversationDBType, type MessageDBType } from 'types/chat'
import type { SignedPreKeyType, IdentityKeyType, IdentityKeyIdType, PreKeyType, SessionType } from 'types/db'
import { type QualifiedAddressStringType } from 'types/QualifiedAddress'
import { type UUIDStringType } from 'types/UUID'
import { fromHexToArray } from 'utils/crypto/utils'
import { logger } from 'utils/logger'
import { loadSecure, removeSecure, saveSecure } from 'utils/storage'
import { SecuredKeys } from '../config'
import {
  Account,
  Attachment,
  Conversation,
  Message,
  SignalIdentityKey,
  SignalPreKey,
  SignalSession,
  SignalSignedPreKey,
} from '../model/models'

export const serializeAccount = async (model: Account, loadSecuredKeys?: boolean) => {
  const res: AccountDBType = {
    id: model.id,
    name: model.name,
    avatar: model.avatar,
    avatarThumb: model.avatarThumb,
    address: model.address,
    password: model.password,
    deviceUserId: model.deviceUserId,
    registrationId: model.registrationId,
    publicKey: model.publicKey,
    privateKey: model.privateKey,
    customUsername: model.customUsername,
  }
  if (loadSecuredKeys) {
    await _loadSecuredKeys(res, 'accounts', model.id)
  }
  return res
}

export function serializeConversation(model: Conversation): ConversationDBType {
  return {
    id: model.id,
    accountId: model.account.id as AccountIdStringType,
    type: model.type,
    groupType: model.groupType,
    identifier: model.identifier,
    name: model.name,
    createdAt: model.createdAt,
    lastSeen: model.lastSeen,
    lastRead: model.lastRead,
    avatar: model.avatar,
    description: model.description,
    // version: 1,
    muteUntil: model.muteUntil,
    noPush: model.noPush,
    isBLocked: model.isBLocked,
    isAccountDeleted: model.isAccountDeleted,
  }
}

export const serializeMessage = (model: Message, attachments: Attachment[] = []): MessageDBType => {
  let sendStates: SendStates
  try {
    if (model.sendStates) sendStates = JSON.parse(model.sendStates)
  } catch (e) {
    logger.error('!-  failed to parse sendStates:', sendStates)
  }
  let receiveStatus: ReceiveStatus
  try {
    if (model.receiveStatus) receiveStatus = JSON.parse(model.receiveStatus)
  } catch (e) {
    logger.error('!-  failed to parse receiveStatus:', receiveStatus)
  }
  let sticker
  let gif
  let event
  let sendToken
  let requestToken
  let errors
  let dataMessage
  try {
    if (model.json) {
      const data = JSON.parse(model.json)

      sticker = data.sticker
      gif = data.gif
      event = data.event
      sendToken = data.sendToken
      requestToken = data.requestToken

      errors = data.errors

      dataMessage = data.dataMessage
    }
  } catch (e) {
    logger.error('!-  failed to parse json:', model.json)
  }

  return {
    id: model.id,
    uuid: model.uuid as UUIDStringType,
    guid: model.guid as UUIDStringType,

    createdAt: model.createdAt,

    source: model.source,
    sourceUuid: model.sourceUUID as UUIDStringType,
    sourceDevice: model.sourceDevice,

    conversationId: model.conversation?.id,

    type: model.type,

    contentType: model.contentType,
    body: model.body,
    attachments: attachments.map((a) => serializeAttachment(a)),
    sticker,
    gif,
    event,
    sendToken,
    requestToken,
    reactions: model.reactions ? JSON.parse(model.reactions) : [],
    replyTo: model.replyTo ? JSON.parse(model.replyTo) : undefined,
    quote: model.quote ? JSON.parse(model.quote) : undefined,

    isPin: model.isPinned,

    sendAt: model.sentAt,
    sendStates,
    isSent: model.isSent,

    receivedAt: model.receivedAt,
    receiveStatus,

    deletedAt: model.deletedAt,
    deletedForEveryoneSendStatus: model.deletedForEveryoneSendStatus
      ? JSON.parse(model.deletedForEveryoneSendStatus)
      : undefined,
    deletedForEveryoneFailed: model.deletedForEveryoneFailed,

    errors,

    dataMessage,
  }
}

export const serializeAttachment = (model: Attachment): AttachmentDBType => ({
  id: model.id,
  messageId: model.message.id as string,
  conversationId: model.conversation.id as string,
  name: model.name,
  type: model.type,
  cloudUrl: model.cloudUrl,
  localUrl: model.localUrl,
  secure: model.secure,
  createdAt: model.createdAt,
  metadata: model.metadata ? JSON.parse(model.metadata) : undefined,
  decryptionKey: model.decryptionKey,
  size: model.size,
})

export const serializeSignalPreKey = (model: SignalPreKey): PreKeyType => ({
  id: model.id as `${AccountIdStringType}:${number}`,
  ourId: (model.account?.id as AccountIdStringType) ?? model._raw.account_id,
  keyId: model.keyId,
  publicKey: fromHexToArray(model.publicKey),
  privateKey: fromHexToArray(model.privateKey),
})

export const serializeSignalSignedPreKey = (model: SignalSignedPreKey): SignedPreKeyType => ({
  id: model.id as `${AccountIdStringType}:${number}`,
  ourId: (model.account?.id as AccountIdStringType) ?? model._raw.account_id,
  keyId: model.keyId,
  publicKey: fromHexToArray(model.publicKey),
  privateKey: fromHexToArray(model.privateKey),
  created_at: model.createdAt,
  confirmed: model.confirmed,
})

export const serializeSignalSession = async (model: SignalSession): Promise<SessionType> => {
  const conversation = await model.conversation.fetch()

  return {
    id: model.id as QualifiedAddressStringType,
    ourId: conversation.account.id as AccountIdStringType,
    theirId: conversation.identifier as UUIDStringType,
    deviceId: model.deviceId,
    conversationId: model.conversation.id as string,
    record: model.record,
  }
}

export const serializeSignalIdentityKey = (model: SignalIdentityKey): IdentityKeyType => ({
  id: model.id as IdentityKeyIdType,
  ourId: model.ourId as AccountIdStringType,
  theirId: model.theirId as UUIDStringType,
  publicKey: fromHexToArray(model.publicKey),
  firstUse: model.firstUse,
  timestamp: model.timestamp,
  verified: model.verified,
  nonblockingApproval: model.nonblockingApproval,
})

// ------------------ SUPPORTING -----------------------

// Get storage key
export const getSecuredStorageKey = (prefix: string, id: string, key: string) => `${prefix}__${id}__${key}`

// Extract key + value from object
export const extractSecuredKeys = (obj: { [key: string]: any }, prefix: string) => {
  const res: {
    [key: string]: string | number | boolean
  } = {}
  if (SecuredKeys[prefix]?.length) {
    SecuredKeys[prefix].forEach((key: string) => {
      if (obj[key] !== undefined && obj[key] !== '' && obj[key] !== null) {
        res[key] = obj[key]

        obj[key] = null
      }
    })
  }
  return res
}

// Store extracted key to storage
export const storeSecuredKeys = (extractedKeys: { [key: string]: any }, prefix: string, id: string) =>
  Promise.all(
    Object.keys(extractedKeys).map((key) => {
      const storageKey = getSecuredStorageKey(prefix, id, key)
      return saveSecure(storageKey, extractedKeys[key])
    })
  )

// Remove all secured keys
export const removeSecuredKeys = async (prefix: string, id: string) => {
  if (SecuredKeys[prefix]?.length) {
    SecuredKeys[prefix].forEach((key: string) => {
      const storageKey = getSecuredStorageKey(prefix, id, key)
      removeSecure(storageKey)
    })
  }
}

// Load key from store and update object
const _loadSecuredKeys = async (obj: { [key: string]: any }, prefix: string, id: string) => {
  if (SecuredKeys[prefix]?.length) {
    await Promise.all(
      SecuredKeys[prefix].map((key: string) =>
        (async () => {
          const storageKey = getSecuredStorageKey(prefix, id, key)
          const val = await loadSecure(storageKey)
          if (obj[key] && !val) {
            await saveSecure(storageKey, obj[key])
          } else {
            obj[key] = val
          }
        })()
      )
    )
  }
}
