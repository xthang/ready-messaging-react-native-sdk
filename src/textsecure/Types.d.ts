// Copyright 2023 Ready.io

import { DataMessage, MessageContentType, MessageType } from 'types/chat'
import { SocketEnvelopType } from 'types/socket'
import type { UUID, UUIDStringType } from 'types/UUID'

export {
  IdentityKeyType,
  IdentityKeyIdType,
  PreKeyIdType,
  PreKeyType,
  SessionIdType,
  SessionType,
  SignedPreKeyIdType,
  SignedPreKeyType,
  UnprocessedType,
  UnprocessedUpdateType,
} from 'types/db'

export type DeviceType = {
  id: number
  identifier: string
  registrationId: number
}

// How the legacy APIs generate these types

export type CompatSignedPreKeyType = {
  keyId: number
  keyPair: KeyPairType
  signature: Uint8Array
}

export type CompatPreKeyType = {
  keyId: number
  keyPair: KeyPairType
}

// How we work with these types thereafter

export type KeyPairType<T = Uint8Array> = {
  pubKey: T
  privKey: T
}

export type OuterSignedPrekeyType = {
  keyId: number
  privKey: Uint8Array
  pubKey: Uint8Array
  createdAt: number

  confirmed: boolean
}

export type ProcessedEnvelope = Readonly<{
  ourAccountId: string

  id: string
  guid: UUIDStringType

  sourceUuid?: UUIDStringType
  sourceAddress?: string
  sourceDevice?: number

  destinationUuid?: UUID

  conversationDestinationAddress?: string // for 1-1 conversation only. This should not be here
  groupId?: UUIDStringType // This should not be here
  publicGroupMessageId?: number // This should not be here

  // Mostly from Proto.Envelope except for null/undefined
  type: SocketEnvelopType

  content?: Uint8Array
  contentType?: MessageContentType // we send multi-type message, so this is not needed

  receivedAt: number
  timestamp: number
  serverTimestamp: number

  urgent?: boolean
}>

export type ProcessedDataMessage = DataMessage & {
  group?: { id: UUIDStringType; type: 'public' | 'private' | 'secret' }
  contentType: MessageType
}

export type CustomError = Error & {
  identifier?: string
  number?: string
}

export type CallbackResultType = {
  successfulIdentifiers?: Array<string>
  failoverIdentifiers?: Array<string>
  errors?: Array<CustomError>
  // unidentifiedDeliveries?: Array<string>
  dataMessage: DataMessage | undefined
  editMessage: DataMessage | undefined

  // If this send is not the final step in a multi-step send, we shouldn't treat its
  //   results we would treat a one-step send.
  sendIsNotFinal?: boolean

  guid?: UUIDStringType
  message_id?: number

  // Fields necessary for send log save
  // contentHint?: number
  // contentProto?: Uint8Array
  timestamp?: number
  recipients?: Record<string, Array<number>>
  // urgent?: boolean
}
