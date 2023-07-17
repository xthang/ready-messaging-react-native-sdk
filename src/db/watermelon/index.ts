import { Model, Q } from '@nozbe/watermelondb'
import type {
  CreateAccountParams,
  UpdateAccountParams,
  UpdateConversationParams,
  UpdateMessageParams,
  CreateAttachmentParams,
  UpdateAttachmentParams,
  CreateSignalPreKeyParams,
  CreateSignalSignedPreKeyParams,
  CreateOrUpdateSignalSessionParams,
} from 'db/types'
import type { StoredJob } from 'jobs/types'
import type { AccountDBType } from 'types/Account'
import {
  type ConversationDBType,
  type MessageDBType,
  MessageType,
  ConversationType,
  AttachmentType,
  type AttachmentDBType,
} from 'types/chat'
import type {
  SignedPreKeyType,
  UnprocessedType,
  IdentityKeyType,
  UnprocessedUpdateType,
  SessionType,
  PreKeyType,
} from 'types/db'
import { logger as log } from 'utils/logger'
import { database, queue } from './config'
import {
  extractSecuredKeys,
  mapCreateAccountObj,
  mapCreateAttachmentObj,
  mapCreateConversationObj,
  mapCreateMessageObj,
  mapCreateSignalIdentityKeyObj,
  mapCreateSignalPreKeyObj,
  mapCreateSignalSessionObj,
  mapCreateSignalSignedPreKeyObj,
  mapUnprocessedDataToDB,
  mapUpdateAccountObj,
  mapUpdateAttachmentObj,
  mapUpdateConversationObj,
  mapUpdateMessageObj,
  mapUpdateSignalIdentityKeyObj,
  mapUpdateSignalSessionObj,
  mapUpdateSignalSignedPreKeyObj,
  removeSecuredKeys,
  serializeAccount,
  serializeAttachment,
  serializeConversation,
  serializeMessage,
  serializeSignalIdentityKey,
  serializeSignalPreKey,
  serializeSignalSession,
  serializeSignalSignedPreKey,
  storeSecuredKeys,
} from './helpers'
import {
  // Item,
  Account,
  Conversation,
  SignalPreKey,
  Attachment,
  SignalSignedPreKey,
  SignalSession,
  SignalIdentityKey,
  UnprocessedData,
  Message,
  Job,
} from './model/models'

// const ITEMS_TABLE = 'items'

// const ITEM_SPECS: Partial<Record<ItemKeyType, ObjectMappingSpecType>> = {
//   identityKeyMap: {
//     key: 'value',
//     valueSpec: {
//       isMap: true,
//       valueSpec: ['privKey', 'pubKey'],
//     },
//   },
//   // profileKey: ['value'],
//   // senderCertificate: ['value.serialized'],
//   // senderCertificateNoE164: ['value.serialized'],
//   // subscriberId: ['value'],
// }

// function specToBytes<Input, Output>(spec: ObjectMappingSpecType, data: Input): Output {
//   return mapObjectWithSpec<string, Uint8Array>(spec, data, (x) => Bytes.fromBase64(x))
// }

// function specFromBytes<Input, Output>(spec: ObjectMappingSpecType, data: Input): Output {
//   return mapObjectWithSpec<Uint8Array, string>(spec, data, (x) => Bytes.toBase64(x))
// }

export class WatermelonDB {
  // implements ReadyDB

  constructor() {}

  async reset(): Promise<void> {
    return new Promise(async (resolve) =>
      database.write(async () => {
        await database.unsafeResetDatabase()
        resolve()
      })
    )
  }

  // -------------------- ITEM ------------------------

  // createOrUpdateItem<K extends keyof StorageAccessType>(data: ItemType<K>): Promise<string> {
  //   const { id } = data

  //   const collection = database.get<Item>(ITEMS_TABLE)

  //   return new Promise((resolve) => {
  //     queue.add(async () => {
  //       const item = await collection.find(id)

  //       await database.write(async () => {
  //         const spec = ITEM_SPECS[id]
  //         const toUpdate: StoredItemType<K> = spec
  //           ? specFromBytes(spec, data)
  //           : ((data as unknown) as StoredItemType<K>)

  //         let res: Item
  //         if (!item) {
  //           res = await collection.create((obj) => {
  //             obj.id = data.id
  //             obj.json = JSON.stringify(toUpdate.value)
  //           })
  //         } else {
  //           res = await item.update((obj) => {
  //             obj.json = JSON.stringify(toUpdate.value)
  //           })
  //         }
  //         resolve(res.id)
  //       })
  //     })
  //   })
  // }

  // getItemById<K extends keyof StorageAccessType>(id: K): Promise<ItemType<K>> {
  //   return queue.add(async () => {
  //     const res = await database.get<Item>(ITEMS_TABLE).find(id)
  //     return JSON.parse(res.json)
  //   })
  // }

  // getAllItems(): Promise<Partial<StorageAccessType>> {
  //   return queue.add(async () => {
  //     const res = await database.get<Item>(ITEMS_TABLE).query().fetch()

  //     const result: Partial<StorageAccessType> = Object.create(null)

  //     res.forEach((it) => {
  //       const key = it.id as ItemKeyType
  //       const value = JSON.parse(it.json)
  //       const spec = ITEM_SPECS[key]

  //       const deserializedValue = spec
  //         ? (specToBytes(spec, { value }) as ItemType<typeof key>).value
  //         : value

  //       result[key] = deserializedValue
  //     })

  //     return result
  //   })
  // }

  // -------------------- JOB ------------------------

  getJobsInQueue(queueType: string): Promise<StoredJob[]> {
    return queue.add(async () => {
      const res = await database.get<Job>('jobs').query(Q.where('queue_type', queueType)).fetch()
      return res.map((it) => ({
        id: it.id,
        timestamp: it.timestamp,
        queueType: it.queueType,
        data: JSON.parse(it.data),
      }))
    })
  }

  insertJob(job: Readonly<StoredJob>): Promise<string> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const res = await database.get<Job>('jobs').create((obj) => {
            if (job.id) obj._raw.id = job.id
            obj.queueType = job.queueType
            obj.timestamp = job.timestamp
            obj.data = JSON.stringify(job.data)
          })
          resolve(res.id)
        })
      })
    })
  }

  deleteJob(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      queue.add(async () => {
        await database.write(async () => {
          try {
            await database.get<Job>('jobs').query(Q.where('id', id)).destroyAllPermanently()
            resolve()
          } catch (e) {
            reject(e)
          }
        })
      })
    })
  }

  // -------------------- ACCOUNT ------------------------

  async getAllAccounts(loadSecuredKeys?: boolean): Promise<AccountDBType[]> {
    return queue.add(async () => {
      const res = await database.get<Account>('accounts').query().fetch()
      return Promise.all(res.map((it) => serializeAccount(it, loadSecuredKeys)))
    })
  }

  async getAccount(id: string, loadSecuredKeys?: boolean): Promise<AccountDBType> {
    return queue.add(async () => {
      const res = await database.get<Account>('accounts').find(id)
      return serializeAccount(res, loadSecuredKeys)
    })
  }

  createAccount(payload: CreateAccountParams): Promise<string> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          let securedKeys = {}
          const res = await database.get<Account>('accounts').create((obj: any) => {
            mapCreateAccountObj(obj, payload)
            securedKeys = extractSecuredKeys(obj, 'accounts')
          })
          await storeSecuredKeys(securedKeys, 'accounts', res.id)
          resolve(res.id)
        })
      })
    })
  }

  updateAccount(id: string, payload: UpdateAccountParams): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const res = await database.get<Account>('accounts').find(id)
          let securedKeys = {}
          if (res) {
            await res.update((obj: any) => {
              mapUpdateAccountObj(obj, payload)
              securedKeys = extractSecuredKeys(obj, 'accounts')
            })
          }
          await storeSecuredKeys(securedKeys, 'accounts', id)
          resolve()
        })
      })
    })
  }

  deleteAccount(id: string): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const account = await database.get<Account>('accounts').find(id)
          await account.signalPreKeys.destroyAllPermanently()
          await account.signalSignedPreKeys.destroyAllPermanently()
          await account.contacts.destroyAllPermanently()
          // await account.wallets.destroyAllPermanently()
          const conversations = await account.conversations.fetch()
          for (const conv of conversations) {
            await conv.signalSessions.destroyAllPermanently()
            // await conv.signalIdentityKeys.destroyAllPermanently()
            await conv.signalDevices.destroyAllPermanently()
            await conv.messages.destroyAllPermanently()
            await conv.attachments.destroyAllPermanently()
          }
          await database
            .get<SignalIdentityKey>('signal_identity_keys')
            .query(Q.where('our_id', id))
            .destroyAllPermanently()
          await account.conversations.destroyAllPermanently()
          await account.destroyPermanently()
          await removeSecuredKeys('accounts', id)
          resolve()
        })
      })
    })
  }

  // -------------------- CONVERSATION ------------------------

  async getAllConversations(): Promise<ConversationDBType[]> {
    return queue.add(async () => {
      const res = await database.get<Conversation>('conversations').query().fetch()
      if (res.length) {
        return res.map((m) => serializeConversation(m))
      }
      return []
    })
  }

  async getConversation(id: string): Promise<ConversationDBType> {
    return queue.add(async () => {
      const res = await database.get<Conversation>('conversations').find(id)
      return serializeConversation(res)
    })
  }

  async getConversationByIdentifier(accountId: string, identifier: string): Promise<ConversationDBType | null> {
    return queue.add(async () => {
      const res = await database
        .get<Conversation>('conversations')
        .query(Q.where('account_id', accountId), Q.where('identifier', identifier), Q.take(1))
        .fetch()
      if (res.length) {
        return serializeConversation(res[0]!)
      }
      return null
    })
  }

  createConversation(payload: Omit<ConversationDBType, 'id' | 'createdAt'> & { id?: string }): Promise<string> {
    return new Promise((resolve, reject) => {
      queue.add(async () => {
        await database.write(async () => {
          try {
            const account = await database.get<Account>('accounts').find(payload.accountId)
            const res = await database.get<Conversation>('conversations').create((obj) => {
              mapCreateConversationObj(obj, payload, account)
            })
            resolve(res.id)
          } catch (e) {
            reject(e)
          }
        })
      })
    })
  }

  batchCreateOrUpdateConversations(
    accountId: string,
    payloads: (Omit<ConversationDBType, 'id'> & { id?: string })[]
  ): Promise<string[]> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const account = await database.get<Account>('accounts').find(accountId)
          const ids = []

          for (const p of payloads) {
            const items = await database
              .get<Conversation>('conversations')
              .query(Q.where('account_id', accountId), Q.where('identifier', p.identifier), Q.take(1))
              .fetch()
            if (items.length > 0) {
              await items[0]!.update((obj: any) => {
                mapUpdateConversationObj(obj, p)
              })
              ids.push(items[0]!.id)
            } else {
              const res = await database.get<Conversation>('conversations').create((obj) => {
                mapCreateConversationObj(obj, p, account)
              })
              ids.push(res.id)
            }
          }

          resolve(ids)
        })
      })
    })
  }

  updateConversation(id: string, payload: UpdateConversationParams): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const item = await database.get<Conversation>('conversations').find(id)
          if (item) {
            await item.update((obj) => {
              mapUpdateConversationObj(obj, payload)
            })
          }
          resolve()
        })
      })
    })
  }

  updateCustomUsernameConversationByIndentifier(identifier: string, payload: UpdateConversationParams): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const conversations = await database
            .get<Conversation>('conversations')
            .query(Q.where('identifier', identifier), Q.take(1))
            .fetch()
          if (conversations.length) {
            await conversations[0]!.update((obj: any) => {
              mapUpdateConversationObj(obj, payload)
            })
          }
          resolve()
        })
      })
    })
  }

  updateConversationByIdentifier(
    accountId: string,
    identifier: string,
    payload: UpdateConversationParams
  ): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const conversations = await database
            .get<Conversation>('conversations')
            .query(Q.where('account_id', accountId), Q.where('identifier', identifier), Q.take(1))
            .fetch()
          if (conversations.length) {
            await conversations[0]!.update((obj: any) => {
              mapUpdateConversationObj(obj, payload)
            })
          }
          resolve()
        })
      })
    })
  }

  clearConversations(accountId: string): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const items = await database
            .get<Conversation>('conversations')
            .query(Q.where('account_id', accountId))
            .fetch()
          for (const item of items) {
            await item.signalSessions.destroyAllPermanently()
            // await item.signalIdentityKeys.destroyAllPermanently()
            await item.signalDevices.destroyAllPermanently()
            await item.messages.destroyAllPermanently()
            await item.attachments.destroyAllPermanently()
            await item.destroyPermanently()
          }
          await database
            .get<SignalIdentityKey>('signal_identity_keys')
            .query(Q.where('our_id', accountId))
            .destroyAllPermanently()
          resolve()
        })
      })
    })
  }

  deleteConversation(id: string): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const conv = await database.get<Conversation>('conversations').find(id)
          await conv.signalSessions.destroyAllPermanently()
          // await conv.signalIdentityKeys.destroyAllPermanently()
          await conv.signalDevices.destroyAllPermanently()
          await conv.messages.destroyAllPermanently()
          await conv.attachments.destroyAllPermanently()
          await conv.destroyPermanently()
          await database
            .get<SignalIdentityKey>('signal_identity_keys')
            .query(Q.where('our_id', conv.account.id as string), Q.where('their_id', conv.identifier))
            .destroyAllPermanently()
          resolve()
        })
      })
    })
  }

  clearConversationMessages(id: string): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const conv = (await database.get<Conversation>('conversations').find(id)) as Model & any
          await conv.messages.destroyAllPermanently()
          await conv.attachments.destroyAllPermanently()
          resolve()
        })
      })
    })
  }

  // -------------------- MESSAGE ------------------------

  createMessage(
    payload: Omit<MessageDBType, 'id' | 'createdAt' | 'type'> & { id?: string; createdAt?: number }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      queue.add(async () => {
        try {
          await database.write(async () => {
            const conversation = await database.get<Conversation>('conversations').find(payload.conversationId)
            const res = await database.get('messages').create((obj: any) => {
              mapCreateMessageObj(obj, payload, conversation)
            })
            resolve(res.id)
          })
        } catch (e) {
          reject(e)
        }
      })
    })
  }

  updateMessage(id: string, payload: UpdateMessageParams): Promise<string> {
    return new Promise((resolve, reject) => {
      queue.add(async () => {
        await database.write(async () => {
          try {
            const item = await database.get<Message>('messages').find(id)
            if (item) {
              await item.update((obj) => mapUpdateMessageObj(obj, payload))
            }
            resolve(item.id)
          } catch (e) {
            reject(e)
          }
        })
      })
    })
  }

  updateMessageByGuid(
    conversationId: string,
    guid: string,
    source: string,
    payload: UpdateMessageParams
  ): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const items = await database
            .get('messages')
            .query(Q.where('conversation_id', conversationId), Q.where('guid', guid), Q.where('source', source))
            .fetch()

          for (const item of items) {
            await item.update((obj: any) => {
              mapUpdateMessageObj(obj, payload)
            })
          }
          resolve()
        })
      })
    })
  }

  saveMessages(payloads: MessageDBType[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      queue.add(async () => {
        await database.write(async () => {
          try {
            const ids = []
            for (const p of payloads) {
              const res = await database.get<Message>('messages').create((obj) => {
                mapCreateMessageObj(obj, p)
              })
              if (p.attachments) {
                for (const at of p.attachments) {
                  await database.get<Attachment>('attachments').create((obj) => {
                    mapCreateAttachmentObj(obj, at, res)
                  })
                }
              }
              ids.push(res.id)
            }

            resolve(ids)
          } catch (e) {
            reject(e)
          }
        })
      })
    })
  }

  async getLastMessage(conversationId: string): Promise<MessageDBType | null> {
    return queue.add(async () => {
      const res = await database
        .get<Message>('messages')
        .query(
          Q.where('conversation_id', conversationId),
          Q.where('type', Q.notIn([MessageType.DELETED, MessageType.EVENT])),
          Q.sortBy('send_at', Q.desc),
          Q.take(1)
        )
        .fetch()
      if (res.length) {
        const item = res[0]!
        const attachmentsRes = await item.attachments?.fetch()
        return serializeMessage(item, attachmentsRes ?? [])
      }
      return null
    })
  }

  async getMessageById(id: string): Promise<MessageDBType> {
    return queue.add(async () => {
      const res = await database.get<Message>('messages').find(id)
      const attachmentsRes = await res.attachments.fetch()
      return serializeMessage(res, attachmentsRes)
    })
  }

  async getMessageByGuid(conversationId: string, guid: string, source: string): Promise<MessageDBType | null> {
    return queue.add(async () => {
      const res = await database
        .get('messages')
        .query(Q.where('conversation_id', conversationId), Q.where('guid', guid), Q.where('source', source), Q.take(1))
        .fetch()
      if (res.length) {
        const item: Model & any = res[0]
        const attachmentsRes = await item.attachments.fetch()
        return serializeMessage(item, attachmentsRes)
      }
      return null
    })
  }

  async getMessageByUuid(conversationId: string, uuid: string, source: string): Promise<MessageDBType | null> {
    return queue.add(async () => {
      const res = await database
        .get('messages')
        .query(Q.where('conversation_id', conversationId), Q.where('uuid', uuid), Q.where('source', source), Q.take(1))
        .fetch()
      if (res.length) {
        const item: Model & any = res[0]
        const attachmentsRes = await item.attachments.fetch()
        return serializeMessage(item, attachmentsRes)
      }
      return null
    })
  }

  async getMessageBySender({
    conversationId,
    source,
    sentAt,
  }: {
    conversationId: string
    source: string
    sentAt: number
  }): Promise<MessageDBType | null> {
    return queue.add(async () => {
      const rows = await database
        .get<Message>('messages')
        .query(
          Q.where('conversation_id', conversationId),
          Q.where('source', source),
          Q.where('send_at', sentAt),
          Q.take(2)
        )
        .fetch()
      if (rows.length > 1) {
        log.warn('getMessageBySender: More than one message found for', {
          conversationId,
          source,
          sentAt,
        })
      }

      if (rows.length < 1) {
        return null
      }

      const item = rows[0]!
      const attachmentsRes = await item.attachments.fetch()
      return serializeMessage(item, attachmentsRes)
    })
  }

  // countUnreadMessages(conversationId: string, selfAddress: string): Promise<number> {
  //   return queue.add(async () => {
  //     const res = await database
  //       .get<Message>('messages')
  //       .query(
  //         Q.where('conversation_id', conversationId),
  //         Q.where('source', Q.notEq(selfAddress)),
  //         Q.where('source', Q.notEq('')),
  //         Q.where('receive_status', ReceiveStatus.Unread)
  //       )
  //       .fetchCount()
  //     return res
  //   })
  // }

  countUnreadMessagesAfterTime(conversationId: string, selfAddress: string, lastRead: number): Promise<number> {
    return queue.add(async () => {
      const res = await database
        .get('messages')
        .query(
          Q.where('conversation_id', conversationId),
          Q.where('send_at', Q.gt(lastRead ?? 0)),
          Q.where('source', Q.notEq(selfAddress)),
          Q.where('source', Q.notEq(''))
        )
        .fetchCount()
      return res
    })
  }

  clearMessages(): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const items = await database.get('messages').query().fetch()
          let item: Model & any
          for (item of items) {
            await item.attachments.destroyAllPermanently()
            await item.destroyPermanently()
          }
          resolve()
        })
      })
    })
  }

  deleteMessage(id: string): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const item = (await database.get('messages').find(id)) as Model & any
          await item.attachments.destroyAllPermanently()
          await item.destroyPermanently()
          resolve()
        })
      })
    })
  }

  getAllMessages(accountId: string): Promise<{ [identifier: string]: MessageDBType[] }> {
    return queue.add(async () => {
      const res: { [identifier: string]: MessageDBType[] } = {}
      const account = (await database.get<Account>('accounts').find(accountId)) as Model & any
      const conversations = await account.conversations.fetch()
      for (const conv of conversations) {
        if (conv.type === ConversationType.PRIVATE) {
          res[conv.identifier] = []
          const messages = await conv.messages.fetch()
          for (const msg of messages) {
            const attachments = await msg.attachments.fetch()
            res[conv.identifier]!.push(serializeMessage(msg, attachments))
          }
        }
      }
      return res
    })
  }

  // batchCreateMessagesByConversationId(
  //   conversationId: string,
  //   payloads: MessageDBType[]
  // ): Promise<string[] | null> {
  //   return new Promise((resolve, reject) => {
  //     queue.add(async () => {
  //       await database.write(async () => {
  //         try {
  //           const conversation = await database
  //             .get<Conversation>('conversations')
  //             .find(conversationId)
  //           if (!conversation) {
  //             reject(new Error(`conversation not found: ${conversationId}`))
  //             return
  //           }
  //           const ids = []
  //           for (const p of payloads) {
  //             const res = await database.get('messages').create((obj: any) => {
  //               mapCreateMessageObj(obj, p, conversation)
  //             })
  //             if (p.attachments) {
  //               for (const at of p.attachments) {
  //                 await database.get<Attachment>('attachments').create((obj: any) => {
  //                   mapCreateAttachmentObj(obj, at, res, conversation)
  //                 })
  //               }
  //             }
  //             ids.push(res.id)
  //           }

  //           resolve(ids)
  //         } catch (e) {
  //           reject(e)
  //         }
  //       })
  //     })
  //   })
  // }

  batchCreateOrUpdateMessagesByIdentifier(
    accountId: string,
    conversationIdentifier: string,
    payloads: MessageDBType[]
  ): Promise<string[]> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          // Get conversation by identifier
          const conversations = await database
            .get<Conversation>('conversations')
            .query(Q.where('account_id', accountId), Q.where('identifier', conversationIdentifier), Q.take(1))
            .fetch()
          if (conversations.length === 0) {
            return
          }
          const conversation = conversations[0]!

          // Loop through each messages
          const ids = []
          for (const p of payloads) {
            // Find existing messages
            const messages = await database
              .get('messages')
              .query(Q.where('conversation_id', conversation.id), Q.where('guid', p.guid!), Q.where('source', p.source))
              .fetch()

            // Update existing messages or create new
            if (messages.length) {
              for (const existingMessage of messages) {
                await existingMessage.update((obj: any) => {
                  mapUpdateMessageObj(obj, p)
                })
              }
              ids.push(messages[0]!.id)
            } else {
              // Create new messages
              const res = await database.get<Message>('messages').create((obj: any) => {
                mapCreateMessageObj(obj, p, conversation)
              })
              if (p.attachments) {
                for (const at of p.attachments) {
                  await database.get('attachments').create((obj: any) => {
                    mapCreateAttachmentObj(
                      obj,
                      {
                        ...at,
                        localUrl: '', // File has not been downloaded yet
                      },
                      res,
                      conversation
                    )
                  })
                }
              }
              ids.push(res.id)
            }
          }

          resolve(ids)
        })
      })
    })
  }

  // -------------------- ATTACHMENT ------------------------

  createAttachment(
    payload: CreateAttachmentParams & {
      messageId: string
      conversationId: string
    }
  ): Promise<string> {
    const { messageId, conversationId } = payload
    return new Promise((resolve, reject) => {
      queue.add(async () => {
        await database.write(async () => {
          try {
            const conversation = await database.get<Conversation>('conversations').find(conversationId)
            const message = await database.get<Message>('messages').find(messageId)
            const res = await database.get<Attachment>('attachments').create((obj: any) => {
              mapCreateAttachmentObj(obj, payload, message, conversation)
            })
            resolve(res.id)
          } catch (e) {
            reject(e)
          }
        })
      })
    })
  }

  updateAttachment(id: string, payload: UpdateAttachmentParams): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const item = await database.get<Attachment>('attachments').find(id)
          if (item) {
            await item.update((obj: any) => {
              mapUpdateAttachmentObj(obj, payload)
            })
          }
          resolve()
        })
      })
    })
  }

  loadAttachments(
    conversationId: string,
    payload: {
      type?: AttachmentType
      isNotDownloaded?: boolean
    }
  ): Promise<AttachmentDBType[]> {
    const { type, isNotDownloaded } = payload
    return queue.add(async () => {
      let res: Attachment[] = []
      const attachmentDb = database.get<Attachment>('attachments')

      if (isNotDownloaded) {
        // Load all not downloaded file
        res = await attachmentDb
          .query(
            Q.where('conversation_id', conversationId),
            Q.where('local_url', ''),
            Q.where('decryption_key', Q.notEq('')),
            Q.sortBy('created_at', Q.desc)
          )
          .fetch()
      } else if (type) {
        // Load by type
        res = await attachmentDb
          .query(Q.where('conversation_id', conversationId), Q.where('type', type), Q.sortBy('created_at', Q.desc))
          .fetch()
      } else {
        // Load all
        res = await attachmentDb
          .query(Q.where('conversation_id', conversationId), Q.sortBy('created_at', Q.desc))
          .fetch()
      }
      return res.map((m) => serializeAttachment(m))
    })
  }

  deleteAttachment(id: string): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const item = await database.get<Attachment>('attachments').find(id)
          await item.destroyPermanently()
          resolve()
        })
      })
    })
  }

  deleteAttachmentByCloudUrl(convsersationId: string, cloudUrl: string): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          await database
            .get<Attachment>('attachments')
            .query(Q.where('conversation_id', convsersationId), Q.where('cloud_url', cloudUrl))
            .destroyAllPermanently()
          resolve()
        })
      })
    })
  }

  // -------------------- SIGNAL PRE KEY ------------------------

  createSignalPreKey(payload: CreateSignalPreKeyParams): Promise<string> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const account = await database.get<Account>('accounts').find(payload.accountId)
          const res = await database.get<SignalPreKey>('signal_pre_keys').create((obj: any) => {
            mapCreateSignalPreKeyObj(obj, payload, account)
          })
          resolve(res.id)
        })
      })
    })
  }

  deleteSignalPreKey(accountId: string, keyId: number): Promise<void> {
    return new Promise(async (resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          await database
            .get<SignalPreKey>('signal_pre_keys')
            .query(Q.where('account_id', accountId), Q.where('key_id', keyId))
            .destroyAllPermanently()
          resolve()
        })
      })
    })
  }

  removeAllSignalPreKeys!: () => Promise<void>

  getAllSignalPreKeys(): Promise<PreKeyType[]> {
    return queue.add(async () => {
      const res = await database.get<SignalPreKey>('signal_pre_keys').query().fetch()
      return res.map(serializeSignalPreKey)
    })
  }

  async getSignalPreKey(accountId: string, keyId: number): Promise<PreKeyType | null> {
    return queue.add(async () => {
      const res = await database
        .get<SignalPreKey>('signal_pre_keys')
        .query(Q.where('account_id', accountId), Q.where('key_id', keyId), Q.take(1))
        .fetch()
      if (res.length) {
        return serializeSignalPreKey(res[0]!)
      }
      return null
    })
  }

  getMaxSignalPreKeyId(accountId: string): Promise<number | null> {
    return queue.add(async () => {
      const res = await database
        .get<SignalPreKey>('signal_pre_keys')
        .query(Q.where('account_id', accountId), Q.sortBy('key_id', Q.desc), Q.take(1))
        .fetch()
      if (res.length) {
        return serializeSignalPreKey(res[0]!).keyId
      }
      return null
    })
  }

  // -------------------- SIGNAL SIGNED PRE KEY ------------------------

  createSignalSignedPreKey(
    payload: CreateSignalSignedPreKeyParams & {
      accountId: string
    }
  ): Promise<string> {
    const { accountId } = payload
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const account = await database.get<Account>('accounts').find(accountId)
          const res = await database.get<SignalSignedPreKey>('signal_signed_pre_keys').create((obj: any) => {
            mapCreateSignalSignedPreKeyObj(obj, payload, account)
          })
          resolve(res.id)
        })
      })
    })
  }

  updateSignalSignedPreKey(accountId: string, keyId: number, confirmed?: boolean): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const signedPreKeys = await database
            .get<SignalSignedPreKey>('signal_signed_pre_keys')
            .query(Q.where('account_id', accountId), Q.where('key_id', keyId))
            .fetch()
          for (const key of signedPreKeys) {
            await key.update((obj: any) => {
              mapUpdateSignalSignedPreKeyObj(obj, { confirmed })
            })
          }
          resolve()
        })
      })
    })
  }

  removeAllSignalSignedPreKeys!: () => Promise<void>

  deleteSignalSignedPreKey(accountId: string, keyId: number): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          const signedPreKeys = await database
            .get<SignalSignedPreKey>('signal_signed_pre_keys')
            .query(Q.where('account_id', accountId), Q.where('key_id', keyId))
            .fetch()
          for (const key of signedPreKeys) {
            await key.destroyPermanently()
          }
          resolve()
        })
      })
    })
  }

  loadAllSignalSignedPreKeys(): Promise<SignedPreKeyType[]> {
    return queue.add(async () => {
      const res = await database.get<SignalSignedPreKey>('signal_signed_pre_keys').query().fetch()
      return res.map(serializeSignalSignedPreKey)
    })
  }

  loadSignalSignedPreKeys(accountId: string): Promise<SignedPreKeyType[]> {
    return queue.add(async () => {
      const res = await database
        .get<SignalSignedPreKey>('signal_signed_pre_keys')
        .query(Q.where('account_id', accountId))
        .fetch()
      return res.map((m) => serializeSignalSignedPreKey(m))
    })
  }

  async getSignalSignedPreKey(accountId: string, keyId: number): Promise<SignedPreKeyType | null> {
    return queue.add(async () => {
      const res = await database
        .get<SignalSignedPreKey>('signal_signed_pre_keys')
        .query(Q.where('account_id', accountId), Q.where('key_id', keyId), Q.take(1))
        .fetch()
      if (res.length) {
        return serializeSignalSignedPreKey(res[0]!)
      }
      return null
    })
  }

  getMaxSignalSignedPreKeyId(accountId: string): Promise<number | null> {
    return queue.add(async () => {
      const res = await database
        .get<SignalSignedPreKey>('signal_signed_pre_keys')
        .query(Q.where('account_id', accountId), Q.sortBy('key_id', Q.desc), Q.take(1))
        .fetch()
      if (res.length) {
        return serializeSignalSignedPreKey(res[0]!).keyId
      }
      return null
    })
  }

  // -------------------- SIGNAL SESSION ------------------------

  createOrUpdateSignalSession(
    payload: CreateOrUpdateSignalSessionParams & {
      conversationId: string
    }
  ): Promise<string> {
    const { conversationId, sessionId } = payload
    return new Promise((resolve) => {
      queue.add(async () => {
        const sessions = await database
          .get<SignalSession>('signal_sessions')
          .query(Q.where('conversation_id', conversationId), Q.where('session_id', sessionId))
          .fetch()

        await database.write(async () => {
          if (sessions.length > 0) {
            for (const item of sessions) {
              await item.update((obj: any) => {
                mapUpdateSignalSessionObj(obj, payload)
              })
            }

            resolve(sessions[0]!.id)
            return
          }

          const conversation = await database.get<Conversation>('conversations').find(conversationId)
          const res = await database.get<SignalSession>('signal_sessions').create((obj: any) => {
            mapCreateSignalSessionObj(obj, payload, conversation)
          })
          resolve(res.id)
        })
      })
    })
  }

  async getAllSignalSessions(): Promise<SessionType[]> {
    return queue.add(async () => {
      const res = await database.get<SignalSession>('signal_sessions').query().fetch()
      return Promise.all(res.map(serializeSignalSession))
    })
  }

  async getSignalSession(sessionId: string): Promise<SessionType | null> {
    return queue.add(async () => {
      const res = await database
        .get<SignalSession>('signal_sessions')
        .query(Q.where('session_id', sessionId), Q.take(1))
        .fetch()
      if (res.length) {
        return serializeSignalSession(res[0]!)
      }
      return null
    })
  }

  loadSignalSessions(conversationId: string): Promise<SessionType[]> {
    return queue.add(async () => {
      const res = await database
        .get<SignalSession>('signal_sessions')
        .query(Q.where('conversation_id', conversationId))
        .fetch()
      return Promise.all(res.map((m) => serializeSignalSession(m)))
    })
  }

  async clearSignalSessions(conversationId: string): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          await database
            .get<SignalSession>('signal_sessions')
            .query(Q.where('conversation_id', conversationId))
            .destroyAllPermanently()
          resolve()
        })
      })
    })
  }

  removeSignalSessionById!: (id: string) => Promise<void>

  removeSignalSessionByAccountId!: (accountId: string) => Promise<void>

  removeAllSignalSessions!: () => Promise<void>

  async commitDecryptResult({
    sessions,
    unprocessed,
  }: {
    sessions: SessionType[]
    unprocessed: Array<UnprocessedType>
  }) {
    await queue.addAll([
      // async () => {
      //   for (const item of senderKeys) {
      //     assertSync(createOrUpdateSenderKeySync(item))
      //   }
      // },
      async () => {
        for (const item of sessions) {
          this.createOrUpdateSignalSession({
            ...item,
            sessionId: item.id,
          })
        }
      },
      async () => {
        for (const item of unprocessed) {
          this.saveUnprocessed(item)
        }
      },
    ])
  }

  // -------------------- SIGNAL IDENTITY KEY ------------------------

  async getAllSignalIdentityKeys(): Promise<IdentityKeyType[]> {
    return queue.add(async () => {
      const res = await database.get<SignalIdentityKey>('signal_identity_keys').query().fetch()
      return res.map(serializeSignalIdentityKey)
    })
  }

  // async getSignalIdentityKey(id: string): Promise<IdentityKeyType> {
  //   return queue.add(async () => {
  //     const res = await database.get<SignalIdentityKey>('signal_identity_keys').find(id)
  //     if (res) {
  //       return serializeSignalIdentityKey(res)
  //     }
  //     return null
  //   })
  // }

  createOrUpdateSignalIdentityKey(payload: IdentityKeyType): Promise<string> {
    const { ourId, theirId } = payload
    return new Promise((resolve, reject) => {
      queue.add(async () => {
        await database.write(async () => {
          try {
            const identityKeys = await database
              .get<SignalIdentityKey>('signal_identity_keys')
              .query(Q.where('our_id', ourId), Q.where('their_id', theirId))
              .fetch()
            if (identityKeys.length >= 2) {
              throw new Error(`Found more than 1 SignalIdentityKey record for ${ourId} | ${theirId}`)
            }
            if (identityKeys.length === 1) {
              await identityKeys[0]!.update((obj) => {
                mapUpdateSignalIdentityKeyObj(obj, payload)
              })
              resolve(identityKeys[0]!.id)
              return
            }
            const res = await database.get<SignalIdentityKey>('signal_identity_keys').create((obj) => {
              mapCreateSignalIdentityKeyObj(obj, payload)
            })
            resolve(res.id)
          } catch (e) {
            reject(e)
          }
        })
      })
    })
  }

  async clearSignalIdentityKey(id: string): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          await database.get<SignalIdentityKey>('signal_identity_keys').query(Q.where('id', id)).destroyAllPermanently()
          resolve()
        })
      })
    })
  }

  // --------------------- Unprocessed envelope ---------------------

  getUnprocessedCount!: () => Promise<number>

  getUnprocessedByIdsAndIncrementAttempts!: (ids: readonly string[]) => Promise<UnprocessedType[]>

  getAllUnprocessedIds!: () => Promise<string[]>

  saveUnprocessed(data: UnprocessedType): Promise<string> {
    return new Promise((resolve, reject) => {
      queue.add(async () => {
        await database.write(async () => {
          try {
            const res = await database.get<UnprocessedData>('unprocessed_data').create((obj) => {
              mapUnprocessedDataToDB(obj, data)
            })
            resolve(res.id)
          } catch (e) {
            reject(e)
          }
        })
      })
    })
  }

  updateUnprocessedWithData!: (id: string, data: UnprocessedUpdateType) => Promise<void>

  updateUnprocessedsWithData!: (array: { id: string; data: UnprocessedUpdateType }[]) => Promise<void>

  getUnprocessedById!: (id: string) => Promise<UnprocessedType>

  removeUnprocessed(id: string | string[]): Promise<void> {
    return new Promise((resolve) => {
      queue.add(async () => {
        await database.write(async () => {
          await database
            .get<UnprocessedData>('unprocessed_data')
            .query(Q.where('id', Array.isArray(id) ? Q.oneOf(id) : id))
            .destroyAllPermanently()
          resolve()
        })
      })
    })
  }

  removeAllUnprocessed!: () => Promise<void>
}
