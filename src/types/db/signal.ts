import { type AccountIdStringType } from 'types/Account'
import { type QualifiedAddressStringType } from 'types/QualifiedAddress'
import { type ReadyAddressStringType } from 'types/ReadyId'

export type IdentityKeyType = {
  id: `${AccountIdStringType}:${ReadyAddressStringType}`
  ourId: AccountIdStringType
  theirId: ReadyAddressStringType
  // conversationId: string
  publicKey: Uint8Array
  timestamp: number
  firstUse: boolean
  nonblockingApproval: boolean
  verified: number
}
export type IdentityKeyIdType = IdentityKeyType['id']

export type MessageTypeUnhydrated = {
  json: string
}
export type PreKeyType = {
  id: `${AccountIdStringType}:${number}`
  ourId: AccountIdStringType
  keyId: number
  privateKey: Uint8Array
  publicKey: Uint8Array
}
export type PreKeyIdType = PreKeyType['id']

export type SessionType = {
  id: QualifiedAddressStringType
  ourId: AccountIdStringType
  theirId: ReadyAddressStringType
  conversationId: string
  deviceId: number
  record: string
  version?: number
}
export type SessionIdType = SessionType['id']
export type SignedPreKeyType = {
  id: `${AccountIdStringType}:${number}`
  ourId: AccountIdStringType
  keyId: number
  created_at: number
  confirmed: boolean
  privateKey: Uint8Array
  publicKey: Uint8Array
}
export type SignedPreKeyIdType = SignedPreKeyType['id']

export type UnprocessedType = {
  id: string
  guid: string

  accountId: string

  version: number

  sourceUuid?: string
  source?: string
  sourceDevice?: number

  destinationUuid?: string
  // updatedPni?: string

  envelope?: string
  decrypted?: string

  conversationDestinationAddress?: string // this should not be here

  timestamp: number
  // serverGuid?: string
  serverTimestamp?: number
  // receivedAtCounter: number | null
  attempts: number
  messageAgeSec?: number

  urgent?: boolean
  // story?: boolean
  // reportingToken?: string
  background: boolean
}

export type UnprocessedUpdateType = Pick<
  UnprocessedType,
  'source' | 'sourceUuid' | 'sourceDevice' | 'serverTimestamp' | 'decrypted'
>
