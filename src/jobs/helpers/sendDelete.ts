// Copyright 2023 Ready.io

import { type AttachmentDBType, type DataMessage, GroupType, MessageType } from 'types/chat'
import { type UUIDStringType } from 'types/UUID'
import { type LoggerType } from 'utils/logger'
import { getMessageById } from '../../messages/getMessageById'
import type { ConversationModel } from '../../models/conversations'
import type { MessageModel } from '../../models/messages'
import { SendMessageProtoError } from '../../textsecure/Errors'
import type { CallbackResultType } from '../../textsecure/Types.d'
import * as Errors from '../../types/errors'
import { handleMessageSend } from '../../utils/handleMessageSend'
import { isDirectConversation, isMe, isPublicGroup } from '../../utils/whatTypeOfConversation'
import type {
  ConversationQueueJobBundle,
  DeleteForEveryoneJobData,
  DeleteForOnlyMeJobData,
} from '../conversationJobQueue'
import { handleMultipleSendErrors, maybeExpandErrors } from './handleMultipleSendErrors'

export async function sendDeleteForEveryone(
  conversation: ConversationModel,
  { isFinalAttempt, messaging, shouldContinue, timestamp, timeRemaining, log }: ConversationQueueJobBundle,
  data: DeleteForEveryoneJobData
): Promise<void> {
  const { messageId, recipients: recipientsFromJob, attachments: attachmentIds } = data

  const logId = `sendDeleteForEveryone(${conversation.idForLogging()}, ${messageId})`

  const message = await getMessageById(messageId)
  if (!message) {
    log.error(`${logId}: Failed to fetch message. Failing job.`)
    return
  }

  if (!message.attributes.guid) {
    log.error(`${logId}: message UUID is empty. Failing job.`)
    return
  }

  if (!shouldContinue) {
    log.info(`${logId}: Ran out of time. Giving up on sending`)
    void updateMessageWithFailure(message, [new Error('Ran out of time!')], log)
    return
  }

  const account = window.Ready.protocol.getAccount(conversation.get('accountId')!)

  const isPublic = isPublicGroup(conversation.attributes)

  if (!attachmentIds) message.set('deletedAt', Date.now())

  const conversationType = conversation.get('type')
  const groupType = conversation.get('groupType')

  const sendType = 'deleteForEveryone'
  const messageIds = [messageId]

  const deletedForEveryoneSendStatus = message.get('deletedForEveryoneSendStatus')
  const recipients = deletedForEveryoneSendStatus
    ? getRecipientsToDeleteMessage(deletedForEveryoneSendStatus)
    : recipientsFromJob

  await conversation.queueJob('conversationQueue/sendDeleteForEveryone', async (abortSignal) => {
    log.info(`${logId}: Sending deleteForEveryone with timestamp ${timestamp} | attachments: ${attachmentIds}`)

    const attachments = attachmentIds?.map((it) => message.get('attachments')!.find((a) => a.id === it))

    const content: DataMessage = {
      uuid: '' as UUIDStringType,
      deleted: {
        guid: message.attributes.guid,
        source: message.attributes.source,
        attachments: attachments?.map((it) => ({
          cloudUrl: it.cloudUrl,
        })),
      },
    }

    try {
      if (isMe(conversation.attributes)) {
        await handleMessageSend(
          messaging.sendSyncMessage({
            ourAccountId: conversation.get('accountId')!,
            ourAddress: account.address,
            destination: conversation.get('identifier')!,
            // destinationUuid: undefined,

            guid: undefined,

            dataMessage: content,

            // expirationStartTimestamp: this.get('expirationStartTimestamp') || null,
            // conversationIdsSentTo,
            // conversationIdsWithSealedSender,

            timestamp,
            // isUpdate,
            // options: sendOptions,

            // urgent: false,
          }),
          { messageIds, sendType }
        )

        await updateMessageWithSuccessfulSends(message, attachments)
      } else if (isDirectConversation(conversation.attributes) || isPublicGroup(conversation.attributes)) {
        // if (!isConversationAccepted(conversation.attributes)) {
        //   log.info(`conversation ${conversation.idForLogging()} is not accepted; refusing to send`)
        //   void updateMessageWithFailure(
        //     message,
        //     [new Error('Message request was not accepted')],
        //     log
        //   )
        //   return
        // }
        // if (isConversationUnregistered(conversation.attributes)) {
        //   log.info(`conversation ${conversation.idForLogging()} is unregistered; refusing to send`)
        //   void updateMessageWithFailure(
        //     message,
        //     [new Error('Contact no longer has a Signal account')],
        //     log
        //   )
        //   return
        // }
        // if (conversation.isBlocked()) {
        //   log.info(`conversation ${conversation.idForLogging()} is blocked; refusing to send`)
        //   void updateMessageWithFailure(message, [new Error('Contact is blocked')], log)
        //   return
        // }

        log.info('--> sending DELETE message to DIRECT recipient/PUBLIC group ...')

        const result = await handleMessageSend(
          messaging.sendMessageToIdentifier({
            ourAccountId: conversation.get('accountId')!,
            identifier: isPublic ? undefined : conversation.get('identifier'),
            groupId: isPublic ? conversation.get('identifier') : undefined,
            groupType,

            content,

            timestamp,
            // options: sendOptions,
            // urgent: true,
          }),
          { messageIds, sendType }
        )

        if (!isPublic) {
          await handleMessageSend(
            messaging.sendSyncMessage({
              ourAccountId: conversation.get('accountId')!,
              ourAddress: account.address,
              destination: conversation.get('identifier')!,
              // destinationUuid: undefined,

              guid: undefined,

              dataMessage: content,

              // expirationStartTimestamp: this.get('expirationStartTimestamp') || null,
              // conversationIdsSentTo,
              // conversationIdsWithSealedSender,

              timestamp,
              // isUpdate,
              // options: sendOptions,

              // urgent: false,
            }),
            { messageIds, sendType }
          )
        }

        await updateMessageWithSuccessfulSends(message, attachments, result)
      } else if (groupType === GroupType.PRIVATE || groupType === GroupType.SECRET) {
        // if (isGroupV2(conversation.attributes) && !isNumber(revision)) {
        //   log.error('No revision provided, but conversation is GroupV2')
        // }

        // const groupV2Info = conversation.getGroupV2Info({
        //   members: recipients,
        // })
        // if (groupV2Info && isNumber(revision)) {
        //   groupV2Info.revision = revision
        // }

        log.info('--> sending DELETE message to PRIVATE/SECRET group ...')

        throw new Error('unsupported: sending DELETE message to PRIVATE/SECRET group')

        // await wrapWithSyncMessageSend({
        //   conversation,
        //   logId,
        //   messageIds,
        //   send: async () =>
        //     sendToGroup({
        //       abortSignal,
        //       contentHint,
        //       groupSendOptions: {
        //         groupV2: groupV2Info,
        //         deletedForEveryoneTimestamp: targetTimestamp,
        //         timestamp,
        //         profileKey,
        //       },
        //       messageId,
        //       sendOptions,
        //       sendTarget: conversation.toSenderKeyTarget(),
        //       sendType: 'deleteForEveryone',
        //       story,
        //       urgent: true,
        //     }),
        //   sendType,
        //   timestamp,
        // })

        // await updateMessageWithSuccessfulSends(message, attachments, result)
      } else {
        throw new Error(`unknown conversation type ${conversationType} groupType ${groupType}`)
      }
    } catch (error: unknown) {
      if (error instanceof SendMessageProtoError) {
        await updateMessageWithSuccessfulSends(message, attachments, error)
      }

      const errors = maybeExpandErrors(error)
      await handleMultipleSendErrors({
        errors,
        isFinalAttempt,
        log,
        markFailed: () => updateMessageWithFailure(message, errors, log),
        timeRemaining,
        toThrow: error,
      })
    }
  })
}

export async function sendDeleteForOnlyMe(
  conversation: ConversationModel,
  { isFinalAttempt, messaging, shouldContinue, timestamp, timeRemaining, log }: ConversationQueueJobBundle,
  data: DeleteForOnlyMeJobData
): Promise<void> {
  const { messageId, attachments: attachmentIds } = data

  const logId = `sendDeleteForOnlyMe(${conversation.idForLogging()}, ${messageId})`

  const message = await getMessageById(messageId)
  if (!message) {
    log.error(`${logId}: Failed to fetch message. Failing job.`)
    return
  }

  if (!shouldContinue) {
    log.info(`${logId}: Ran out of time. Giving up on sending`)
    void updateMessageWithFailure(message, [new Error('Ran out of time!')], log)
    return
  }

  if (!attachmentIds) message.set('deletedAt', Date.now())

  const attachments = attachmentIds?.map((it) => message.get('attachments')!.find((a) => a.id === it))

  await updateMessageWithSuccessfulSends(message, attachments)
}

function getRecipientsToDeleteMessage(sendStatusByConversationId: Record<string, boolean>): Array<string> {
  return Object.entries(sendStatusByConversationId)
    .filter(([_, isSent]) => !isSent)
    .map(([conversationId]) => {
      const recipient = window.Ready.conversationController.get(conversationId)
      if (!recipient) {
        return null
      }
      // if (recipient.isUnregistered()) {
      //   return null
      // }
      // if (recipient.isBlocked()) {
      //   return null
      // }
      return recipient.get('identifier')
    })
    .filter((it) => it)
}

async function updateMessageWithSuccessfulSends(
  message: MessageModel,
  attachments: AttachmentDBType[] | undefined,
  result?: CallbackResultType | SendMessageProtoError
): Promise<void> {
  const isPublic = message.getConversation()!.isPublicGroup()

  if (attachments) {
    if (!isPublic) {
      attachments.forEach((a) => {
        if (a.localUrl) {
          window.Ready.utils.deleteFile(window.Ready.config.BASE_FILE_PATH + a.localUrl)
        }
        window.Ready.Data.deleteAttachment(a.id)
      })
    }

    const attachmentIdsToDelete = attachments.map((it) => it.id)
    message.set({
      attachments: message.get('attachments')!.filter((it) => !attachmentIdsToDelete.includes(it.id)),
    })

    // reloadCachedDeletedMessage({
    //   accountId: message.getConversation()!.get('accountId'),
    //   conversationId: message.getConversation()!.id,
    //   guid: message.get('guid'),
    //   attachments: attachments as { cloudUrl: string }[],
    // })
  } else {
    if (!result) {
      message.set({
        contentType: MessageType.DELETED,
        deletedForEveryoneSendStatus: {},
        deletedForEveryoneFailed: undefined,
        attachments: undefined,
      })
    } else {
      const deletedForEveryoneSendStatus = {
        ...message.get('deletedForEveryoneSendStatus'),
      }

      result.successfulIdentifiers?.forEach((identifier) => {
        const conversation = window.Ready.conversationController.get(identifier)
        if (!conversation) {
          return
        }
        deletedForEveryoneSendStatus[conversation.id] = true
      })

      message.set({
        contentType: MessageType.DELETED,
        deletedForEveryoneSendStatus,
        deletedForEveryoneFailed: undefined,
        attachments: undefined,
      })
    }

    if (!isPublic) await window.Ready.Data.updateMessage(message.id, message.attributes)

    if (!isPublic) {
      message.get('attachments')?.forEach((a) => {
        if (a.localUrl) {
          window.Ready.utils.deleteFile(window.Ready.config.BASE_FILE_PATH + a.localUrl)
        }
        window.Ready.Data.deleteAttachment(a.id)
      })
    }

    // Reload conversation
    // reloadCachedDeletedMessage({
    //   accountId: message.getConversation().get('accountId'),
    //   conversationId: message.getConversation().id,
    //   guid: message.get('guid'),
    //   attachments: message.get('attachments') as { cloudUrl: string }[],
    //   isMessageDeleted: true,
    // })
  }

  message.getConversation()!.debouncedUpdateLastMessage!('sendDelete')
}

async function updateMessageWithFailure(
  message: MessageModel,
  errors: ReadonlyArray<unknown>,
  log: LoggerType
  // apiErrors?: ApiError[]
): Promise<void> {
  log.error('updateMessageWithFailure: Setting this set of errors', errors.map(Errors.toLogFormat))

  // if (apiErrors?.length) window.utils.notifyApiError(apiErrors[0].problem)

  message.set({ deletedForEveryoneFailed: true })
  if (!message.getConversation()!.isPublicGroup()) await window.Ready.Data.updateMessage(message.id, message.attributes)
}
