// Copyright 2023 Ready.io

import type { ConversationDBType, MessageDBType } from 'types/chat'
import * as TypesUtil from './whatTypeOfConversation'

export function getMessageIdForLogging({
  source,
  sourceDevice,
  type,
  sendAt,
}: Pick<MessageDBType, 'type' | 'source' | 'sourceDevice' | 'sendAt'>): string {
  return `${source}.${sourceDevice} ${type} ${sendAt}`
}

export function getConversationIdForLogging(conversation: ConversationDBType): string {
  if (TypesUtil.isDirectConversation(conversation)) {
    const { id, identifier } = conversation
    return `${identifier} (${id})`
  }
  if (TypesUtil.isGroup(conversation)) {
    return `group(${conversation.identifier})`
  }
  if (TypesUtil.isMe(conversation)) {
    return `me(${conversation.identifier})`
  }
  throw new Error(`unknown conversation type: ${conversation.identifier} | ${conversation.type}`)
}
