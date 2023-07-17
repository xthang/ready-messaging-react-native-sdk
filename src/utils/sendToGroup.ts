// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */

import { strictAssert } from 'utils/assert'
import * as Bytes from 'utils/Bytes'
import type { ConversationModel } from '../models/conversations'
import type { GroupSendOptionsType, SendOptionsType } from '../textsecure/MessageSender'
import type { CallbackResultType } from '../textsecure/Types'
import type { UUIDStringType } from '../types/UUID'

import type { SendTypesType } from './handleMessageSend'

const UNKNOWN_RECIPIENT = 404
const INCORRECT_AUTH_KEY = 401
const ERROR_EXPIRED_OR_MISSING_DEVICES = 409
const ERROR_STALE_DEVICES = 410

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// sendWithSenderKey is recursive, but we don't want to loop back too many times.
const MAX_RECURSION = 10

const ACCESS_KEY_LENGTH = 16
const ZERO_ACCESS_KEY = Bytes.toBase64(new Uint8Array(ACCESS_KEY_LENGTH))

// Public API:

export type SenderKeyTargetType = {
  getGroupId: () => string | undefined
  getMembers: () => Array<ConversationModel>
  hasMember: (uuid: UUIDStringType) => boolean
  idForLogging: () => string
  isGroupV2: () => boolean
  isValid: () => boolean

  getSenderKeyInfo: () => SenderKeyInfoType | undefined
  saveSenderKeyInfo: (senderKeyInfo: SenderKeyInfoType) => Promise<void>
}

export async function sendToGroup({
  abortSignal,
  // contentHint,
  groupSendOptions,
  isPartialSend,
  messageId,
  sendOptions,
  sendTarget,
  sendType,
  story,
  urgent,
}: {
  abortSignal?: AbortSignal
  // contentHint: number
  groupSendOptions: GroupSendOptionsType
  isPartialSend?: boolean
  messageId: string | undefined
  sendOptions?: SendOptionsType
  sendTarget: SenderKeyTargetType
  sendType: SendTypesType
  story?: boolean
  urgent: boolean
}): Promise<CallbackResultType> {
  strictAssert(window.Ready.messageSender, 'sendToGroup: textsecure.messaging not available!')

  const { timestamp } = groupSendOptions
  // const recipients = getRecipients(groupSendOptions)

  throw new Error('...')
  // // First, do the attachment upload and prepare the proto we'll be sending
  // const protoAttributes = window.Signal.messageSender.getAttrsFromGroupOptions(groupSendOptions)
  // const contentMessage = await window.Signal.messageSender.getContentMessage(protoAttributes)

  // // Attachment upload might take too long to succeed - we don't want to proceed
  // // with the send if the caller aborted this call.
  // if (abortSignal?.aborted) {
  //   throw new Error('sendToGroup was aborted')
  // }

  // return sendContentMessageToGroup({
  //   contentHint,
  //   contentMessage,
  //   isPartialSend,
  //   messageId,
  //   recipients,
  //   sendOptions,
  //   sendTarget,
  //   sendType,
  //   story,
  //   timestamp,
  //   urgent,
  // })
}

export async function sendContentMessageToGroup({
  contentHint,
  contentMessage,
  isPartialSend,
  messageId,
  online,
  recipients,
  sendOptions,
  sendTarget,
  sendType,
  story,
  timestamp,
  urgent,
}: {
  contentHint: number
  contentMessage: Proto.Content
  isPartialSend?: boolean
  messageId: string | undefined
  online?: boolean
  recipients: ReadonlyArray<string>
  sendOptions?: SendOptionsType
  sendTarget: SenderKeyTargetType
  sendType: SendTypesType
  story?: boolean
  timestamp: number
  urgent: boolean
}): Promise<CallbackResultType> {
  const logId = sendTarget.idForLogging()
  strictAssert(window.Ready.messageSender, 'sendContentMessageToGroup: textsecure.messaging not available!')
  throw new Error('...')

  // const ourConversationId = window.ConversationController.getOurConversationIdOrThrow()
  // const ourConversation = window.ConversationController.get(ourConversationId)

  // if (
  //   isEnabled('desktop.sendSenderKey3') &&
  //   isEnabled('desktop.senderKey.send') &&
  //   ourConversation?.get('capabilities')?.senderKey &&
  //   sendTarget.isValid()
  // ) {
  //   try {
  //     return await sendToGroupViaSenderKey({
  //       contentHint,
  //       contentMessage,
  //       isPartialSend,
  //       messageId,
  //       online,
  //       recipients,
  //       recursionCount: 0,
  //       sendOptions,
  //       sendTarget,
  //       sendType,
  //       story,
  //       timestamp,
  //       urgent,
  //     })
  //   } catch (error: unknown) {
  //     if (!(error instanceof Error)) {
  //       throw error
  //     }

  //     if (_shouldFailSend(error, logId)) {
  //       throw error
  //     }

  //     log.error(
  //       `sendToGroup/${logId}: Sender Key send failed, logging, proceeding to normal send`,
  //       Errors.toLogFormat(error)
  //     )
  //   }
  // }

  // const sendLogCallback = window.Signal.messageSender.makeSendLogCallback({
  //   contentHint,
  //   messageId,
  //   proto: Buffer.from(Proto.Content.encode(contentMessage).finish()),
  //   sendType,
  //   timestamp,
  //   urgent,
  //   hasPniSignatureMessage: false,
  // })
  // const groupId = sendTarget.isGroupV2() ? sendTarget.getGroupId() : undefined
  // return window.Signal.messageSender.sendGroupProto({
  //   contentHint,
  //   groupId,
  //   options: { ...sendOptions, online },
  //   proto: contentMessage,
  //   recipients,
  //   sendLogCallback,
  //   story,
  //   timestamp,
  //   urgent,
  // })
}
