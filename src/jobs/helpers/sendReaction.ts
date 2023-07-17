// Copyright 2023 Ready.io

import { getMessageById } from 'messages/getMessageById'
import { SendStatus, isSent } from 'messages/MessageSendStatus'
import { MessageModel } from 'models/messages'
import { CallbackResultType } from 'textsecure/Types.d'
import { DataMessage, GroupType, MessageReactionData } from 'types/chat'
import { UUID, UUIDStringType } from 'types/UUID'
import { handleMessageSend } from 'utils/handleMessageSend'
import { repeat, zipObject } from 'utils/iterables'
import { LoggerType } from 'utils/logger'
import { isDirectConversation, isMe, isPublicGroup } from 'utils/whatTypeOfConversation'
import type { ConversationModel } from '../../models/conversations'
import * as Errors from '../../types/errors'
import type { ConversationQueueJobBundle, ReactionJobData } from '../conversationJobQueue'
import { handleMultipleSendErrors } from './handleMultipleSendErrors'

export async function sendReaction(
  conversation: ConversationModel,
  { isFinalAttempt, messaging, shouldContinue, timeRemaining, log }: ConversationQueueJobBundle,
  data: ReactionJobData
): Promise<void> {
  const { messageId } = data

  const message = await getMessageById(messageId)
  if (!message) {
    log.info(`message ${messageId} was not found, maybe because it was deleted. Giving up on sending its reactions`)
    return
  }

  const ourAccount = window.Ready.protocol.getAccount(conversation.get('accountId')!)

  const pendingReactionIndex = message
    .get('reactions')!
    .findLastIndex((it) => it.address === ourAccount.address && it.sendStates)
  if (pendingReactionIndex < 0) {
    log.info(`no pending reaction for ${messageId}. Doing nothing`)
    return
  }

  const pendingReaction = message.get('reactions')![pendingReactionIndex]!
  const reactionType = pendingReaction.removed ? 'remove' : 'add'

  const isPublic = isPublicGroup(conversation.attributes)

  // if (!canReact(message.attributes, ourConversationId, findAndFormatContact)) {
  //   log.info(`could not react to ${messageId}. Removing this pending reaction`)
  //   markReactionFailed(message, pendingReaction)
  //   await window.Signal.Data.saveMessage(message.attributes, { ourUuid })
  //   return
  // }

  if (!shouldContinue) {
    log.info(`reacting to message ${messageId} ran out of time. Giving up on sending it`)
    markReactionFailed(message, pendingReaction)
    if (!isPublic) await window.Ready.Data.updateMessage(message.id, message.attributes)
    return
  }

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

    const {
      allRecipientIdentifiers,
      recipientIdentifiersWithoutMe,
      // untrustedUuids,
    } = getRecipients(log, pendingReaction.sendStates, conversation)

    // if (untrustedUuids.length) {
    //   window.reduxActions.conversations.conversationStoppedByMissingVerification({
    //     conversationId: conversation.id,
    //     untrustedUuids,
    //   })
    //   throw new Error(
    //     `Reaction for message ${messageId} sending blocked because ${untrustedUuids.length} conversation(s) were untrusted. Failing this attempt.`
    //   )
    // }

    const dataMessage: DataMessage = {
      uuid: UUID.generate().toString(),
      reactions: [{ ...pendingReaction, reactionType: pendingReaction.removed ? 'remove' : 'add' }],
      reactedMessage: {
        guid: message.get('guid')!,
        source: message.get('source') || ourAccount.address,
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

        createdAt: pendingReaction.timestamp,
        sendAt: pendingReaction.timestamp,
        sendStates: zipObject(
          Object.keys(pendingReaction.sendStates || {}),
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

    if (recipientIdentifiersWithoutMe.length === 0 && !isPublic) {
      log.info('--> sending sync reaction message only:', reactionType, pendingReaction)
      await ephemeralMessageForReactionSend.sendSyncMessageOnly(saveErrors)

      didFullySend = true
      successfulConversationIds.add(ourConversation.id)
    } else {
      // const sendOptions = await getSendOptions(conversation.attributes)

      let promise: Promise<CallbackResultType>
      if (isDirectConversation(conversation.attributes) || isPublicGroup(conversation.attributes)) {
        // if (!isConversationAccepted(conversation.attributes)) {
        //   log.info(`conversation ${conversation.idForLogging()} is not accepted; refusing to send`)
        //   markReactionFailed(message, pendingReaction)
        //   return
        // }
        // if (isConversationUnregistered(conversation.attributes)) {
        //   log.info(`conversation ${conversation.idForLogging()} is unregistered; refusing to send`)
        //   markReactionFailed(message, pendingReaction)
        //   return
        // }
        // if (conversation.isBlocked()) {
        //   log.info(`conversation ${conversation.idForLogging()} is blocked; refusing to send`)
        //   markReactionFailed(message, pendingReaction)
        //   return
        // }

        log.info('--> sending REACTION message to DIRECT recipient/ PUBLIC group:', reactionType, pendingReaction)

        promise = messaging.sendMessageToIdentifier({
          ourAccountId: conversation.get('accountId')!,
          identifier: isPublic ? undefined : conversation.get('identifier'),
          groupId: isPublic ? conversation.get('identifier') : undefined,
          groupType,

          content: dataMessage,

          timestamp: pendingReaction.timestamp,
          // options: sendOptions,
          // urgent: true,
        })
      } else if (groupType === GroupType.PRIVATE || groupType === GroupType.SECRET) {
        log.info('--> sending REACTION message to PRIVATE/SECRET group:', reactionType, pendingReaction)

        throw new Error('unsupported: sending REACTION message to PRIVATE/SECRET group')

        // promise = conversation.queueJob('conversationQueue/sendReaction', (abortSignal) => {
        //   // Note: this will happen for all old jobs queued before 5.32.x
        //   if (isGroupV2(conversation.attributes) && !isNumber(revision)) {
        //     log.error('No revision provided, but conversation is GroupV2')
        //   }

        //   const groupV2Info = conversation.getGroupV2Info({
        //     members: recipientIdentifiersWithoutMe,
        //   })
        //   if (groupV2Info && isNumber(revision)) {
        //     groupV2Info.revision = revision
        //   }

        //   return sendToGroup({
        //     abortSignal,
        //     contentHint: ContentHint.RESENDABLE,
        //     groupSendOptions: {
        //       groupV2: groupV2Info,
        //       reaction: reactionForSend,
        //       timestamp: pendingReaction.timestamp,
        //       expireTimer,
        //       profileKey,
        //     },
        //     messageId,
        //     sendOptions,
        //     sendTarget: conversation.toSenderKeyTarget(),
        //     sendType: 'reaction',
        //     urgent: true,
        //   })
        // })
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
        if (isSent(sendState!.status)) {
          successfulConversationIds.add(conversationId)
        } else {
          didFullySend = false
        }
      }

      // if (!ephemeralMessageForReactionSend.doNotSave) {
      //   const reactionMessage = ephemeralMessageForReactionSend

      //   await Promise.all([
      //     await window.Signal.Data.saveMessage(reactionMessage.attributes, {
      //       ourUuid,
      //       forceSave: true,
      //     }),
      //     reactionMessage.hydrateStoryContext(message.attributes),
      //   ])

      //   void conversation.addSingleMessage(
      //     window.MessageController.register(reactionMessage.id, reactionMessage)
      //   )
      // }
    }

    const newReactions = [...message.get('reactions')!]
    const reactionSendStates = { ...pendingReaction.sendStates }
    Object.keys(reactionSendStates).forEach((k) => {
      reactionSendStates[k] = successfulConversationIds.has(k)
    })
    newReactions[pendingReactionIndex] = {
      ...newReactions[pendingReactionIndex],
      sendStates: reactionSendStates,
    }
    message.set('reactions', newReactions)

    if (!didFullySend) {
      throw new Error('reaction did not fully send')
    }
  } catch (thrownError: unknown) {
    await handleMultipleSendErrors({
      errors: [thrownError, ...sendErrors],
      isFinalAttempt,
      log,
      markFailed: () => markReactionFailed(message, pendingReaction),
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
  reactionSendStates: MessageReactionData['sendStates'],
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

  for (const [id, _isSent] of Object.entries(reactionSendStates!)) {
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

    // if (recipient.isUntrusted()) {
    //   const uuid = recipient.get('uuid')
    //   if (!uuid) {
    //     log.error(
    //       `sendReaction/getRecipients: Untrusted conversation ${recipient.idForLogging()} missing UUID.`
    //     )
    //     continue
    //   }
    //   untrustedUuids.push(uuid)
    //   continue
    // }
    // if (recipient.isUnregistered()) {
    //   continue
    // }
    // if (recipient.isBlocked()) {
    //   continue
    // }

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
  pendingReaction: MessageReactionData
  // apiResponses?: ApiError[]
): void {
  // const newReactions = reactionUtil.markOutgoingReactionFailed(
  //   getReactions(message),
  //   pendingReaction
  // )
  // setReactions(message, newReactions)
  // if (apiResponses?.length) window.utils.notifyApiError(apiResponses[0].problem)
}
