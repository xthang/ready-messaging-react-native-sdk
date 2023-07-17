// Copyright 2023 Ready.io

import type { ConversationModel } from '../../models/conversations'
import type { GroupUpdateJobData, ConversationQueueJobBundle } from '../conversationJobQueue'

// Note: because we don't have a recipient map, if some sends fail, we will resend this
//   message to folks that got it on the first go-round. This is okay, because receivers
//   will drop this as an empty message if they already know about its revision.
export async function sendGroupUpdate(
  conversation: ConversationModel,
  { isFinalAttempt, shouldContinue, timeRemaining, timestamp, log }: ConversationQueueJobBundle,
  data: GroupUpdateJobData
): Promise<void> {
  const logId = `sendGroupUpdate/${conversation.idForLogging()}`

  if (!shouldContinue) {
    log.info(`${logId}: Ran out of time. Giving up on sending group update`)
    return
  }

  throw new Error('...')
  // if (!isGroupV2(conversation.attributes)) {
  //   log.error(
  //     `${logId}: Conversation is not GroupV2, cannot send group update!`
  //   );
  //   return;
  // }

  // log.info(`${logId}: starting with timestamp ${timestamp}`);

  // const { groupChangeBase64, recipients: jobRecipients, revision } = data;

  // const recipients = jobRecipients.filter(id => {
  //   const recipient = window.ConversationController.get(id);
  //   if (!recipient) {
  //     return false;
  //   }
  //   if (recipient.isUnregistered()) {
  //     log.warn(
  //       `${logId}: dropping unregistered recipient ${recipient.idForLogging()}`
  //     );
  //     return false;
  //   }
  //   if (recipient.isBlocked()) {
  //     log.warn(
  //       `${logId}: dropping blocked recipient ${recipient.idForLogging()}`
  //     );
  //     return false;
  //   }

  //   return true;
  // });

  // const untrustedUuids = getUntrustedConversationUuids(recipients);
  // if (untrustedUuids.length) {
  //   window.reduxActions.conversations.conversationStoppedByMissingVerification({
  //     conversationId: conversation.id,
  //     untrustedUuids,
  //   });
  //   throw new Error(
  //     `Group update blocked because ${untrustedUuids.length} conversation(s) were untrusted. Failing this attempt.`
  //   );
  // }

  // const sendOptions = await getSendOptionsForRecipients(recipients);

  // const { ContentHint } = Proto.UnidentifiedSenderMessage.Message;
  // const contentHint = ContentHint.RESENDABLE;
  // const sendType = 'groupChange';

  // const groupChange = groupChangeBase64
  //   ? Bytes.fromBase64(groupChangeBase64)
  //   : undefined;

  // let profileKey: Uint8Array | undefined;
  // if (conversation.get('profileSharing')) {
  //   profileKey = await ourProfileKeyService.get();
  // }

  // const groupV2Info = conversation.getGroupV2Info();
  // strictAssert(groupV2Info, 'groupV2Info missing');
  // const groupV2: GroupV2InfoType = {
  //   ...groupV2Info,
  //   revision,
  //   members: recipients,
  //   groupChange,
  // };

  // try {
  //   await conversation.queueJob(
  //     'conversationQueue/sendGroupUpdate',
  //     async abortSignal =>
  //       wrapWithSyncMessageSend({
  //         conversation,
  //         logId,
  //         messageIds: [],
  //         send: async () =>
  //           sendToGroup({
  //             abortSignal,
  //             groupSendOptions: {
  //               groupV2,
  //               timestamp,
  //               profileKey,
  //             },
  //             contentHint,
  //             messageId: undefined,
  //             sendOptions,
  //             sendTarget: conversation.toSenderKeyTarget(),
  //             sendType,
  //             urgent: false,
  //           }),
  //         sendType,
  //         timestamp,
  //       })
  //   );
  // } catch (error: unknown) {
  //   await handleMultipleSendErrors({
  //     errors: maybeExpandErrors(error),
  //     isFinalAttempt,
  //     log,
  //     timeRemaining,
  //     toThrow: error,
  //   });
  // }
}
