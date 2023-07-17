// Copyright 2023 Ready.io

import { compact } from 'lodash'
import { type ConversationDBType } from 'types/chat'
import { isDirectConversation } from './whatTypeOfConversation'

export function getConversationMembers(
  conversationAttrs: ConversationDBType,
  options: { includePendingMembers?: boolean } = {}
): Array<ConversationDBType> {
  if (isDirectConversation(conversationAttrs)) {
    return [conversationAttrs]
  }

  if (conversationAttrs.members) {
    return compact(
      conversationAttrs.members.map((id) => {
        const conversation = window.Ready.conversationController.get(id)

        // In groups we won't sent to blocked contacts or those we think are unregistered
        // if (conversation && (conversation.isUnregistered() || conversation.isBlocked())) {
        //   return null
        // }

        return conversation?.attributes
      })
    )
  }

  return []
}
