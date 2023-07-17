// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */

import type { PublicKey } from '@readyio/lib-messaging'
import { XEvent } from 'types/event'
import { type AccountIdStringType } from '../types/Account'
import { type ReadyAddressStringType } from '../types/ReadyId'
import { type UUIDStringType } from '../types/UUID'
import type { ProcessedEnvelope, ProcessedDataMessage } from './Types.d'

// export class EmptyEvent extends Event {
//   constructor() {
//     super('empty');
//   }
// }

export class ProgressEvent extends XEvent {
  public readonly count: number

  constructor({ count }: { count: number }) {
    super('progress')

    this.count = count
  }
}

export type TypingEventData = Readonly<{
  // typingMessage: Proto.ITypingMessage
  timestamp: number
  started: boolean
  stopped: boolean
  groupId?: string
}>

export type TypingEventConfig = {
  sender?: string
  senderUuid?: string
  senderDevice: number
  typing: TypingEventData
}

export class TypingEvent extends XEvent {
  public readonly sender?: string

  public readonly senderUuid?: string

  public readonly senderDevice: number

  public readonly typing: TypingEventData

  constructor({ sender, senderUuid, senderDevice, typing }: TypingEventConfig) {
    super('typing')

    this.sender = sender
    this.senderUuid = senderUuid
    this.senderDevice = senderDevice
    this.typing = typing
  }
}

export class ErrorEvent extends XEvent {
  constructor(public readonly error: Error) {
    super('error')
  }
}

// export class ContactSyncEvent extends XEvent {
//   constructor(
//     public readonly contacts: ReadonlyArray<ModifiedContactDetails>,
//     public readonly complete: boolean,
//     public readonly receivedAtCounter: number,
//     public readonly sentAt: number
//   ) {
//     super('contactSync');
//   }
// }

// export type GroupEventData = Omit<ModifiedGroupDetails, 'id'> &
//   Readonly<{
//     id: string;
//   }>;

// export class GroupEvent extends XEvent {
//   constructor(
//     public readonly groupDetails: GroupEventData,
//     public readonly receivedAtCounter: number
//   ) {
//     super('group');
//   }
// }

// export class GroupSyncEvent extends XEvent {
//   constructor() {
//     super('groupSync');
//   }
// }

export class EnvelopeEvent extends XEvent {
  constructor(public readonly envelope: ProcessedEnvelope) {
    super('envelope')
  }
}

//
// Confirmable events below
//

export type ConfirmCallback = () => void

export class ConfirmableEvent extends XEvent {
  constructor(type: string, public readonly confirm: ConfirmCallback) {
    super(type)
  }
}

export type DeliveryEventData = Readonly<{
  timestamp: number
  envelopeTimestamp: number
  source?: string
  sourceUuid?: UUIDStringType
  sourceDevice?: number
  wasSentEncrypted: boolean
}>

export class DeliveryEvent extends ConfirmableEvent {
  constructor(public readonly deliveryReceipt: DeliveryEventData, confirm: ConfirmCallback) {
    super('delivery', confirm)
  }
}

export type DecryptionErrorEventData = Readonly<{
  senderUuid: string
  senderDevice: number
  groupId?: string
  cipherTextBytes?: Uint8Array
  cipherTextType?: number
  contentHint?: number
  timestamp: number
  // receivedAtCounter: number
  receivedAtDate: number
}>

export class DecryptionErrorEvent extends ConfirmableEvent {
  constructor(public readonly decryptionError: DecryptionErrorEventData, confirm: ConfirmCallback) {
    super('decryption-error', confirm)
  }
}

export type InvalidPlaintextEventData = Readonly<{
  senderDevice: number
  senderUuid: string
  timestamp: number
}>

export class InvalidPlaintextEvent extends XEvent {
  constructor(public readonly data: InvalidPlaintextEventData) {
    super('invalid-plaintext')
  }
}

export type RetryRequestEventData = Readonly<{
  groupId?: string
  ratchetKey?: PublicKey
  requesterUuid: UUIDStringType
  requesterDevice: number
  senderDevice: number
  sentAt: number
}>

export class RetryRequestEvent extends ConfirmableEvent {
  constructor(public readonly retryRequest: RetryRequestEventData, confirm: ConfirmCallback) {
    super('retry-request', confirm)
  }
}

export type SentEventData = Readonly<{
  name: 'sent-event'

  guid: UUIDStringType

  accountId: AccountIdStringType

  sourceAddress?: ReadyAddressStringType
  sourceUuid: UUIDStringType | undefined
  sourceDevice: number | undefined

  destinationAddress?: string

  message: ProcessedDataMessage
  publicGroupMessageId?: number // if message is sent to PUBLIC group

  timestamp?: number
  serverTimestamp?: number
  // unidentifiedStatus: ProcessedSent['unidentifiedStatus']
  // isRecipientUpdate: boolean
  // receivedAtCounter: number
  receivedAt: number
}>

export class SentEvent extends ConfirmableEvent {
  constructor(public readonly data: SentEventData, confirm: ConfirmCallback, public readonly background: boolean) {
    super('sent', confirm)
  }
}

export type ProfileKeyUpdateData = Readonly<{
  source?: string
  sourceUuid?: UUIDStringType
  profileKey: string
}>

export class ProfileKeyUpdateEvent extends ConfirmableEvent {
  constructor(public readonly data: ProfileKeyUpdateData, confirm: ConfirmCallback) {
    super('profileKeyUpdate', confirm)
  }
}

export type MessageEventData = Readonly<{
  name: 'message-event'

  guid: UUIDStringType

  accountId: AccountIdStringType

  sourceAddress?: ReadyAddressStringType
  sourceUuid: UUIDStringType
  sourceDevice?: number

  destinationAddress?: ReadyAddressStringType

  publicGroupMessageId?: number // if message is sent to PUBLIC group
  message: ProcessedDataMessage

  timestamp: number
  // serverGuid?: string
  serverTimestamp?: number
  // unidentifiedDeliveryReceived: boolean
  // receivedAtCounter: number
  receivedAt: number
}>

export class MessageEvent extends ConfirmableEvent {
  constructor(public readonly data: MessageEventData, confirm: ConfirmCallback, public readonly background: boolean) {
    super('message', confirm)
  }
}

export type ReadOrViewEventData = Readonly<{
  timestamp: number
  envelopeTimestamp: number
  source?: string
  sourceUuid?: UUIDStringType
  sourceDevice?: number
  wasSentEncrypted: true
}>

export class ReadEvent extends ConfirmableEvent {
  constructor(public readonly receipt: ReadOrViewEventData, confirm: ConfirmCallback) {
    super('read', confirm)
  }
}

export class ViewEvent extends ConfirmableEvent {
  constructor(public readonly receipt: ReadOrViewEventData, confirm: ConfirmCallback) {
    super('view', confirm)
  }
}

// export class ConfigurationEvent extends ConfirmableEvent {
//   constructor(
//     public readonly configuration: Proto.SyncMessage.IConfiguration,
//     confirm: ConfirmCallback
//   ) {
//     super('configuration', confirm)
//   }
// }

export type ViewOnceOpenSyncOptions = {
  source?: string
  sourceUuid?: UUIDStringType
  timestamp?: number
}

export class ViewOnceOpenSyncEvent extends ConfirmableEvent {
  public readonly source?: string

  public readonly sourceUuid?: UUIDStringType

  public readonly timestamp?: number

  constructor({ source, sourceUuid, timestamp }: ViewOnceOpenSyncOptions, confirm: ConfirmCallback) {
    super('viewOnceOpenSync', confirm)

    this.source = source
    this.sourceUuid = sourceUuid
    this.timestamp = timestamp
  }
}

// export type MessageRequestResponseOptions = {
//   threadE164?: string
//   threadUuid?: string
//   messageRequestResponseType: Proto.SyncMessage.IMessageRequestResponse['type']
//   groupId?: string
//   groupV2Id?: string
// }

// export class MessageRequestResponseEvent extends ConfirmableEvent {
//   public readonly threadE164?: string

//   public readonly threadUuid?: string

//   public readonly messageRequestResponseType?: MessageRequestResponseOptions['messageRequestResponseType']

//   public readonly groupId?: string

//   public readonly groupV2Id?: string

//   constructor(
//     {
//       threadE164,
//       threadUuid,
//       messageRequestResponseType,
//       groupId,
//       groupV2Id,
//     }: MessageRequestResponseOptions,
//     confirm: ConfirmCallback
//   ) {
//     super('messageRequestResponse', confirm)

//     this.threadE164 = threadE164
//     this.threadUuid = threadUuid
//     this.messageRequestResponseType = messageRequestResponseType
//     this.groupId = groupId
//     this.groupV2Id = groupV2Id
//   }
// }

// export class FetchLatestEvent extends ConfirmableEvent {
//   constructor(
//     public readonly eventType: Proto.SyncMessage.IFetchLatest['type'],
//     confirm: ConfirmCallback
//   ) {
//     super('fetchLatest', confirm)
//   }
// }

// export class KeysEvent extends ConfirmableEvent {
//   constructor(public readonly storageServiceKey: Uint8Array, confirm: ConfirmCallback) {
//     super('keys', confirm)
//   }
// }

// export type StickerPackEventData = Readonly<{
//   id?: string
//   key?: string
//   isInstall: boolean
//   isRemove: boolean
// }>

// export class StickerPackEvent extends ConfirmableEvent {
//   constructor(
//     public readonly stickerPacks: ReadonlyArray<StickerPackEventData>,
//     confirm: ConfirmCallback
//   ) {
//     super('sticker-pack', confirm)
//   }
// }

export type ReadSyncEventData = Readonly<{
  timestamp?: number
  envelopeTimestamp: number
  sender?: string
  senderUuid?: string
}>

export class ReadSyncEvent extends ConfirmableEvent {
  constructor(public readonly read: ReadSyncEventData, confirm: ConfirmCallback) {
    super('readSync', confirm)
  }
}

export type ViewSyncEventData = Readonly<{
  timestamp?: number
  envelopeTimestamp: number
  senderE164?: string
  senderUuid?: string
}>

export class ViewSyncEvent extends ConfirmableEvent {
  constructor(public readonly view: ViewSyncEventData, confirm: ConfirmCallback) {
    super('viewSync', confirm)
  }
}

export type CallEventSyncEventData = Readonly<{
  timestamp: number
  peerUuid: string
  callId: string
  wasVideoCall: boolean
  wasIncoming: boolean
  wasDeclined: boolean
  acceptedTime: number | undefined
  endedTime: number | undefined
  receivedAtCounter: number
}>

export class CallEventSyncEvent extends ConfirmableEvent {
  constructor(public readonly callEvent: CallEventSyncEventData, confirm: ConfirmCallback) {
    super('callEventSync', confirm)
  }
}

// export type StoryRecipientUpdateData = Readonly<{
//   destinationUuid: string
//   storyMessageRecipients: Array<Proto.SyncMessage.Sent.IStoryMessageRecipient>
//   timestamp: number
// }>

// export class StoryRecipientUpdateEvent extends ConfirmableEvent {
//   constructor(public readonly data: StoryRecipientUpdateData, confirm: ConfirmCallback) {
//     super('storyRecipientUpdate', confirm)
//   }
// }
