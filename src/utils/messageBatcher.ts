// Copyright 2023 Ready.io

import { type MessageDBType } from 'types/chat'
import { logger as log } from 'utils/logger'
import { createWaitBatcher } from './waitBatcher'

// const updateMessageBatcher = createBatcher<MessageDBType>({
//   name: 'messageBatcher.updateMessageBatcher',
//   wait: 75,
//   maxSize: 50,
//   processBatch: async (messageAttrs: Array<MessageDBType>) => {
//     log.info('updateMessageBatcher', messageAttrs.length)
//     await window.Signal.Data.batchCreateOrUpdateMessagesByIdentifier(
//       window.userStore.selectedAccount.id,
//       messageAttrs[0].conversationId,
//       messageAttrs
//     )
//   },
// })

// let shouldBatch = true

// export function queueUpdateMessage(messageAttr: MessageDBType): void {
//   if (shouldBatch) {
//     updateMessageBatcher.add(messageAttr)
//   } else {
//     window.Signal.Data.updateMessage(messageAttr.id, messageAttr)
//   }
// }

// export function setBatchingStrategy(keepBatching = false): void {
//   shouldBatch = keepBatching
// }

export const saveNewMessageBatcher = createWaitBatcher<MessageDBType, string>({
  name: 'messageBatcher.saveNewMessageBatcher',
  wait: 75,
  maxSize: 30,
  processBatch: async (messageAttrs: Array<MessageDBType>) => {
    log.info('--  saveNewMessageBatcher', messageAttrs.length)
    return window.Ready.Data.saveMessages(messageAttrs)
  },
})
