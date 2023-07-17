/* eslint-disable import/no-unused-modules */

import { type AccountIdStringType } from 'types/Account'
import { type AttachmentDBType, AttachmentType, type ConversationDBType, type MessageDBType } from 'types/chat'

// Account

export type CreateAccountParams = {
  name: string
  address: string
  avatar: string
  avatarThumb?: string
  customUsername: string
  password: string
  registrationId?: number
  deviceUserId?: number
  publicKey?: string
  privateKey?: string
}

export type UpdateAccountParams = {
  password?: string
  registrationId?: number
  deviceUserId?: number
  publicKey?: string
  privateKey?: string
  name?: string
  avatar?: string
  avatarThumb?: string
  customUsername?: string
}

// Conversation

export type UpdateConversationParams = Partial<
  Pick<
    ConversationDBType,
    | 'name'
    // | 'customUsername'
    | 'description'
    | 'avatar'
    | 'lastSeen'
    | 'lastRead'
    | 'isBLocked'
    | 'muteUntil'
    | 'noPush'
    | 'isAccountDeleted'
  >
>

// Message

export type UpdateMessageParams = Partial<
  Pick<
    MessageDBType,
    | 'guid'
    | 'deletedAt'
    | 'type'
    | 'contentType'
    | 'body'
    | 'sticker'
    | 'gif'
    | 'reactions'
    | 'requestToken'
    | 'isPin'
    | 'sendAt'
    | 'sendStates'
    | 'isSent'
    | 'receivedAt'
    // | 'readAt'
    | 'receiveStatus'
    | 'deletedForEveryoneSendStatus'
    | 'deletedForEveryoneFailed'
    | 'errors'
    | 'dataMessage'
  >
>

// Attachment

export type CreateAttachmentParams = {
  name: string
  type: AttachmentType
  cloudUrl?: string
  localUrl?: string
  secure?: boolean
  metadata?: AttachmentDBType['metadata']
  decryptionKey?: string
  size?: number
}

export type UpdateAttachmentParams = {
  cloudUrl?: string
  localUrl?: string
  metadata?: AttachmentDBType['metadata']
  decryptionKey?: string
  size?: number
  secure?: boolean
}

// Signal pre key

export type CreateSignalPreKeyParams = {
  accountId: AccountIdStringType
  keyId: number
  publicKey: string
  privateKey: string
}

// Signal signed pre key

export type CreateSignalSignedPreKeyParams = {
  accountId: AccountIdStringType
  keyId: number
  publicKey: string
  privateKey: string
  confirmed?: boolean
}

export type UpdateSignalSignedPreKeyParams = {
  confirmed?: boolean
}

// Signal session

export type CreateOrUpdateSignalSessionParams = {
  sessionId: string
  deviceId: number
  record: string
}
