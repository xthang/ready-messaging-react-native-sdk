// Copyright 2023 Ready.io

import { type ConversationDBType, ConversationType, GroupType } from 'types/chat'

export function isDirectConversation({ type }: Pick<ConversationDBType, 'type'>): boolean {
  return type === ConversationType.PRIVATE
}

export function isMe({ accountId: ourAccountId, identifier }: ConversationDBType): boolean {
  return ourAccountId === identifier
}

export function isGroup({ type }: ConversationDBType): boolean {
  return type === ConversationType.GROUP
}

export function isPublicGroup({ type, groupType }: ConversationDBType): boolean {
  return type === ConversationType.GROUP && groupType === GroupType.PUBLIC
}
