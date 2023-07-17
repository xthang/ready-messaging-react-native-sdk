/* eslint-disable import/no-unused-modules */

import { type ImageSourcePropType } from 'react-native'
import Backbone from 'backbone'

import type { ConversationModel } from 'models/conversations'
import type { MessageModel } from 'models/messages'
import { ReceiveStatus } from '../messages/MessageReceiveStatus'
import { type SendStates } from '../messages/MessageSendStatus'
import { type CustomError } from '../textsecure/Types'
import type { AccountIdStringType } from './Account'
import type { ReadyAddressStringType } from './ReadyId'
import { type UUIDStringType } from './UUID'

export type ConversationDBType = {
  id: string
  accountId: string
  type: ConversationType
  groupType?: GroupType
  identifier: string

  createdAt: number

  name?: string
  description?: string
  avatar?: string

  members?: string[] // for GROUP
  role?: GroupRole
  permissions?: {
    permission: {
      codename: ModeratorPermissions
    }
    is_enabled: boolean
  }[]

  lastMessageId?: string
  unreadCount?: number
  lastSeen?: number // target read
  lastRead?: number // self read
  muteUntil?: number
  noPush?: boolean
  isBLocked?: boolean
  isAccountDeleted?: boolean
}

export type MessageDBType = {
  id: string
  uuid: UUIDStringType
  guid?: UUIDStringType

  createdAt?: number

  conversationId: string
  source: string
  sourceUuid?: UUIDStringType
  sourceDevice?: number

  type: 'outgoing' | 'incoming' | undefined

  contentType: MessageType
  body?: string
  attachments?: AttachmentDBType[]
  sticker?: StickerData
  gif?: {
    type: GifType
    data: {
      id: string
      url: string
      aspectRatio: number
    }
  }
  reactions?: MessageReactionData[]
  sendToken?: SendTokenData
  requestToken?: RequestTokenData
  replyTo?: { guid: UUIDStringType; source: string }
  quote?: {
    messageId?: string
    sourceAddress: string
    destinationAddress: string
    selectedAttachmentIds?: string[]
  }
  pinMessage?: {
    guid: UUIDStringType
    messageId: string
    isPinMessage: boolean
    source: string
    sendAt: number
  }
  event?: EventData

  isPin?: boolean

  sendAt?: number
  isSent?: boolean
  sendStates?: SendStates

  receivedAt?: number
  receiveStatus?: ReceiveStatus
  decryptedAt?: number

  // Should only be present for messages deleted for everyone
  deletedAt?: number
  deletedForEveryoneSendStatus?: Record<string, boolean>
  deletedForEveryoneFailed?: boolean

  errors?: CustomError[]

  dataMessage?: DataMessage // For caching for SYNCING
}

export type AttachmentDBType = {
  id: string
  messageId?: string
  conversationId?: string
  createdAt: number
  name: string
  type: AttachmentType
  size?: number
  metadata?: AttachmentMetadata
  uri?: string // path to file waiting for uploading
  duration?: number
  width?: number
  height?: number
  cloudUrl?: string
  localUrl?: string // path to file stored locally
  secure?: boolean
  decryptionKey?: string
}

// Value for `content` field when submit and receive socket message
export enum MessageContentType {
  MESSAGE = '',
  TYPING = 'typing',
  GIF = 'gif',
  SEEN = 'seen',
  IMG = 'img',
  STICKER = 'sticker',
  EVENT = 'event',
  FILE = 'file',
  DELETED = 'deleted',
  AUDIO = 'audio',
  VIDEO = 'video',
  REACTION = 'reaction',
  SEND_TOKEN = 'send-token',
  REQUEST_TOKEN = 'request-token',
  REQUEST_TOKEN_UPDATE = 'request-token-update',
  MEDIA = 'media',
  PINNED = 'pinned',
}

// Value for `type` of message to store in db
export enum MessageType {
  TYPING = -1, // not store in db
  MESSAGE = 0,
  GIF = 1,
  IMG = 2,
  STICKER = 3,
  EVENT = 4,
  FILE = 5,
  DELETED = 6,
  AUDIO = 7,
  VIDEO = 8,
  SEND_TOKEN = 9,
  REQUEST_TOKEN = 10,
  MEDIA = 11,
  REQUEST_TOKEN_UPDATE = 12,
  PIN = 13,
}

export function mapMessageContentTypeToDB(type: MessageContentType): MessageType | undefined {
  switch (type) {
    case MessageContentType.GIF:
      return MessageType.GIF
    case MessageContentType.IMG:
      return MessageType.IMG
    case MessageContentType.FILE:
      return MessageType.FILE
    case MessageContentType.AUDIO:
      return MessageType.AUDIO
    case MessageContentType.VIDEO:
      return MessageType.VIDEO
    case MessageContentType.MEDIA:
      return MessageType.MEDIA
    case MessageContentType.STICKER:
      return MessageType.STICKER
    case MessageContentType.EVENT:
      return MessageType.EVENT
    case MessageContentType.DELETED:
      return MessageType.DELETED
    case MessageContentType.SEND_TOKEN:
      return MessageType.SEND_TOKEN
    case MessageContentType.REQUEST_TOKEN:
      return MessageType.REQUEST_TOKEN
    case MessageContentType.REQUEST_TOKEN_UPDATE:
      return MessageType.REQUEST_TOKEN_UPDATE
    case MessageContentType.PINNED:
      return MessageType.PIN
    case MessageContentType.MESSAGE:
      return MessageType.MESSAGE
    case MessageContentType.TYPING:
      return MessageType.TYPING
    case MessageContentType.REACTION:
      return undefined
    case MessageContentType.SEEN:
      return undefined
    default:
      throw new Error(`Invalid content type: ${type}`)
  }
}

export function mapMessageToContentType(message: DataMessage): MessageContentType {
  if (message) {
    if (message.attachments?.length) {
      if (message.attachments[0]!.type === AttachmentType.IMAGE) return MessageContentType.MEDIA
      if (message.attachments[0]!.type === AttachmentType.AUDIO) return MessageContentType.AUDIO
      if (message.attachments[0]!.type === AttachmentType.VIDEO) return MessageContentType.MEDIA
      return MessageContentType.FILE
    }
    if (message.gif) return MessageContentType.GIF
    if (message.sticker) return MessageContentType.STICKER
    if (message.event) return MessageContentType.EVENT
    if (message.pinMessage) return MessageContentType.PINNED
    if (message.reactions) return MessageContentType.REACTION
    if (message.deleted) return MessageContentType.DELETED
    if (message.sendToken) return MessageContentType.SEND_TOKEN
    if (message.requestToken) return MessageContentType.REQUEST_TOKEN
    if (message.seenTime) return MessageContentType.SEEN
    if (message.text !== undefined && message.text !== null) return MessageContentType.MESSAGE
  }
  throw new Error(`Unknown message content type`)
}

// Store in db
export enum ConversationType {
  UNKNOWN = -1,
  PRIVATE = 0,
  GROUP = 2,
}

// Store in db
export enum GroupType {
  UNKNOWN = -1,
  PUBLIC = 1,
  PRIVATE = 2,
  SECRET = 3,
}

// Store in db
export enum AttachmentType {
  FILE = 0,
  IMAGE = 1,
  AUDIO = 2,
  VIDEO = 3,
}

// Signal devices
export type ChatDeviceType = {
  device_user_id: number
  registration_id: number
  signed_pre_key: {
    key_id: number
    public_key: string
    signature: string
  }
  pre_key:
    | {
        key_id: number
        public_key: string
      }[]
    | null
}

// GIF
export enum GifType {
  GIPHY = 0,
}

// Event
export enum ConversationEventType {
  PUBLIC_GROUP__CREATED = 'PUBLIC_GROUP__CREATED',
  PUBLIC_GROUP__INFO_UPDATED = 'PUBLIC_GROUP__INFO_UPDATED',
  PUBLIC_GROUP__AVATAR_UPDATED = 'PUBLIC_GROUP__AVATAR_UPDATED',
  PUBLIC_GROUP__NAME_UPDATED = 'PUBLIC_GROUP__NAME_UPDATED',
  PUBLIC_GROUP__MEMBER_JOINED = 'PUBLIC_GROUP__MEMBER_JOINED',
  PUBLIC_GROUP__MEMBER_INVITED = 'PUBLIC_GROUP__MEMBER_INVITED',
  PUBLIC_GROUP__MEMBER_LEFT = 'PUBLIC_GROUP__MEMBER_LEFT',
  PUBLIC_GROUP__MEMBER_KICKED = 'PUBLIC_GROUP__MEMBER_KICKED',
  PUBLIC_GROUP__PRIVACY_CHANGE = 'PUBLIC_GROUP__PRIVACY_CHANGE',
}

// JSON value of `legacy_message` in socket message
export type MessageData = {
  uuid: UUIDStringType
  text?: string
  gif?: {
    type: GifType
    data: string /* {
      id: string
      url: string
      aspectRatio: number
    } */
  }
  event?: EventData
  attachments?: ReadonlyArray<Omit<MessageAttachmentData, 'metadata'> & { metadata?: string }>
  seenTime?: number
  sticker?: StickerData
  deleted?: {
    guid: UUIDStringType
    source: string
    attachments?: {
      cloudUrl: string
    }[]
  }
  reactions?: (MessageReactionData & { reactionType: 'add' | 'replace' | 'remove' })[]
  reactedMessage?: {
    guid: UUIDStringType
    source: string
  }
  replyTo?: {
    guid: UUIDStringType
    source: string
  }
  forwardTo?: {
    sourceAddress: string
    destinationAddress: string
  }
  pinMessage?: {
    guid: UUIDStringType
    messageId: string
    isPinMessage: boolean
    source: string
    sendAt: number
  }
  sendToken?: SendTokenData
  requestToken?: RequestTokenData
  height?: number
}

// New version of MessageData
export type MessageDataV2 = {
  version: string // 1.1.1

  dataMessage?: DataMessage
  syncMessage?: SyncMessage
  receiptMessage?: {
    type: ReceiptType
    timestamp: number
  }
  typingMessage?: {
    timestamp: number
    action: 'started' | 'stopped'
    groupId?: string
  }
  editMessage?: any // TODO
}

// ----------------- LEVEL 1 properties

export type DataMessage = MessageData & {
  group?: { id: UUIDStringType } // with any update related to a group
}

export type SyncMessage = {
  sent?: SyncSentMessage
}

export type SyncSentMessage = {
  destinationAddress?: string
  timestamp: number
  message?: DataMessage
  editMessage?: any // TODO
}

// ----------------- LEVEL 2 properties

export type MessageReactionData = {
  address: string
  reaction: string
  timestamp: number
  removed?: boolean
  sendStates?: Record<string, boolean | undefined>
}

export type SendTokenData = {
  chainId: number
  transactionHash: string
  tokenAddress: string
  tokenSymbol: string
  tokenAmount: string
  timestamp: number
  note: string
  fromAccount: string
  toAccount: string
  fromAddress: string
  toAddress: string
}

export type RequestTokenData = {
  chainId: number
  transactionHash?: string
  tokenSymbol: string
  tokenAmount: string
  tokenAddress: string
  timestamp?: number
  note: string
  fromAccount: string
  toAccount: string
  fromAddress?: string
  toAddress: string
  rejected?: boolean
  guid?: UUIDStringType
  sendStates?: Record<string, boolean | undefined>
}

// Attachments
export type MessageAttachmentData = {
  name: string
  type: AttachmentType
  cloudUrl: string
  localUrl?: string // deleted before send
  secure: boolean
  metadata?: AttachmentDBType['metadata']
  decryptionKey?: string
}

// Sticker
export type StickerData = {
  collection: string
  name: string
}

// Event
export type EventData = {
  type: ConversationEventType
  message?: string
}

// Role
export enum GroupRole {
  OWNER = 'owner',
  MODERATOR = 'moderator',
  MEMBER = 'member',
}

// Moderator permissions
export enum ModeratorPermissions {
  ADD_MEMBERS = 'add_members',
  DELETE_MEMBERS = 'delete_members',
  DELETE_MESSAGES = 'delete_messages',
  CHANGE_GROUP_INFO = 'change_group_info',
  PIN_MESSAGES = 'pin_messages',
}

// File status
export enum FileStatus {
  COPYING = 1,
  UPLOADING = 2,
  DOWNLOADING = 3,
  ENCRYPTING = 4,
  DECRYPTING = 5,
  COMPRESSING = 6,
  UPLOADED = 7,
  DOWNLOADED = 8,
  DECRYPTED = 9,
}

export type AttachmentMetadata = {
  uri?: string
  size?: number
  width?: number
  height?: number
  duration?: number
  blurhash?: string
  thumbnailUri?: string
  isUploaded?: boolean
}

export enum ReceiptType {
  DELIVERY = 0,
  READ = 1,
  VIEWED = 2,
}

export declare class ConversationModelCollectionType extends Backbone.Collection<ConversationModel> {
  resetLookups(): void
  getByIdentifier(
    accountId: AccountIdStringType,
    identifier: UUIDStringType | ReadyAddressStringType
  ): ConversationModel
  getByAccountId(accountId: AccountIdStringType): ConversationModel[]
}

export declare class MessageModelCollectionType extends Backbone.Collection<MessageModel> {}
