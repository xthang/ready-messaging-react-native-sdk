// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */

import { type MessageDBType } from 'types/chat'
import { logger as log } from 'utils/logger'
import type { MessageModel } from '../models/messages'
import * as Errors from '../types/errors'

export async function getMessageById(messageId: string): Promise<MessageModel | undefined> {
  const message = window.Ready.messageController.getById(messageId)
  if (message) {
    return message
  }

  let found: MessageDBType | undefined
  try {
    found = await window.Ready.Data.getMessageById(messageId)
  } catch (err: unknown) {
    log.error(`failed to load message with id ${messageId} due to error ${Errors.toLogFormat(err)}`)
  }

  if (!found) {
    return undefined
  }

  return window.Ready.messageController.register(found.id, found)
}

export async function getMessageByGuid(
  conversationId: string,
  guid: string,
  source: string
): Promise<MessageModel | undefined> {
  const message = window.Ready.messageController.getByGuid(guid)
  if (message) {
    return message
  }

  let found: MessageDBType | undefined | null
  try {
    found = await window.Ready.Data.getMessageByGuid(conversationId, guid, source)
  } catch (err: unknown) {
    log.error(`failed to load message with guid ${guid} due to error ${Errors.toLogFormat(err)}`)
  }

  if (!found) {
    return undefined
  }

  return window.Ready.messageController.register(found.id, found)
}
