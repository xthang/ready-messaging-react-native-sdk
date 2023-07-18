// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */

import { ConversationType } from 'types/chat'
import { logger as log } from 'utils/logger'
import { z } from 'zod'
import {
  OutgoingMessageError,
  SendMessageNetworkError,
  UnregisteredUserError,
  SendMessageProtoError,
} from '../textsecure/Errors'
import { type CallbackResultType } from '../textsecure/Types'
import { type UUIDStringType } from '../types/UUID'

export const sendTypesEnum = z.enum([
  // Core user interactions, default urgent
  'message',
  'story', // non-urgent
  'callingMessage', // excluded from send log; only call-initiation messages are urgent
  'deleteForEveryone',
  'expirationTimerUpdate', // non-urgent
  'groupChange', // non-urgent
  'reaction',
  'typing', // excluded from send log; non-urgent

  // Responding to incoming messages, all non-urgent
  'deliveryReceipt',
  'readReceipt',
  'viewedReceipt',

  // Encryption housekeeping, default non-urgent
  'nullMessage',
  'profileKeyUpdate',
  'resendFromLog', // excluded from send log, only urgent if original message was urgent
  'retryRequest', // excluded from send log
  'senderKeyDistributionMessage', // only urgent if associated message is

  // Sync messages sent during link, default non-urgent
  'blockSyncRequest',
  'configurationSyncRequest',
  'contactSyncRequest', // urgent because it blocks the link process
  'groupSyncRequest',
  'keySyncRequest', // urgent because it blocks the link process
  'pniIdentitySyncRequest', // urgent because we need our PNI to be fully functional

  // The actual sync messages, which we never send, just receive - non-urgent
  'blockSync',
  'configurationSync',
  'contactSync',
  'groupSync',
  'keySync',
  'pniIdentitySync',

  // Syncs, default non-urgent
  'fetchLatestManifestSync',
  'fetchLocalProfileSync',
  'messageRequestSync',
  'readSync', // urgent
  'sentSync',
  'stickerPackSync',
  'verificationSync',
  'viewOnceSync',
  'viewSync',
  'callEventSync',

  // No longer used, all non-urgent
  'legacyGroupChange',
  'resetSession',
])

export type SendTypesType = z.infer<typeof sendTypesEnum>

export function shouldSaveProto(sendType: SendTypesType): boolean {
  if (sendType === 'callingMessage') {
    return false
  }

  if (sendType === 'resendFromLog') {
    return false
  }

  if (sendType === 'retryRequest') {
    return false
  }

  if (sendType === 'typing') {
    return false
  }

  return true
}

async function processError(error: unknown): Promise<void> {
  const ourAccountId = window.Ready.utils.getCurrentAccount().id

  if (error instanceof OutgoingMessageError || error instanceof SendMessageNetworkError) {
    const conversation = await window.Ready.conversationController.getOrCreate(
      'processError',
      ourAccountId,
      error.identifier as UUIDStringType,
      ConversationType.PRIVATE,
      undefined
    )
    if (error.code === 401 || error.code === 403) {
      // if (
      //   conversation.get('sealedSender') === SEALED_SENDER.ENABLED ||
      //   conversation.get('sealedSender') === SEALED_SENDER.UNRESTRICTED
      // ) {
      //   log.warn(
      //     `handleMessageSend: Got 401/403 for ${conversation.idForLogging()}, removing profile key`
      //   )
      //   void conversation.setProfileKey(undefined)
      // }
      // if (conversation.get('sealedSender') === SEALED_SENDER.UNKNOWN) {
      //   log.warn(
      //     `handleMessageSend: Got 401/403 for ${conversation.idForLogging()}, setting sealedSender = DISABLED`
      //   )
      //   conversation.set('sealedSender', SEALED_SENDER.DISABLED)
      //   updateConversation(conversation.attributes)
      // }
    }
    if (error.code === 404) {
      log.warn(`handleMessageSend: Got 404 for ${conversation.idForLogging()}, marking unregistered.`)
      // conversation.setUnregistered()
    }
  }
  if (error instanceof UnregisteredUserError) {
    const conversation = await window.Ready.conversationController.getOrCreate(
      'processError2',
      ourAccountId,
      error.identifier as UUIDStringType,
      ConversationType.PRIVATE,
      undefined
    )
    log.warn(`handleMessageSend: Got UnregisteredUserError for ${conversation.idForLogging()}, marking unregistered.`)
    // conversation.setUnregistered()
  }
}

export async function handleMessageSend(
  promise: Promise<CallbackResultType>,
  options: {
    messageIds: Array<string>
    sendType: SendTypesType
  }
): Promise<CallbackResultType> {
  try {
    const result = await promise

    // await maybeSaveToSendLog(result, options)

    // await handleMessageSendResult(result.failoverIdentifiers, undefined) // result.unidentifiedDeliveries)

    return result
  } catch (err) {
    processError(err)

    if (err instanceof SendMessageProtoError) {
      // await handleMessageSendResult(err.failoverIdentifiers, undefined) // err.unidentifiedDeliveries)

      err.errors?.forEach(processError)
    }

    throw err
  }
}
