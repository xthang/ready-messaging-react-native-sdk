// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */

import { type MessageDBType } from 'types/chat'
import { logger as log } from 'utils/logger'
import { MessageModel } from './models/messages'
import * as durations from './utils/durations'

const FIVE_MINUTES = 5 * durations.MINUTE

type LookupType = Record<string, { timestamp: number; message: MessageModel }>

export class MessageController {
  readonly messageLookup: LookupType = Object.create(null)

  private msgIDsBySender = new Map<string, string>()

  private msgIDsBySentAt = new Map<number, Set<string>>()

  private cleanupInterval: NodeJS.Timer | undefined

  register(id: string, data: MessageModel | MessageDBType): MessageModel {
    if (!id || !data) {
      throw new Error('MessageController.register: Got falsey id or message')
    }

    const guid = 'attributes' in data && 'get' in data ? data.get('guid') : data.guid

    const existing = this.messageLookup[id]
    if (existing) {
      this.messageLookup[id] = {
        message: existing.message,
        timestamp: Date.now(),
      }
      if (guid)
        this.messageLookup[guid] = {
          message: existing.message,
          timestamp: Date.now(),
        }
      return existing.message
    }

    const message = 'attributes' in data ? data : new window.Ready.types.Message(data, false)
    this.messageLookup[id] = {
      message,
      timestamp: Date.now(),
    }
    if (guid)
      this.messageLookup[guid] = {
        message,
        timestamp: Date.now(),
      }

    const sentAt = message.get('sendAt')
    const previousIdsBySentAt = this.msgIDsBySentAt.get(sentAt)
    if (previousIdsBySentAt) {
      previousIdsBySentAt.add(id)
    } else {
      this.msgIDsBySentAt.set(sentAt, new Set([id]))
    }

    this.msgIDsBySender.set(message.getSenderIdentifier(), id)

    return message
  }

  registerGuid(guid: string, data: MessageModel): MessageModel {
    this.messageLookup[guid] = {
      message: data,
      timestamp: Date.now(),
    }
    return data
  }

  unregister(id: string): void {
    const { message } = this.messageLookup[id] || {}
    if (message) {
      this.msgIDsBySender.delete(message.getSenderIdentifier())

      const sentAt = message.get('sendAt')!
      const idsBySentAt = this.msgIDsBySentAt.get(sentAt) || new Set()
      idsBySentAt.delete(id)
      if (!idsBySentAt.size) {
        this.msgIDsBySentAt.delete(sentAt)
      }
      delete this.messageLookup[message.get('guid')!]
    }
    delete this.messageLookup[id]
  }

  cleanup(): void {
    const messages = Object.values(this.messageLookup)
    const now = Date.now()

    for (let i = 0, max = messages.length; i < max; i += 1) {
      const { message, timestamp } = messages[i]!
      const conversation = message.getConversation()

      const selectedConversationId = window.utils.getCurrentConversationId()
      const inActiveConversation = conversation && selectedConversationId && conversation.id === selectedConversationId

      if (now - timestamp > FIVE_MINUTES && !inActiveConversation) {
        this.unregister(message.id as string)
      }
    }
  }

  getById(id: string): MessageModel | undefined {
    const existing = this.messageLookup[id]
    return existing && existing.message
  }

  getByGuid(guid: string): MessageModel | undefined {
    const existing = this.messageLookup[guid]
    return existing && existing.message
  }

  filterBySentAt(sentAt: number): Iterable<MessageModel> {
    const ids = this.msgIDsBySentAt.get(sentAt) || []
    const maybeMessages = Array.from(ids).map((id) => this.getById(id))
    return maybeMessages.filter((it) => it)
  }

  findBySender(sender: string): MessageModel | undefined {
    const id = this.msgIDsBySender.get(sender)
    if (!id) {
      return undefined
    }
    return this.getById(id)
  }

  update(predicate: (message: MessageModel) => void): void {
    const values = Object.values(this.messageLookup)
    log.info(`MessageController.update: About to process ${values.length} messages`)
    values.forEach(({ message }) => predicate(message))
  }

  startCleanupInterval() {
    if (this.cleanupInterval) throw new Error('cleanup Interval already started')
    this.cleanupInterval = setInterval(this.cleanup.bind(this), true ? FIVE_MINUTES : durations.HOUR)
  }

  stopCleanupInterval() {
    if (!this.cleanupInterval) throw new Error('cleanup Interval not started')
    clearInterval(this.cleanupInterval)
    this.cleanupInterval = undefined
  }
}
