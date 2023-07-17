// Copyright 2023 Ready.io

import type { CreateAttachmentParams } from 'db/types'
import { generateGroupAttachmentId } from 'helpers'
import { getMessageById } from 'messages/getMessageById'
import { isSent } from 'messages/MessageSendStatus'
import { MessageModel } from 'models/messages'
import { type CallbackResultType } from 'textsecure/Types.d'
import { type AttachmentDBType, type AttachmentMetadata, AttachmentType, ConversationType, GroupType } from 'types/chat'
import { type UUIDStringType } from 'types/UUID'
import { handleMessageSend } from 'utils/handleMessageSend'
import { logger, type LoggerType } from 'utils/logger'
import { isDirectConversation, isGroup, isMe, isPublicGroup } from 'utils/whatTypeOfConversation'
import type { ConversationModel } from '../../models/conversations'
import * as Errors from '../../types/errors'
import type { ConversationQueueJobBundle, NormalMessageSendJobData } from '../conversationJobQueue'
import { handleMultipleSendErrors } from './handleMultipleSendErrors'

const LONG_ATTACHMENT_LIMIT = 2048
const MAX_CONCURRENT_ATTACHMENT_UPLOADS = 5

export async function sendNormalMessage(
  conversation: ConversationModel,
  { isFinalAttempt, messaging, shouldContinue, timeRemaining, log }: ConversationQueueJobBundle,
  data: NormalMessageSendJobData
): Promise<void> {
  const { messageId, editedMessageTimestamp } = data
  const message = await getMessageById(messageId)
  if (!message) {
    log.info(`message ${messageId} was not found, maybe because it was deleted. Giving up on sending it`)
    return
  }

  const messageConversation = message.getConversation()
  if (messageConversation !== conversation) {
    log.error(
      `Message conversation '${messageConversation?.idForLogging()}' does not match job conversation ${conversation.idForLogging()}`
    )
    return
  }

  if (message.get('type') !== 'outgoing') {
    log.error(
      `message ${messageId} was not an outgoing message to begin with. This is probably a bogus job. Giving up on sending it`
    )
    return
  }

  // if (message.isErased() || message.get('deletedForEveryone')) {
  //   log.info(`message ${messageId} was erased. Giving up on sending it`)
  //   return
  // }

  let messageSendErrors: Array<Error> = []

  // We don't want to save errors on messages unless we're giving up. If it's our
  //   final attempt, we know upfront that we want to give up. However, we might also
  //   want to give up if (1) we get a 508 from the server, asking us to please stop
  //   (2) we get a 428 from the server, flagging the message for spam (3) some other
  //   reason not known at the time of this writing.
  //
  // This awkward callback lets us hold onto errors we might want to save, so we can
  //   decide whether to save them later on.
  const saveErrors = isFinalAttempt
    ? undefined
    : (errors: Array<Error>) => {
        messageSendErrors = errors
      }

  if (!shouldContinue) {
    log.info(`message ${messageId} ran out of time. Giving up on sending it`)
    await markMessageFailed(message, [new Error('Message send ran out of time')])
    return
  }

  // let profileKey: Uint8Array | undefined
  // if (conversation.get('profileSharing')) {
  //   profileKey = await ourProfileKeyService.get()
  // }

  const isPublic = isPublicGroup(conversation.attributes)

  let originalError: Error | undefined

  try {
    const {
      allRecipientIdentifiers,
      recipientIdentifiersWithoutMe,
      sentRecipientIdentifiers,
      // untrustedUuids,
    } = getMessageRecipients({
      log,
      message,
      conversation,
    })

    // if (untrustedUuids.length) {
    //   window.reduxActions.conversations.conversationStoppedByMissingVerification({
    //     conversationId: conversation.id,
    //     untrustedUuids,
    //   })
    //   throw new Error(
    //     `Message ${messageId} sending blocked because ${untrustedUuids.length} conversation(s) were untrusted. Failing this attempt.`
    //   )
    // }

    if (
      isGroup(conversation.attributes) &&
      conversation.attributes.groupType !== GroupType.PUBLIC &&
      !allRecipientIdentifiers.length
    ) {
      log.warn(
        `trying to send message ${messageId} but it looks like it was already sent to everyone. This is unexpected, but we're giving up`
      )
      return
    }

    await uploadAttachments(message)

    const { createdAt: messageTimestamp } = message.attributes

    // if (reaction) {
    //   strictAssert(storyMessage, 'Only story reactions can be sent as normal messages')

    //   const ourConversationId = window.ConversationController.getOurConversationIdOrThrow()

    //   if (!canReact(storyMessage.attributes, ourConversationId, findAndFormatContact)) {
    //     log.info(`could not react to ${messageId}. Removing this pending reaction`)
    //     await markMessageFailed(message, [new Error('Could not react to story')])
    //     return
    //   }
    // }

    let messageSendPromise: Promise<CallbackResultType | void>

    if (conversation.attributes.groupType !== GroupType.PUBLIC && recipientIdentifiersWithoutMe.length === 0) {
      if (
        !isMe(conversation.attributes) &&
        !isGroup(conversation.attributes) &&
        sentRecipientIdentifiers.length === 0
      ) {
        log.info('No recipients; not sending to ourselves or to group, and no successful sends. Failing job.')
        void markMessageFailed(message, [new Error('No valid recipients')])
        return
      }

      // We're sending to Note to Self or a 'lonely group' with just us in it
      // or sending a story to a group where all other users don't have the stories
      // capabilities (effectively a 'lonely group' in the context of stories)
      log.info('--> sending SYNC message only ...')

      messageSendPromise = message.sendSyncMessageOnly(saveErrors)
    } else {
      const conversationType = conversation.get('type')
      const groupType = conversation.get('groupType')
      // const sendOptions = await getSendOptions(conversation.attributes)

      let innerPromise: Promise<CallbackResultType>
      if (isDirectConversation(conversation.attributes) || isPublicGroup(conversation.attributes)) {
        if (conversationType === ConversationType.PRIVATE) {
          // if (!isConversationAccepted(conversation.attributes)) {
          //   log.info(`conversation ${conversation.idForLogging()} is not accepted; refusing to send`)
          //   void markMessageFailed(message, [new Error('Message request was not accepted')])
          //   return
          // }
          // if (isConversationUnregistered(conversation.attributes)) {
          //   log.info(`conversation ${conversation.idForLogging()} is unregistered; refusing to send`)
          //   void markMessageFailed(message, [new Error('Contact no longer has a Signal account')])
          //   return
          // }
          // if (conversation.isBlocked()) {
          //   log.info(`conversation ${conversation.idForLogging()} is blocked; refusing to send`)
          //   void markMessageFailed(message, [new Error('Contact is blocked')])
          //   return
          // }

          log.info('--> sending DIRECT message...')
        } else {
          log.info('--> sending PUBLIC group message ...')
        }

        innerPromise = messaging.sendMessageToIdentifier({
          ourAccountId: conversation.get('accountId')!,
          identifier: isPublic ? undefined : recipientIdentifiersWithoutMe[0],
          groupId: isPublic ? conversation.get('identifier') : undefined,
          groupType,

          content: {
            uuid: message.attributes.uuid,
            text: message.attributes.body,
            attachments: message.attributes.attachments?.map((it) => ({
              name: it.name,
              type: it.type,
              cloudUrl: it.cloudUrl,
              secure: it.secure,
              metadata: it.metadata && JSON.stringify(it.metadata),
              decryptionKey: it.decryptionKey,
            })),
            sticker: message.attributes.sticker,
            gif: message.attributes.gif && {
              ...message.attributes.gif,
              data: message.attributes.gif.data && JSON.stringify(message.attributes.gif.data),
            },
            event: message.attributes.event,
            // deleted: message.attributes.deleted,
            replyTo: message.attributes.replyTo,
            forwardTo: message.attributes.quote && {
              destinationAddress: message.attributes.quote.destinationAddress,
              sourceAddress: message.attributes.quote.sourceAddress,
            },
            pinMessage: message.attributes.pinMessage,
            sendToken: message.attributes.sendToken,
            requestToken: message.attributes.requestToken,
          },
          timestamp: messageTimestamp!,
          // Note: 1:1 story replies should not set story=true -   they aren't group sends
          // urgent: true,
        })
      } else if (groupType === GroupType.PRIVATE || groupType === GroupType.SECRET) {
        // Note: this will happen for all old jobs queued beore 5.32.x
        // if (isGroupV2(conversation.attributes) && !isNumber(revision)) {
        //   log.error('No revision provided, but conversation is GroupV2')
        // }

        // const groupV2Info = conversation.getGroupV2Info({
        //   members: recipientIdentifiersWithoutMe,
        // })
        // if (groupV2Info && isNumber(revision)) {
        //   groupV2Info.revision = revision
        // }

        log.info('--> sending PRIVATE/SECRET group message ...')

        throw new Error('unsupported: sending PRIVATE/SECRET group message')
        // innerPromise = conversation.queueJob(
        //   'conversationQueue/sendNormalMessage',
        //   (abortSignal) =>
        //     sendToGroup({
        //       abortSignal,
        //       // contentHint: ContentHint.RESENDABLE,
        //       groupSendOptions: {
        //         attachments,
        //         bodyRanges,
        //         // contact,
        //         deletedForEveryoneTimestamp,
        //         editedMessageTimestamp,
        //         expireTimer,
        //         group: groupV2Info,
        //         messageText: body,
        //         // preview,
        //         // profileKey,
        //         // quote,
        //         sticker,
        //         reaction,
        //         timestamp: messageTimestamp,
        //       },
        //       messageId,
        //       sendOptions,
        //       sendTarget: conversation.toSenderKeyTarget(),
        //       sendType: 'message',
        //       urgent: true,
        //     })
        // )
      } else {
        throw new Error(`unknown conversation type ${conversationType} groupType ${groupType}`)
      }

      messageSendPromise = message.send(
        handleMessageSend(innerPromise, {
          messageIds: [messageId],
          sendType: 'message',
        }),
        saveErrors
      )

      // Because message.send swallows and processes errors, we'll await the inner promise
      //   to get the SendMessageProtoError, which gives us information upstream
      //   processors need to detect certain kinds of situations.
      try {
        await innerPromise
      } catch (error) {
        if (error instanceof Error) {
          originalError = error
        } else {
          log.error(`promiseForError threw something other than an error: ${Errors.toLogFormat(error)}`)
        }
      }
    }

    await messageSendPromise

    const didFullySend = !messageSendErrors.length || didSendToEveryone(message)
    if (!didFullySend) {
      throw new Error('message did not fully send')
    }
  } catch (thrownError: unknown) {
    message.set('isSent', false)
    if (!isPublic) await window.Ready.Data.updateMessage(message.id, { isSent: false })

    const errors = [thrownError, ...messageSendErrors]
    await handleMultipleSendErrors({
      errors,
      isFinalAttempt,
      log,
      markFailed: () => markMessageFailed(message, messageSendErrors),
      timeRemaining,
      // In the case of a failed group send thrownError will not be SentMessageProtoError,
      //   but we should have been able to harvest the original error. In the Note to Self
      //   send case, thrownError will be the error we care about, and we won't have an
      //   originalError.
      toThrow: originalError || thrownError,
    })
  }
}

function getMessageRecipients({
  log,
  conversation,
  message,
}: Readonly<{
  log: LoggerType
  conversation: ConversationModel
  message: MessageModel
}>): {
  allRecipientIdentifiers: Array<string>
  recipientIdentifiersWithoutMe: Array<string>
  sentRecipientIdentifiers: Array<string>
  untrustedUuids: Array<UUIDStringType>
} {
  const allRecipientIdentifiers: Array<string> = []
  const recipientIdentifiersWithoutMe: Array<string> = []
  const untrustedUuids: Array<UUIDStringType> = []
  const sentRecipientIdentifiers: Array<string> = []

  const currentConversationRecipients =
    conversation.get('groupType') === GroupType.PUBLIC
      ? new Set([conversation.get('identifier')])
      : conversation.getMemberConversationIds()

  Object.entries(message.get('sendStates') || {}).forEach(([recipientConversationId, sendState]) => {
    const recipient = window.Ready.conversationController.get(recipientConversationId)
    if (!recipient) {
      return
    }

    const isRecipientMe = isMe(recipient.attributes)

    if (!currentConversationRecipients.has(recipientConversationId) && !isRecipientMe) {
      return
    }

    // if (recipient.isUntrusted()) {
    //   const uuid = recipient.get('uuid')
    //   if (!uuid) {
    //     log.error(
    //       `sendNormalMessage/getMessageRecipients: Untrusted conversation ${recipient.idForLogging()} missing UUID.`
    //     )
    //     return
    //   }
    //   untrustedUuids.push(uuid)
    //   return
    // }
    // if (recipient.isUnregistered()) {
    //   return
    // }
    // if (recipient.isBlocked()) {
    //   return
    // }

    const recipientIdentifier = recipient.get('identifier')
    if (!recipientIdentifier) {
      return
    }

    if (isSent(sendState.status)) {
      sentRecipientIdentifiers.push(recipientIdentifier)
      return
    }

    allRecipientIdentifiers.push(recipientIdentifier)
    if (!isRecipientMe) {
      recipientIdentifiersWithoutMe.push(recipientIdentifier)
    }
  })

  return {
    allRecipientIdentifiers,
    recipientIdentifiersWithoutMe,
    sentRecipientIdentifiers,
    untrustedUuids,
  }
}

async function uploadAttachments(message: MessageModel): Promise<void> {
  if (message.get('quote')) {
    const conversation = message.getConversation()!
    const quote = message.get('quote')!
    const quotedMessage = (await getMessageById(quote.messageId!))!
    const quotedConversation = quotedMessage.getConversation()!

    const attachments = quote.selectedAttachmentIds
      ? quotedMessage.get('attachments')!.filter((it) => quote.selectedAttachmentIds!.includes(it.id))
      : quotedMessage.get('attachments') ?? []

    // download files and then upload
    const downloadedAttachments: AttachmentDBType[] = await Promise.all(
      attachments.map(async (attachment) => {
        const attachmentId = attachment.id

        // if targeted conversation is DIRECT, we download to an encrypted file and then upload it
        if (!isPublicGroup(conversation.attributes)) {
          logger.log('--  sendNormalMessage with QUOTE: targeted conversation is DIRECT')

          const { isSuccess, data } = await window.utils.startDownloadProcess({
            accountId: conversation.get('accountId')!,
            uri: attachment.cloudUrl!,
            attachmentId,
            fileName: attachment.name,
            fileType: attachment.type || AttachmentType.FILE,
            secure: attachment.secure,
            decryptionKey: attachment.decryptionKey,
            conversationId: conversation.id,
            messageId: '',
            groupId: isPublicGroup(quotedConversation.attributes) ? quotedConversation.get('identifier') : undefined,
          })
          if (!isSuccess) {
            // window.utils.notify('error', 'Download failed')
          }

          // encrypt
          const folderPath = `/${conversation.get('accountId')}/chat/${conversation.id}`
          const encryptedLocalPath = `${folderPath}/encrypted-${attachment.name}`

          const encKey = await window.utils.encryptFile({
            inputRri: window.config.BASE_FILE_PATH + data.localPath,
            outputUri: window.config.BASE_FILE_PATH + encryptedLocalPath,
          })

          const uploadUri = window.config.BASE_FILE_PATH + encryptedLocalPath

          // uploadfile
          const res = await window.utils.uploadFile({
            uri: uploadUri,
            fileName: attachment.name,
          })

          return {
            ...attachment,
            uri: uploadUri,
            size: data.size,
            localUrl: data.localPath,
            cloudUrl: res,
            secure: true,
            decryptionKey: JSON.stringify(encKey),
          }
        }

        // OR if target is PUBLIC group and quoted is DIRECT: we upload it uncrypted
        if (!isPublicGroup(quotedConversation.attributes)) {
          logger.log('--  sendNormalMessage with QUOTE: quoted conversation is DIRECT')

          let uploadUri: string
          if (attachment.localUrl?.includes('file://')) {
            // Forward from saved message screen
            uploadUri = attachment.localUrl
          } else {
            uploadUri = window.config.BASE_FILE_PATH + attachment.localUrl
          }

          const res = await window.utils.uploadFile({
            uri: uploadUri,
            fileName: attachment.name,
            groupId: conversation.get('identifier'),
          })

          return {
            ...attachment,
            uri: uploadUri,
            cloudUrl: res,
            secure: false,
            decryptionKey: null,
          }
        }

        // OR if target is PUBLIC group and quoted is DIRECT: we just forward it
        logger.log('--  sendNormalMessage with QUOTE: both targeted & quoted conversations are PUBLIC')

        return { ...attachment }
      })
    )

    message.set({
      contentType: quotedMessage.get('contentType'),
      attachments: downloadedAttachments,
      body: quotedMessage.get('body'),
      sticker: quotedMessage.get('sticker'),
      gif: quotedMessage.get('gif'),
      pinMessage: quotedMessage.get('pinMessage') && { ...quotedMessage.get('pinMessage') },
      sendToken: quotedMessage.get('sendToken') && { ...quotedMessage.get('sendToken') },
      requestToken: quotedMessage.get('requestToken') && { ...quotedMessage.get('requestToken') },
    })
  }

  // Create in DB first
  if (message.get('attachments')) {
    const saveResult = await saveAttachments(message)
    message.set({ attachments: saveResult })

    const uploadResult = await Promise.all(
      message.get('attachments')!.map(async (attachment) => uploadSingleAttachment(message, attachment))
    )
    message.set({ attachments: uploadResult })
  }
  // uploadQueue.add(async () =>
  //   maybeLongAttachment ? uploadAttachment(maybeLongAttachment) : undefined
  // ),
  // uploadMessageContacts(message, uploadQueue),
  // uploadMessagePreviews(message, uploadQueue),
  // uploadMessageQuote(message, uploadQueue),

  // Save message after uploading attachments
  if (!isPublicGroup(message.getConversation()!.attributes))
    await window.Ready.Data.updateMessage(message.id, message.attributes)
}

async function saveAttachments(message: MessageModel): Promise<AttachmentDBType[]> {
  const conversation = message.getConversation()!.attributes
  const isPublic = isPublicGroup(conversation)
  const attachments = message.get('attachments') ?? []

  return Promise.all(
    attachments.map(async (attachment, index) => {
      // const { type } = attachment
      // const metadata = await getFileMetadata(attachment, type, true)

      const newValue: AttachmentDBType = {
        ...attachment,
        messageId: message.id,
        conversationId: conversation.id,
        // metadata: JSON.stringify(metadata),
      }

      let attachmentId: string
      if (!isPublic) {
        // Create attachment
        attachmentId = await window.Ready.Data.createAttachment(
          newValue as CreateAttachmentParams & { messageId: string; conversationId: string }
        )
      } else {
        // Chat group
        attachmentId = generateGroupAttachmentId(conversation.id, message.id, index)
      }
      // return { ...newValue, id: attachmentId, metadata: JSON.stringify(metadata) }
      return { ...newValue, id: attachmentId }
    })
  )
}

async function uploadSingleAttachment(message: MessageModel, attachment: AttachmentDBType): Promise<AttachmentDBType> {
  if (attachment.cloudUrl) {
    return attachment
  }

  logger.log('--> sendNormalMsg.uploadAttachment:', attachment)

  const { name, type, size, uri } = attachment
  const conversation = message.getConversation()!.attributes
  const isPublic = isPublicGroup(conversation)

  const uploadResult: AttachmentDBType = {
    ...attachment,
    messageId: message.id,
    conversationId: conversation.id,
    secure: !isPublic,
  }

  let metadata = attachment.metadata
  const uploadMetadata = await getFileMetadata(attachment, type)

  // Upload
  const { isSuccess, data } = await window.utils.startUploadProcess({
    uri,
    attachmentId: attachment.id,
    messageId: message.id,
    accountId: message.getConversation()!.get('accountId')!,
    conversationId: conversation.id,
    fileName: name,
    fileSize: size,
    fileType: type,
    secure: !isPublic,
    groupId: isPublic ? conversation.identifier : undefined,
    metadata: JSON.stringify(uploadMetadata),
  })
  if (!isSuccess) {
    // window.utils.notify('error', 'Upload failed')
    message.set({ isSent: false })
    if (!isPublic) {
      await window.Ready.Data.updateMessage(message.id, { isSent: false })
    }
    metadata = { ...metadata, ...uploadMetadata, isUploaded: isSuccess, isUpload: isSuccess, uri }
  }

  const toUpdate = {
    localUrl: isSuccess ? data.localPath : '',
    cloudUrl: isSuccess ? data.cloudPath : '',
    decryptionKey: isSuccess ? data.decryptionKey : '',
    metadata,
  }
  Object.assign(uploadResult, toUpdate)

  // Update local path of attachment in db
  if (!isPublic) {
    await window.Ready.Data.updateAttachment(attachment.id, toUpdate)
  }

  return uploadResult
}

const getFileMetadata = async (
  file: any,
  fileType: AttachmentType,
  isTemp?: true
): Promise<AttachmentMetadata | undefined> => {
  const metadata: AttachmentMetadata = {
    duration: file.duration,
    // blurhash,
    width: file.width,
    height: file.height,
  }
  switch (fileType) {
    case AttachmentType.FILE:
    case AttachmentType.AUDIO:
      return {
        ...metadata,
        size: file.size,
      }
    case AttachmentType.VIDEO:
      if (isTemp) {
        return {
          ...metadata,
          uri: file.uri,
        }
      }
      return {
        // blurhash: await generateBlurHashString(file.uri, 'vid'),
      }
    case AttachmentType.IMAGE:
      if (isTemp) {
        return {
          ...metadata,
          uri: file.uri,
        }
      }
      return {
        // blurhash: await generateBlurHashString(file.uri, 'img'),
      }
    default:
      return undefined
  }
}

async function markMessageFailed(
  message: MessageModel,
  errors: Array<Error>
  // apiResponses?: ApiError[]
): Promise<void> {
  // if (apiResponses?.length) window.utils.notifyApiError(apiResponses[0].problem)
  message.markFailed()
  void message.saveErrors(errors, { skipSave: true })
  if (!isPublicGroup(message.getConversation()!.attributes))
    await window.Ready.Data.updateMessage(message.id, message.attributes)
}

function didSendToEveryone(message: Readonly<MessageModel>): boolean {
  const sendStateByConversationId = message.get('sendStates')!
  return Object.values(sendStateByConversationId).every((sendState) => isSent(sendState.status))
}
