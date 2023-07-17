import type {
  CreateAccountParams,
  CreateAttachmentParams,
  CreateOrUpdateSignalSessionParams,
  CreateSignalPreKeyParams,
  CreateSignalSignedPreKeyParams,
  UpdateAccountParams,
  UpdateAttachmentParams,
  UpdateConversationParams,
  UpdateMessageParams,
  UpdateSignalSignedPreKeyParams,
} from 'db/types.d'
import { type ConversationDBType, type MessageDBType } from 'types/chat'
import { type IdentityKeyType, type UnprocessedType } from 'types/db/signal'
import { fromBufferToHex } from 'utils/crypto/utils'
import {
  Account,
  Attachment,
  Conversation,
  Message,
  SignalIdentityKey,
  SignalPreKey,
  SignalSession,
  SignalSignedPreKey,
  UnprocessedData,
} from '../model/models'

// Account

export const mapCreateAccountObj = (obj: any, payload: CreateAccountParams) => {
  const {
    name,
    avatar,
    avatarThumb,
    customUsername,
    password,
    address,
    registrationId,
    deviceUserId,
    publicKey,
    privateKey,
  } = payload
  obj.name = name
  obj.avatar = avatar
  obj.avatarThumb = avatarThumb
  obj.customUsername = customUsername
  obj.password = password
  obj.address = address
  obj.registrationId = registrationId
  obj.deviceUserId = deviceUserId
  obj.publicKey = publicKey
  obj.privateKey = privateKey
}

export const mapUpdateAccountObj = (obj: any, payload: UpdateAccountParams) => {
  const { avatar, avatarThumb, password, customUsername, registrationId, deviceUserId, publicKey, privateKey, name } =
    payload
  if (password) {
    obj.password = password
  }
  if (registrationId) {
    obj.registrationId = registrationId
  }
  if (deviceUserId) {
    obj.deviceUserId = deviceUserId
  }
  if (publicKey) {
    obj.publicKey = publicKey
  }
  if (privateKey) {
    obj.privateKey = privateKey
  }
  if (name) {
    obj.name = name
  }
  if (customUsername) {
    obj.customUsername = customUsername
  }
  if (avatar) {
    obj.avatar = avatar
  }
  if (avatarThumb) {
    obj.avatarThumb = avatarThumb
  }
}

export const mapUnprocessedDataToDB = (obj: UnprocessedData, payload: UnprocessedType) => {
  if (payload.id) obj._raw.id = payload.id
  obj.guid = payload.guid

  obj.version = payload.version

  obj.accountId = payload.accountId

  obj.sourceUuid = payload.sourceUuid
  obj.source = payload.source
  obj.sourceDevice = payload.sourceDevice

  obj.destinationUuid = payload.destinationUuid

  obj.conversationDestinationAdress = payload.conversationDestinationAddress

  obj.envelope = payload.envelope
  obj.decrypted = payload.decrypted

  obj.timestamp = payload.timestamp
  // serverGuid?: string
  obj.serverTimestamp = payload.serverTimestamp
  // receivedAtCounter: number | null
  obj.attempts = payload.attempts
  obj.messageAgeSec = payload.messageAgeSec

  obj.urgent = payload.urgent
  // story?: boolean
  // reportingToken?: string
  obj.background = payload.background
}

// Conversation
export const mapCreateConversationObj = (
  obj: Conversation,
  payload: Omit<ConversationDBType, 'id' | 'createdAt'> & { id?: string },
  account: Account
) => {
  const {
    id,
    identifier,
    type,
    groupType,
    name,
    description,
    avatar,
    lastSeen,
    lastRead,
    muteUntil,
    noPush,
    isBLocked,
    isAccountDeleted,
  } = payload
  if (id) obj._raw.id = id
  if (obj.account) obj.account.set(account)
  else (obj._raw as any).account_id = account.id // jest test
  obj.identifier = identifier
  obj.type = type
  obj.groupType = groupType
  obj.name = name
  obj.lastSeen = lastSeen
  obj.lastRead = lastRead
  obj.createdAt = Date.now()
  if (description) {
    obj.description = description
  }
  if (avatar) {
    obj.avatar = avatar
  }
  obj.muteUntil = muteUntil
  obj.noPush = noPush || false
  obj.isBLocked = isBLocked || false
  obj.isAccountDeleted = isAccountDeleted || false
}

export const mapUpdateConversationObj = (obj: Conversation, payload: UpdateConversationParams) => {
  const {
    name,
    customUsername,
    description,
    avatar,
    lastSeen,
    lastRead,
    muteUntil,
    isBLocked,
    noPush,
    isAccountDeleted,
  } = payload
  if (name) {
    obj.name = name
  }
  if (description) {
    obj.description = description
  }
  if (avatar) {
    obj.avatar = avatar
  }
  if (lastSeen) {
    obj.lastSeen = lastSeen
  }
  if (lastRead) {
    obj.lastRead = lastRead
  }
  if (muteUntil !== undefined) {
    obj.muteUntil = muteUntil
  }
  if (noPush !== undefined) {
    obj.noPush = noPush
  }
  if (isBLocked !== undefined) {
    obj.isBLocked = isBLocked
  }
  if (isAccountDeleted !== undefined) {
    obj.isAccountDeleted = isAccountDeleted
  }
  if (customUsername !== undefined) {
    obj.customUsername = customUsername
  }
}

// Message

export const mapCreateMessageObj = (
  obj: Message,
  payload: Omit<MessageDBType, 'id' | 'createdAt' | 'type'> & Partial<Pick<MessageDBType, 'id' | 'createdAt' | 'type'>>,
  conversation?: Conversation
) => {
  const {
    id,
    uuid,
    guid,
    createdAt,
    source,
    sourceUuid,
    sourceDevice,
    conversationId,
    type,
    contentType,
    body,
    reactions,
    replyTo,
    quote,
    isPin,
    sendAt,
    isSent,
    sendStates,
    receivedAt,
    receiveStatus,
    deletedAt,
    deletedForEveryoneSendStatus,
    deletedForEveryoneFailed,
  } = payload
  if (id) obj._raw.id = id
  obj.uuid = uuid
  obj.guid = guid
  obj.createdAt = createdAt ?? Date.now()
  obj.source = source
  obj.sourceUUID = sourceUuid
  obj.sourceDevice = sourceDevice
  obj.type = type
  obj.contentType = contentType
  obj.body = body
  obj.json = JSON.stringify(payload)
  obj.reactions = reactions && JSON.stringify(reactions)
  obj.replyTo = replyTo && JSON.stringify(replyTo)
  obj.quote = quote && JSON.stringify(quote)
  obj.isPinned = isPin

  if (obj.conversation) {
    if (conversation) obj.conversation.set(conversation)
    else obj.conversation.id = conversationId
  } else (obj._raw as any).conversation_id = conversationId // jest test

  obj.sentAt = sendAt
  obj.isSent = isSent
  obj.sendStates = sendStates && JSON.stringify(sendStates)

  obj.receivedAt = receivedAt
  obj.receiveStatus = receiveStatus ? JSON.stringify(receiveStatus) : undefined

  obj.deletedAt = deletedAt
  obj.deletedForEveryoneSendStatus = deletedForEveryoneSendStatus && JSON.stringify(deletedForEveryoneSendStatus)
  obj.deletedForEveryoneFailed = deletedForEveryoneFailed
}

export const mapUpdateMessageObj = (obj: Message, payload: UpdateMessageParams) => {
  const {
    // id,
    guid,
    type,
    contentType,
    body,
    reactions,
    isPin,
    // readAt,
    sendAt,
    sendStates,
    isSent,
    receivedAt,
    receiveStatus,
    deletedAt,
    deletedForEveryoneSendStatus,
    deletedForEveryoneFailed,
  } = payload

  // if (id !== undefined) obj._raw.id = id // Used to replace message id with the new id after being sent to Public group
  if (guid !== undefined) obj.guid = guid

  if (type !== undefined) obj.type = type
  if (contentType !== undefined) obj.contentType = contentType
  if (body !== undefined) obj.body = body
  obj.json = JSON.stringify({ ...JSON.parse(obj.json), ...payload })
  if (reactions !== undefined) obj.reactions = JSON.stringify(reactions)
  if (isPin !== undefined) obj.isPinned = isPin

  if (sendAt !== undefined) obj.sentAt = sendAt
  if (sendStates !== undefined) obj.sendStates = JSON.stringify(sendStates)
  if (isSent !== undefined) obj.isSent = isSent

  if (receivedAt !== undefined) obj.receivedAt = receivedAt
  if (receiveStatus !== undefined) obj.receiveStatus = receiveStatus

  if (deletedAt !== undefined) obj.deletedAt = deletedAt
  if (deletedForEveryoneSendStatus !== undefined)
    obj.deletedForEveryoneSendStatus = JSON.stringify(deletedForEveryoneSendStatus)
  if (deletedForEveryoneFailed !== undefined) obj.deletedForEveryoneFailed = deletedForEveryoneFailed
}

// Attachment

export const mapCreateAttachmentObj = (
  obj: Attachment,
  payload: CreateAttachmentParams,
  message: Message,
  conversation?: Conversation
) => {
  const { name, type, cloudUrl, localUrl, secure, metadata, decryptionKey, size } = payload
  obj.name = name
  obj.type = type
  obj.cloudUrl = cloudUrl
  obj.localUrl = localUrl
  obj.secure = secure
  obj.createdAt = Date.now()
  obj.metadata = (metadata && JSON.stringify(metadata)) || ''
  obj.decryptionKey = decryptionKey || ''
  obj.size = size || 0

  if (conversation) obj.conversation.set(conversation)
  else obj.conversation.id = message.conversation.id
  obj.message.set(message)
}

export const mapUpdateAttachmentObj = (obj: Attachment, payload: UpdateAttachmentParams) => {
  const { cloudUrl, localUrl, metadata, decryptionKey, size } = payload
  if (cloudUrl) {
    obj.cloudUrl = cloudUrl
  }
  if (localUrl) {
    obj.localUrl = localUrl
  }
  if (metadata) {
    obj.metadata = JSON.stringify(metadata)
  }
  if (decryptionKey !== undefined) {
    obj.decryptionKey = decryptionKey
  }
  if (size !== undefined) {
    obj.size = size
  }
}

// Signal pre key

export const mapCreateSignalPreKeyObj = (obj: SignalPreKey, payload: CreateSignalPreKeyParams, account: Account) => {
  const { keyId, publicKey, privateKey } = payload
  obj.keyId = keyId
  obj.publicKey = publicKey
  obj.privateKey = privateKey
  if (obj.account) obj.account.set(account)
  else (obj._raw as any).account_id = account.id
}

// Signal pre key

export const mapCreateSignalSignedPreKeyObj = (
  obj: SignalSignedPreKey,
  payload: CreateSignalSignedPreKeyParams,
  account: Account
) => {
  const { keyId, publicKey, privateKey, confirmed } = payload
  obj.keyId = keyId
  obj.publicKey = publicKey
  obj.privateKey = privateKey
  obj.confirmed = confirmed || false
  obj.createdAt = Date.now()
  if (obj.account) obj.account.set(account)
  else (obj._raw as any).account_id = account.id
}

export const mapUpdateSignalSignedPreKeyObj = (obj: any, payload: UpdateSignalSignedPreKeyParams) => {
  const { confirmed } = payload
  obj.confirmed = confirmed || false
}

// Signal session

export const mapCreateSignalSessionObj = (
  obj: SignalSession,
  payload: CreateOrUpdateSignalSessionParams,
  conversation: Conversation
) => {
  const { sessionId, deviceId, record } = payload
  obj.sessionId = sessionId
  obj.record = record
  obj.deviceId = deviceId
  if (obj.conversation) obj.conversation.set(conversation)
  else (obj._raw as any).conversation_id = conversation.id // for jest test
}

export const mapUpdateSignalSessionObj = (obj: any, payload: CreateOrUpdateSignalSessionParams) => {
  const { deviceId, record } = payload
  obj.record = record
  obj.deviceId = deviceId
}

// Signal identity key

export const mapCreateSignalIdentityKeyObj = (
  obj: SignalIdentityKey,
  payload: IdentityKeyType
  // conversation?: Conversation
) => {
  const {
    id,
    ourId,
    theirId,
    // conversationId,
    publicKey,
    firstUse,
    timestamp,
    verified,
    nonblockingApproval,
  } = payload
  if (id) obj._raw.id = id
  obj.ourId = ourId
  obj.theirId = theirId
  obj.publicKey = fromBufferToHex(publicKey)
  obj.firstUse = firstUse
  obj.timestamp = timestamp
  obj.verified = verified
  obj.nonblockingApproval = nonblockingApproval
  // if (conversation) obj.conversation.set(conversation)
  // else obj.conversation.id = conversationId
}

export const mapUpdateSignalIdentityKeyObj = (obj: SignalIdentityKey, payload: IdentityKeyType) => {
  const { publicKey, firstUse, timestamp, verified, nonblockingApproval } = payload
  // if (id) obj._raw.id = id
  // obj.ourId = ourId
  // obj.theirId = theirId
  obj.publicKey = fromBufferToHex(publicKey)
  obj.firstUse = firstUse
  obj.timestamp = timestamp
  obj.verified = verified
  obj.nonblockingApproval = nonblockingApproval
}
