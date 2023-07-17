// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */

import type PQueue from 'p-queue'
import { ConversationType } from 'types/chat'
import { strictAssert } from 'utils/assert'
import { isTestEnvironment } from 'utils/environment'
import type { LoggerType } from 'utils/logger'
import { z } from 'zod'
import { OutgoingIdentityKeyError, SendMessageProtoError } from '../textsecure/Errors'
import MessageSender from '../textsecure/MessageSender'
import type { UUIDStringType } from '../types/UUID'
import * as durations from '../utils/durations'
import { exponentialBackoffMaxAttempts } from '../utils/exponentialBackoff'
import { commonShouldJobContinue } from './helpers/commonShouldJobContinue'
import { InMemoryQueues } from './helpers/InMemoryQueues'
import { sendDeleteForEveryone, sendDeleteForOnlyMe } from './helpers/sendDelete'
import { sendGroupUpdate } from './helpers/sendGroupUpdate'
import { sendNormalMessage } from './helpers/sendNormalMessage'
import { sendReaction } from './helpers/sendReaction'
import { sendReceipts } from './helpers/sendReceipts'
import { sendTokenRequestResponse } from './helpers/sendTokenRequestResponse'
import type { Job } from './Job'
import { JobQueue } from './JobQueue'
import { jobQueueDatabaseStore } from './JobQueueDatabaseStore'
import type { ParsedJob } from './types'

// Note: generally, we only want to add to this list. If you do need to change one of
//   these values, you'll likely need to write a database migration.
export const conversationQueueJobEnum = z.enum([
  'NormalMessage',
  'Reaction',
  'Receipts',
  'DeleteForEveryone',
  'DeleteForOnlyMe',
  // 'DeleteStoryForEveryone',
  // 'DirectExpirationTimerUpdate',
  'GroupUpdate',
  // 'ProfileKey',
  'ResendRequest',
  // 'SavedProto',
  // 'SenderKeyDistribution',
  // 'Story',
  'TokenRequestResponse',
])

const normalMessageSendJobDataSchema = z.object({
  type: z.literal(conversationQueueJobEnum.enum.NormalMessage),
  conversationId: z.string(),
  messageId: z.string(),
  // Note: recipients are baked into the message itself
  revision: z.number().optional(),
  // See sendEditedMessage
  editedMessageTimestamp: z.number().optional(),
})
export type NormalMessageSendJobData = z.infer<typeof normalMessageSendJobDataSchema>

const deleteForEveryoneJobDataSchema = z.object({
  type: z.literal(conversationQueueJobEnum.enum.DeleteForEveryone),
  // sender: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  recipients: z.array(z.string()),
  attachments: z.optional(z.array(z.string())),
})
export type DeleteForEveryoneJobData = z.infer<typeof deleteForEveryoneJobDataSchema>

const deleteForOnlyMeJobDataSchema = z.object({
  type: z.literal(conversationQueueJobEnum.enum.DeleteForOnlyMe),
  conversationId: z.string(),
  messageId: z.string(),
  attachments: z.optional(z.array(z.string())),
})
export type DeleteForOnlyMeJobData = z.infer<typeof deleteForOnlyMeJobDataSchema>

const reactionJobDataSchema = z.object({
  type: z.literal(conversationQueueJobEnum.enum.Reaction),
  conversationId: z.string(),
  messageId: z.string(),
  // Note: recipients are baked into the message itself
  // revision: z.number().optional(),
})
export type ReactionJobData = z.infer<typeof reactionJobDataSchema>

const groupUpdateJobDataSchema = z.object({
  type: z.literal(conversationQueueJobEnum.enum.GroupUpdate),
  sender: z.string(),
  conversationId: z.string(),
  groupChangeBase64: z.string().optional(),
  recipients: z.array(z.string()),
  revision: z.number(),
})
export type GroupUpdateJobData = z.infer<typeof groupUpdateJobDataSchema>

const resendRequestJobDataSchema = z.object({
  type: z.literal(conversationQueueJobEnum.enum.ResendRequest),
  conversationId: z.string(),
  contentHint: z.number().optional(),
  groupId: z.string().optional(),
  plaintext: z.string(),
  receivedAtCounter: z.number(),
  receivedAtDate: z.number(),
  senderUuid: z.string(),
  senderDevice: z.number(),
  timestamp: z.number(),
})
export type ResendRequestJobData = z.infer<typeof resendRequestJobDataSchema>

export enum ReceiptType {
  Delivery = 'deliveryReceipt',
  Read = 'readReceipt',
  Viewed = 'viewedReceipt',
}
const receiptsJobDataSchema = z.object({
  type: z.literal(conversationQueueJobEnum.enum.Receipts),
  conversationId: z.string(),
  receiptType: z.nativeEnum(ReceiptType),
  timestamp: z.number(),
})
export type ReceiptsJobData = z.infer<typeof receiptsJobDataSchema>

const tokenRequestResponseJobDataSchema = z.object({
  type: z.literal(conversationQueueJobEnum.enum.TokenRequestResponse),
  conversationId: z.string(),
  messageId: z.string(),
  response: z.union([z.literal('accept'), z.literal('reject')]),
  timestamp: z.number(),
})
export type TokenRequestResponseJobData = z.infer<typeof tokenRequestResponseJobDataSchema>

const conversationQueueJobDataSchema = z.union([
  deleteForEveryoneJobDataSchema,
  deleteForOnlyMeJobDataSchema,
  // deleteStoryForEveryoneJobDataSchema,
  // expirationTimerUpdateJobDataSchema,
  groupUpdateJobDataSchema,
  normalMessageSendJobDataSchema,
  // nullMessageJobDataSchema,
  // profileKeyJobDataSchema,
  reactionJobDataSchema,
  resendRequestJobDataSchema,
  // savedProtoJobDataSchema,
  // senderKeyDistributionJobDataSchema,
  // storyJobDataSchema,
  receiptsJobDataSchema,
  tokenRequestResponseJobDataSchema,
])
type ConversationQueueJobData = z.infer<typeof conversationQueueJobDataSchema>

export type ConversationQueueJobBundle = {
  isFinalAttempt: boolean
  log: LoggerType
  messaging: MessageSender
  shouldContinue: boolean
  timeRemaining: number
  timestamp: number
}

const MAX_RETRY_TIME = durations.DAY
const MAX_ATTEMPTS = isTestEnvironment() ? 1 : exponentialBackoffMaxAttempts(MAX_RETRY_TIME)

class ConversationJobQueue extends JobQueue<ConversationQueueJobData> {
  private readonly inMemoryQueues = new InMemoryQueues()
  // private readonly verificationWaitMap = new Map<
  //   string,
  //   {
  //     resolve: (value: unknown) => unknown;
  //     reject: (error: Error) => unknown;
  //     promise: Promise<unknown>;
  //   }
  // >();

  getQueues(): ReadonlySet<PQueue> {
    return this.inMemoryQueues.allQueues
  }

  public async add(
    data: Readonly<ConversationQueueJobData>,
    insert?: (job: ParsedJob<ConversationQueueJobData>) => Promise<void>
  ): Promise<Job<ConversationQueueJobData>> {
    // const { conversationId, type } = data;
    // strictAssert(
    //   window.Signal.challengeHandler,
    //   'conversationJobQueue.add: Missing challengeHandler!'
    // );
    // window.Signal.challengeHandler.maybeSolve({
    //   conversationId,
    //   reason: `conversationJobQueue.add(${conversationId}, ${type})`,
    // });

    return super.add(data, insert)
  }

  protected parseData(data: unknown): ConversationQueueJobData {
    return conversationQueueJobDataSchema.parse(data)
  }

  protected getInMemoryQueue({ data }: Readonly<{ data: ConversationQueueJobData }>): PQueue {
    return this.inMemoryQueues.get(data.conversationId)
  }

  // private startVerificationWaiter(conversationId: string): Promise<unknown> {}

  // public resolveVerificationWaiter(conversationId: string): void {}

  protected async run(
    { data, timestamp }: Readonly<{ data: ConversationQueueJobData; timestamp: number }>,
    { attempt, log }: Readonly<{ attempt: number; log: LoggerType }>
  ): Promise<void> {
    const { type, conversationId } = data
    const isFinalAttempt = attempt >= MAX_ATTEMPTS

    await window.Ready.conversationController.load('ConversationJobQueue.run')

    const conversation = window.Ready.conversationController.get(conversationId)
    if (!conversation) {
      throw new Error(`Failed to find conversation ${conversationId}`)
    }

    const sender = conversation.attributes.accountId

    let timeRemaining: number
    let shouldContinue: boolean
    let count = 0

    while (true) {
      count += 1
      log.info('calculating timeRemaining and shouldContinue...')
      timeRemaining = timestamp + MAX_RETRY_TIME - Date.now()

      shouldContinue = await commonShouldJobContinue({
        attempt,
        log,
        timeRemaining,
        skipWait: count > 1,
      })
      if (true) {
        // !shouldContinue) {
        break
      }

      // if (window.Signal.challengeHandler?.isRegistered(conversationId)) {
      //   if (this.isShuttingDown) {
      //     throw new Error("Shutting down, can't wait for captcha challenge.");
      //   }
      //   log.info(
      //     'captcha challenge is pending for this conversation; waiting at most 5m...'
      //   );
      //   // eslint-disable-next-line no-await-in-loop
      //   await Promise.race([
      //     this.startVerificationWaiter(conversation.id),
      //     // don't resolve on shutdown, otherwise we end up in an infinite loop
      //     sleeper.sleep(
      //       5 * MINUTE,
      //       `conversationJobQueue: waiting for captcha: ${conversation.idForLogging()}`,
      //       { resolveOnShutdown: false }
      //     ),
      //   ]);
      //   continue;
      // }

      // const verificationData =
      //   window.reduxStore.getState().conversations
      //     .verificationDataByConversation[conversationId];

      // if (!verificationData) {
      //   break;
      // }

      // if (
      //   verificationData.type ===
      //   ConversationVerificationState.PendingVerification
      // ) {
      //   if (type === conversationQueueJobEnum.enum.ProfileKey) {
      //     log.warn(
      //       "Cancelling profile share, we don't want to wait for pending verification."
      //     );
      //     return;
      //   }

      //   if (this.isShuttingDown) {
      //     throw new Error("Shutting down, can't wait for verification.");
      //   }

      //   log.info(
      //     'verification is pending for this conversation; waiting at most 5m...'
      //   );
      //   // eslint-disable-next-line no-await-in-loop
      //   await Promise.race([
      //     this.startVerificationWaiter(conversation.id),
      //     // don't resolve on shutdown, otherwise we end up in an infinite loop
      //     sleeper.sleep(
      //       5 * MINUTE,
      //       `conversationJobQueue: verification pending: ${conversation.idForLogging()}`,
      //       { resolveOnShutdown: false }
      //     ),
      //   ]);
      //   continue;
      // }

      // if (
      //   verificationData.type ===
      //   ConversationVerificationState.VerificationCancelled
      // ) {
      //   if (verificationData.canceledAt >= timestamp) {
      //     log.info(
      //       'cancelling job; user cancelled out of verification dialog.'
      //     );
      //     shouldContinue = false;
      //   } else {
      //     log.info(
      //       'clearing cancellation tombstone; continuing ahead with job'
      //     );
      //     window.reduxActions.conversations.clearCancelledConversationVerification(
      //       conversation.id
      //     );
      //   }
      //   break;
      // }

      //   throw missingCaseError(verificationData);
    }

    const { messageSender } = window.Ready
    if (!messageSender) {
      throw new Error('messaging interface is not available!')
    }

    const jobBundle: ConversationQueueJobBundle = {
      messaging: messageSender,
      isFinalAttempt,
      shouldContinue,
      timeRemaining,
      timestamp,
      log,
    }
    // Note: A six-letter variable makes below code autoformatting easier to read.
    const jobSet = conversationQueueJobEnum.enum

    try {
      switch (type) {
        case jobSet.NormalMessage:
          await sendNormalMessage(conversation, jobBundle, data)
          break
        case jobSet.Reaction:
          await sendReaction(conversation, jobBundle, data)
          break
        case jobSet.Receipts:
          await sendReceipts(conversation, jobBundle, data)
          break
        case jobSet.DeleteForEveryone:
          await sendDeleteForEveryone(conversation, jobBundle, data)
          break
        case jobSet.DeleteForOnlyMe:
          await sendDeleteForOnlyMe(conversation, jobBundle, data)
          break
        // case jobSet.DeleteStoryForEveryone:
        //   await sendDeleteStoryForEveryone(conversation, jobBundle, data)
        //   break
        // case jobSet.DirectExpirationTimerUpdate:
        //   await sendDirectExpirationTimerUpdate(conversation, jobBundle, data)
        //   break
        case jobSet.GroupUpdate:
          await sendGroupUpdate(conversation, jobBundle, data)
          break
        // case jobSet.NullMessage:
        //   await sendNullMessage(conversation, jobBundle, data);
        //   break;
        // case jobSet.ProfileKey:
        //   await sendProfileKey(conversation, jobBundle, data)
        //   break
        // case jobSet.ResendRequest:
        //   await sendResendRequest(conversation, jobBundle, data)
        //   break
        // case jobSet.SavedProto:
        //   await sendSavedProto(conversation, jobBundle, data)
        //   break
        // case jobSet.SenderKeyDistribution:
        //   await sendSenderKeyDistribution(conversation, jobBundle, data)
        //   break
        // case jobSet.Story:
        //   await sendStory(conversation, jobBundle, data);
        //   break;
        case jobSet.TokenRequestResponse:
          await sendTokenRequestResponse(conversation, jobBundle, data)
          break
        default: {
          // Note: This should never happen, because the zod call in parseData wouldn't
          //   accept data that doesn't look like our type specification.
          log.error(`conversationJobQueue: Got job with type ${type}; Cancelling job.`)
        }
      }
    } catch (error: unknown) {
      const untrustedUuids: Array<UUIDStringType> = []

      const processError = async (toProcess: unknown) => {
        if (toProcess instanceof OutgoingIdentityKeyError) {
          const failedConversation = await window.Ready.conversationController.getOrCreate(
            'conversationJobQueue.run.processError',
            sender,
            toProcess.identifier as UUIDStringType,
            ConversationType.PRIVATE,
            undefined
          )
          strictAssert(failedConversation, 'Conversation should be created')
          const uuid = failedConversation.attributes.identifier as UUIDStringType
          if (!uuid) {
            log.error(
              `failedConversation: Conversation ${failedConversation.id}|${failedConversation.attributes.identifier} missing UUID!`
            )
            return
          }
          untrustedUuids.push(uuid)
        }
      }

      await processError(error)
      if (error instanceof SendMessageProtoError) {
        Promise.all((error.errors || []).map(processError))
      }

      if (untrustedUuids.length) {
        // if (type === jobSet.ProfileKey) {
        //   log.warn(
        //     `Cancelling profile share, since there were ${untrustedUuids.length} untrusted send targets.`
        //   )
        //   return
        // }

        if (type === jobSet.Receipts) {
          log.warn(`Cancelling receipt send, since there were ${untrustedUuids.length} untrusted send targets.`)
          return
        }

        log.error(
          `Send failed because ${untrustedUuids.length} conversation(s) were untrusted. Adding to verification list.`
        )

        // window.reduxActions.conversations.conversationStoppedByMissingVerification(
        //   {
        //     conversationId: conversation.id,
        //     untrustedUuids,
        //   }
        // );
      }

      throw error
    } finally {
      log.info(`FINISHED`)
    }
  }
}

export const conversationJobQueue = new ConversationJobQueue({
  store: jobQueueDatabaseStore,
  queueType: 'conversation',
  maxAttempts: MAX_ATTEMPTS,
})
