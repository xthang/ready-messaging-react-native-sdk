// Copyright 2023 Ready.io

// Captures the globals put in place by preload.js, background.js and others

import { ConversationController } from 'ConversationController'
import { WatermelonDB } from 'db/watermelon'
import { MessageController } from 'MessageController'
import { SignalProtocolStore } from 'SignalProtocolStore'
import AccountManager from 'textsecure/AccountManager'
import MessageReceiver from 'textsecure/MessageReceiver'
import MessageSender from 'textsecure/MessageSender'
import type { AccountIdStringType } from 'types/Account'
import { SendPublicGroupMessageData } from 'types/api/requests/chat'
import { GetChatKeyBundleResult } from 'types/api/responses'
import type { AttachmentType, FileStatus } from 'types/chat'
import type { ReadyAddressStringType } from 'types/ReadyId'

type FileStoreItem = {
  id: string
  messageId?: string
  conversationId?: string
  name?: string
  size: number
  type: AttachmentType
  status: FileStatus
  metadata?: string
  localPath: string
  cloudPath: string
  secure?: boolean
  progress?: number
  decryptionKey?: string
}

declare global {
  // We want to extend various globals, so we need to use interfaces.
  interface Window {
    config: { BASE_FILE_PATH: string }
    utils: {
      getCurrentAccount(): { id: string; address: ReadyAddressStringType }
      getCurrentConversationId(): string

      startDownloadProcess(params: {
        uri: string
        accountId: string
        messageId: string
        attachmentId: string
        conversationId: string
        fileName: string
        fileType: AttachmentType
        secure?: boolean
        decryptionKey?: string
        groupId?: string
      }): Promise<{
        isSuccess: boolean
        data: FileStoreItem
      }>
      encryptFile(params: { inputRri: string; outputUri: string; onProgress?: (val: number) => void }): Promise<{
        key: string
        iv: string
      }>
      uploadFile(params: {
        uri: string
        groupId?: string
        fileName: string
        isAvatar?: boolean
        onProgress?: (val: number) => void
      }): Promise<string>
      startUploadProcess(params: {
        noCopy?: boolean
        uri: string
        attachmentId: string
        messageId: string
        accountId: string
        conversationId: string
        fileName: string
        fileSize?: number
        fileType: AttachmentType
        secure?: boolean
        groupId?: string
        metadata?: string
      }): Promise<{
        isSuccess: boolean
        data: FileStoreItem
      }>
      downloadAttachment: ({
        spaceId,
        attachmentId,
        conversationId,
        name,
        secure,
        decryptionKey,
        fileType,
        groupId,
      }: {
        spaceId: string
        attachmentId: string
        conversationId: string
        name: string
        secure?: boolean | undefined
        decryptionKey?: string | undefined
        fileType?: AttachmentType | undefined
        groupId?: string | undefined
      }) => Promise<FileStoreItem>
      deleteFile: (uri: string) => Promise<void>
    }
    Whisper: {
      events: Backbone.Events
    }
    Ready: {
      Data: WatermelonDB
      protocol: SignalProtocolStore
      accountManager: AccountManager
      conversationController: ConversationController
      messageController: MessageController
      messageSender: MessageSender
      messageReceiver: MessageReceiver

      types: {
        Conversation: any
        Message: any
      }

      api: {
        getKeyBundle: (address: string, deviceId?: number) => Promise<GetChatKeyBundleResult>
      }
    }
  }
}
