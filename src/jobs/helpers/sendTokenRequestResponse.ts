// Copyright 2023 Ready.io

import { getMessageById } from 'messages/getMessageById'
import { SendStatus, isSent } from 'messages/MessageSendStatus'
import { MessageModel } from 'models/messages'
import { CallbackResultType } from 'textsecure/Types.d'
import { DataMessage, GroupType, RequestTokenData } from 'types/chat'
import { UUID, UUIDStringType } from 'types/UUID'
import { handleMessageSend } from 'utils/handleMessageSend'
import { repeat, zipObject } from 'utils/iterables'
import { LoggerType } from 'utils/logger'
import { isDirectConversation, isMe, isPublicGroup } from 'utils/whatTypeOfConversation'
import type { ConversationModel } from '../../models/conversations'
import * as Errors from '../../types/errors'
import type { ConversationQueueJobBundle, TokenRequestResponseJobData } from '../conversationJobQueue'
import { handleMultipleSendErrors } from './handleMultipleSendErrors'

export async function sendTokenRequestResponse(
  conversation: ConversationModel,
  { isFinalAttempt, messaging, shouldContinue, timeRemaining, log }: ConversationQueueJobBundle,
  data: TokenRequestResponseJobData
): Promise<void> {
  const { messageId, response, timestamp } = data

  const message = await getMessageById(messageId)
  if (!message) {
    log.info(`message ${messageId} was not found, maybe because it was deleted. Giving up on sending its reactions`)
    return
  }

  if (response == null) {
    log.info(`no pending reaction for ${messageId}. Doing nothing`)
    return
  }

  const isPublic = isPublicGroup(conversation.attributes)

  if (!shouldContinue) {
    log.info(`reacting to message ${messageId} ran out of time. Giving up on sending it`)
    markReactionFailed(message, response)
    if (!isPublic) await window.Ready.Data.updateMessage(message.id, message.attributes)
    return
  }

  const ourAccount = window.Ready.protocol.getAccount(conversation.get('accountId')!)
  const ourConversation = await window.Ready.conversationController.getOurConversationOrThrow(ourAccount)

  let sendErrors: Array<Error> = []
  const saveErrors = (errors: Array<Error>): void => {
    sendErrors = errors
  }

  let originalError: Error | undefined

  try {
    if (message.getConversation() !== conversation) {
      log.error(
        `message conversation '${message
          .getConversation()
          ?.idForLogging()}' does not match job conversation ${conversation.idForLogging()}`
      )
      return
    }

    const conversationType = conversation.get('type')
    const groupType = conversation.get('groupType')

    let recipientConversationIds: string[]
    if (isPublic) {
      recipientConversationIds = [conversation.id]
    } else {
      recipientConversationIds = Array.from(conversation.getMemberConversationIds()).concat([ourConversation.id])
    }

    const sendStates = recipientConversationIds.reduce<Record<string, boolean | undefined>>((out, it) => {
      out[it] = undefined
      return out
    }, {})

    const {
      allRecipientIdentifiers,
      recipientIdentifiersWithoutMe,
      // untrustedUuids,
    } = getRecipients(log, sendStates, conversation)

    const dataMessage: DataMessage = {
      uuid: UUID.generate().toString(),
      requestToken: {
        ...message.attributes.requestToken,
        guid: message.attributes.guid,
        rejected: response === 'reject',
      },
    }
    const ephemeralMessageForReactionSend = new window.Ready.types.Message(
      {
        id: undefined,
        uuid: UUID.generate().toString(),
        type: 'outgoing',
        conversationId: conversation.get('id'),
        source: ourAccount.address,

        contentType: undefined,

        dataMessage,

        createdAt: Date.now(),
        sendAt: Date.now(),
        sendStates: zipObject(
          Object.keys(sendStates || {}),
          repeat({
            status: SendStatus.Pending,
            updatedAt: Date.now(),
          })
        ),
      },
      false
    ) as MessageModel

    ephemeralMessageForReactionSend.doNotSave = true

    let didFullySend: boolean
    const successfulConversationIds = new Set<string>()

    if (recipientIdentifiersWithoutMe.length === 0) {
      throw new Error('--> sending Token Request Response in conversation with no recipient')
    } else {
      let promise: Promise<CallbackResultType>
      if (isDirectConversation(conversation.attributes) || isPublicGroup(conversation.attributes)) {
        log.info('--> sending REACTION message to DIRECT recipient/ PUBLIC group:', response)

        promise = messaging.sendMessageToIdentifier({
          ourAccountId: conversation.get('accountId')!,
          identifier: isPublic ? undefined : conversation.get('identifier'),
          groupId: isPublic ? conversation.get('identifier') : undefined,
          groupType,

          content: dataMessage,

          timestamp,
          // options: sendOptions,
          // urgent: true,
        })
      } else if (groupType === GroupType.PRIVATE || groupType === GroupType.SECRET) {
        log.info('--> sending REACTION message to PRIVATE/SECRET group:', response)

        throw new Error('unsupported: sending REACTION message to PRIVATE/SECRET group')
      } else {
        throw new Error(`unknown conversation type ${conversationType} groupType ${groupType}`)
      }

      await ephemeralMessageForReactionSend.send(
        handleMessageSend(promise, {
          messageIds: [messageId],
          sendType: 'reaction',
        }),
        saveErrors
      )

      // Because message.send swallows and processes errors, we'll await the inner promise
      //   to get the SendMessageProtoError, which gives us information upstream
      ///  processors need to detect certain kinds of errors.
      try {
        await promise
      } catch (error) {
        if (error instanceof Error) {
          originalError = error
        } else {
          log.error(`promise threw something other than an error: ${Errors.toLogFormat(error)}`)
        }
      }

      didFullySend = true
      const reactionSendStateByConversationId = ephemeralMessageForReactionSend.get('sendStates') || {}
      for (const [conversationId, sendState] of Object.entries(reactionSendStateByConversationId)) {
        if (isSent(sendState!.status!)) {
          successfulConversationIds.add(conversationId)
        } else {
          didFullySend = false
        }
      }
    }

    if (!didFullySend) {
      throw new Error('reaction did not fully send')
    }

    Object.keys(sendStates).forEach((k) => {
      sendStates[k] = successfulConversationIds.has(k)
    })

    const newResponseData = {
      ...message.get('requestToken'),
      rejected: response === 'reject',
      sendStates,
    }

    message.set('requestToken', newResponseData)
  } catch (thrownError: unknown) {
    await handleMultipleSendErrors({
      errors: [thrownError, ...sendErrors],
      isFinalAttempt,
      log,
      markFailed: () => markReactionFailed(message, response),
      timeRemaining,
      // In the case of a failed group send thrownError will not be SentMessageProtoError,
      //   but we should have been able to harvest the original error. In the Note to Self
      //   send case, thrownError will be the error we care about, and we won't have an
      //   originalError.
      toThrow: originalError || thrownError,
    })
  } finally {
    if (!isPublic)
      await window.Ready.Data.updateMessage(message.id, {
        ...message.attributes,
        reactions: message.attributes.reactions ?? null, // to force update reactions if it is undefined
      })
  }
}

function getRecipients(
  log: LoggerType,
  responseSendStates: RequestTokenData['sendStates'],
  conversation: ConversationModel
): {
  allRecipientIdentifiers: Array<string>
  recipientIdentifiersWithoutMe: Array<string>
  untrustedUuids: Array<UUIDStringType>
} {
  const allRecipientIdentifiers: Array<string> = []
  const recipientIdentifiersWithoutMe: Array<string> = []
  const untrustedUuids: Array<UUIDStringType> = []

  const currentConversationRecipients =
    conversation.get('groupType') === GroupType.PUBLIC
      ? new Set([conversation.get('identifier')])
      : conversation.getMemberConversationIds()

  for (const [id, _isSent] of Object.entries(responseSendStates!)) {
    if (_isSent) continue

    const recipient = window.Ready.conversationController.get(id)
    if (!recipient) {
      continue
    }

    const recipientIdentifier = recipient.get('identifier')
    const isRecipientMe = isMe(recipient.attributes)

    if (!recipientIdentifier || (!currentConversationRecipients.has(id) && !isRecipientMe)) {
      continue
    }

    allRecipientIdentifiers.push(recipientIdentifier)
    if (!isRecipientMe) {
      recipientIdentifiersWithoutMe.push(recipientIdentifier)
    }
  }

  return {
    allRecipientIdentifiers,
    recipientIdentifiersWithoutMe,
    untrustedUuids,
  }
}

function markReactionFailed(
  message: MessageModel,
  response: 'accept' | 'reject'
  // , apiResponses?: ApiError[]
): void {
  // const newReactions = reactionUtil.markOutgoingReactionFailed(
  //   getReactions(message),
  //   pendingReaction
  // )
  // setReactions(message, newReactions)
  // if (apiResponses?.length) window.utils.notifyApiError(apiResponses[0].problem)
}
