// Copyright 2023 Ready.io

import { handleMessageSend } from 'utils/handleMessageSend'
import type { ConversationModel } from '../../models/conversations'
import { ConversationQueueJobBundle, ReceiptsJobData, ReceiptType } from '../conversationJobQueue'
import { shouldSendToConversation } from './shouldSendToConversation'

// const CHUNK_SIZE = 100

export async function sendReceipts(
  conversation: ConversationModel,
  { log }: ConversationQueueJobBundle,
  data: ReceiptsJobData
): Promise<void> {
  if (!shouldSendToConversation(conversation, log)) {
    return
  }

  const { receiptType: type, timestamp } = data

  // let requiresUserSetting: boolean
  let methodName: 'sendDeliveryReceipt' | 'sendReadReceipt' | 'sendViewedReceipt'
  switch (type) {
    case ReceiptType.Delivery:
      // requiresUserSetting = false
      methodName = 'sendDeliveryReceipt'
      break
    case ReceiptType.Read:
      // requiresUserSetting = true
      methodName = 'sendReadReceipt'
      break
    case ReceiptType.Viewed:
      // requiresUserSetting = true
      methodName = 'sendViewedReceipt'
      break
    default:
      throw new Error(`unknown receipts type: ${type}`)
  }

  const { messageSender: messaging } = window.Ready
  if (!messaging) {
    throw new Error('messaging is not available!')
  }

  // if (requiresUserSetting && !window.storage.get('read-receipt-setting')) {
  //   log.info('requires user setting. Not sending these receipts')
  //   return
  // }

  log.info(`--  Starting receipt send of type ${type}`)

  await handleMessageSend(
    messaging[methodName]({
      ourAccountId: conversation.get('accountId')!,
      senderId: conversation.get('identifier')!,
      // isDirectConversation,
      timestamp,
      // options: sendOptions,
    }),
    { messageIds: [], sendType: type }
  )
}
