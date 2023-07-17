// Copyright 2023 Ready.io

import type { ConversationModel } from 'models/conversations'
import type { LoggerType } from 'utils/logger'
// import { getRecipients } from 'util/getRecipients'
// import { isConversationAccepted } from 'util/isConversationAccepted'
// import { getUntrustedConversationUuids } from './getUntrustedConversationUuids'

export function shouldSendToConversation(conversation: ConversationModel, log: LoggerType): boolean {
  // const recipients = getRecipients(conversation.attributes)
  // const untrustedUuids = getUntrustedConversationUuids(recipients)

  // if (untrustedUuids.length) {
  //   log.info(
  //     `conversation ${conversation.idForLogging()} has untrusted recipients; refusing to send`
  //   )
  //   return false
  // }

  // if (!isConversationAccepted(conversation.attributes)) {
  //   log.info(`conversation ${conversation.idForLogging()} is not accepted; refusing to send`)
  //   return false
  // }

  // if (conversation.isBlocked()) {
  //   log.info(`conversation ${conversation.idForLogging()} is blocked; refusing to send`)
  //   return false
  // }

  return true
}
