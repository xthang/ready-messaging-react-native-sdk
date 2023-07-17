// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */

import { debounce } from 'lodash'

import { type ConversationDBType, ConversationModelCollectionType, ConversationType, GroupType } from 'types/chat'
import { logger as log } from 'utils/logger'
import type { ConversationModel } from './models/conversations'
import utils from './textsecure/Helpers'
import { type AccountIdStringType } from './types/Account'
import * as Errors from './types/errors'
import { isValidReadyId, type ReadyAddressStringType } from './types/ReadyId'
import { isValidUuid, type UUIDStringType } from './types/UUID'
import { SECOND } from './utils/durations'

// function applyChangeToConversation(
//   conversation: ConversationModel,
//   suggestedChange: Partial<Pick<ConversationDBType, 'description'>>
// ) {
//   const change = { ...suggestedChange }

//   // Clear PNI if changing e164 without associated PNI
//   if (hasOwnProperty.call(change, 'e164') && !change.pni) {
//     change.pni = undefined
//   }

//   // If we have a PNI but not an ACI, then the PNI will go in the UUID field
//   //   Tricky: We need a special check here, because the PNI can be in the uuid slot
//   if (
//     change.pni &&
//     !change.uuid &&
//     (!conversation.get('uuid') || conversation.get('uuid') === conversation.get('pni'))
//   ) {
//     change.uuid = change.pni
//   }

//   // If we're clearing a PNI, but we didn't have an ACI - we need to clear UUID field
//   if (
//     !change.uuid &&
//     hasOwnProperty.call(change, 'pni') &&
//     !change.pni &&
//     conversation.get('uuid') === conversation.get('pni')
//   ) {
//     change.uuid = undefined
//   }

//   if (hasOwnProperty.call(change, 'uuid')) {
//     conversation.updateUuid(change.uuid)
//   }
//   if (hasOwnProperty.call(change, 'e164')) {
//     conversation.updateE164(change.e164)
//   }
//   if (hasOwnProperty.call(change, 'pni')) {
//     conversation.updatePni(change.pni)
//   }

//   // Note: we don't do a conversation.set here, because change is limited to these fields
// }

// export type CombineConversationsParams = Readonly<{
//   current: ConversationModel
//   // fromPniSignature?: boolean
//   obsolete: ConversationModel
//   obsoleteTitleInfo?: ConversationRenderInfoType
// }>
// export type SafeCombineConversationsParams = Readonly<{ logId: string }> &
//   CombineConversationsParams

// async function safeCombineConversations(options: SafeCombineConversationsParams) {
//   try {
//     await window.Signal.conversationController.combineConversations(options)
//   } catch (error) {
//     log.warn(`${options.logId}: error combining contacts: ${Errors.toLogFormat(error)}`)
//   }
// }

const MAX_MESSAGE_BODY_LENGTH = 64 * 1024

export class ConversationController {
  private _initialFetchComplete = false

  private _initialPromise: undefined | Promise<void>

  private _conversationOpenStart = new Map<string, number>()

  private _hasQueueEmptied = false

  // private _combineConversationsQueue = new PQueue({ concurrency: 1 })

  // private _signalConversationId: undefined | string

  constructor(private _conversations: ConversationModelCollectionType) {
    const debouncedUpdateUnreadCount = debounce(this.updateUnreadCount.bind(this), SECOND, {
      leading: true,
      maxWait: SECOND,
      trailing: true,
    })

    // A few things can cause us to update the app-level unread count
    window.Whisper.events.on('updateUnreadCount', debouncedUpdateUnreadCount)
    this._conversations.on(
      'add remove change:active_at change:unreadCount change:markedUnread change:isArchived change:muteExpiresAt',
      debouncedUpdateUnreadCount
    )

    // If the conversation is muted we set a timeout so when the mute expires
    // we can reset the mute state on the model. If the mute has already expired
    // then we reset the state right away.
    this._conversations.on('add', (model: ConversationModel): void => {
      model.startMuteTimer()
    })
  }

  load(tag: string): Promise<void> {
    // this._initialPromise ||= this.doLoad()
    if (!this._initialPromise) this._initialPromise = this.doLoad(tag)
    return this._initialPromise
  }

  private async doLoad(tag: string): Promise<void> {
    log.info(`--  ConversationController [${tag}]: starting initial fetch`)

    if (this._conversations.length) {
      throw new Error(`--  ConversationController [${tag}]: Already loaded!`)
    }

    try {
      const collection = await window.Ready.Data.getAllConversations()

      // Get rid of temporary conversations
      // const temporaryConversations = collection.filter((conversation) =>
      //   Boolean(conversation.isTemporary)
      // )

      // if (temporaryConversations.length) {
      //   log.warn(
      //     `ConversationController: Removing ${temporaryConversations.length} temporary conversations`
      //   )
      // }
      // const queue = new PQueue({
      //   concurrency: 3,
      //   timeout: MINUTE * 30,
      //   throwOnTimeout: true,
      // })
      // queue.addAll(
      //   temporaryConversations.map((item) => async () => {
      //     await removeConversation(item.id)
      //   })
      // )
      // await queue.onIdle()

      // Hydrate the final set of conversations
      this._conversations.add(collection) // .filter((conversation) => !conversation.isTemporary))

      this._initialFetchComplete = true

      await Promise.all(
        this._conversations.map(async (conversation) => {
          try {
            // Hydrate contactCollection, now that initial fetch is complete
            // conversation.fetchContacts()
            // const isChanged = maybeDeriveGroupV2Id(conversation)
            // if (isChanged) {
            //   updateConversation(conversation.attributes)
            // }
            // In case a too-large draft was saved to the database
            // const draft = conversation.get('draft')
            // if (draft && draft.length > MAX_MESSAGE_BODY_LENGTH) {
            //   conversation.set({
            //     draft: draft.slice(0, MAX_MESSAGE_BODY_LENGTH),
            //   })
            //   updateConversation(conversation.attributes)
            // }
            // Clean up the conversations that have UUID as their e164.
            // const e164 = conversation.get('e164')
            // const uuid = conversation.get('uuid')
            // if (isValidUuid(e164) && uuid) {
            //   conversation.set({ e164: undefined })
            //   updateConversation(conversation.attributes)
            //   log.info(`Cleaning up conversation(${uuid}) with invalid e164`)
            // }
          } catch (error) {
            log.error(
              `ConversationController.load/map [${tag}]: Failed to prepare a conversation`,
              Errors.toLogFormat(error)
            )
          }
        })
      )
      log.info(`--  ConversationController [${tag}]: done with initial fetch`)
    } catch (error) {
      log.error(`!-  ConversationController [${tag}]: initial fetch failed:`, Errors.toLogFormat(error))
      throw error
    }
  }

  reset(): void {
    delete this._initialPromise
    this._initialFetchComplete = false
    this._conversations.reset([])
  }

  updateUnreadCount(): void {
    if (!this._hasQueueEmptied) {
      return
    }

    throw new Error('...')
    // const canCountMutedConversations =
    //   window.storage.get('badge-count-muted-conversations') || false

    // const newUnreadCount = this._conversations.reduce(
    //   (result: number, conversation: ConversationModel) =>
    //     result +
    //     getConversationUnreadCountForAppBadge(conversation.attributes, canCountMutedConversations),
    //   0
    // )
    // drop(window.storage.put('unreadCount', newUnreadCount))

    // if (newUnreadCount > 0) {
    //   window.IPC.setBadgeCount(newUnreadCount)
    //   window.document.title = `${window.getTitle()} (${newUnreadCount})`
    // } else {
    //   window.IPC.setBadgeCount(0)
    //   window.document.title = window.getTitle()
    // }
    // window.IPC.updateTrayIcon(newUnreadCount)
  }

  onEmpty(): void {
    this._hasQueueEmptied = true
    this.updateUnreadCount()
  }

  get(id: string): ConversationModel | undefined {
    if (!this._initialFetchComplete) {
      throw new Error(`ConversationController.get(${id}) needs complete initial fetch`)
    }

    // This function takes null just fine. Backbone typings are too restrictive.
    return this._conversations.get(id)
  }

  getByIdentifier(
    ourId: AccountIdStringType,
    identifier: UUIDStringType | ReadyAddressStringType
  ): ConversationModel | undefined {
    if (!this._initialFetchComplete) {
      throw new Error(`ConversationController.getByIdentifier(${identifier}) needs complete initial fetch`)
    }

    // This function takes null just fine. Backbone typings are too restrictive.
    return this._conversations.getByIdentifier(ourId, identifier)
  }

  getByAccountId(ourId: AccountIdStringType): ConversationModel[] | undefined {
    if (!this._initialFetchComplete) {
      throw new Error(`ConversationController.getByAccountId(${ourId}) needs complete initial fetch`)
    }

    // This function takes null just fine. Backbone typings are too restrictive.
    return this._conversations.getByAccountId(ourId)
  }

  getAll(): Array<ConversationModel> {
    return this._conversations.models
  }

  dangerouslyCreateAndAdd(attributes: Partial<ConversationDBType>): ConversationModel {
    return this._conversations.add(attributes)
  }

  dangerouslyRemoveById(id: string): void {
    this._conversations.remove(id)
    this._conversations.resetLookups()
  }

  async getOrCreate(
    tag: string,
    ourId: AccountIdStringType,
    identifier: UUIDStringType | ReadyAddressStringType,
    type: ConversationType,
    groupType?: GroupType,
    additionalInitialProps?: Partial<ConversationDBType>
  ): Promise<ConversationModel> {
    await this.load(`getOrCreate|${tag}`)

    if (typeof ourId !== 'string') {
      throw new TypeError(`ConversationController.getOrCreate|${tag}: 'ourId' must be a string: ${ourId}`)
    }

    if (typeof identifier !== 'string' || (!isValidReadyId(identifier) && !isValidUuid(identifier))) {
      throw new TypeError(`ConversationController.getOrCreate|${tag}: 'id' must be a string: ${identifier}`)
    }

    if (type !== ConversationType.PRIVATE && type !== ConversationType.GROUP) {
      throw new TypeError(
        `ConversationController.getOrCreate|${tag}: 'type' must be 'private' or 'group'; got: '${type}'`
      )
    }

    if (!this._initialFetchComplete) {
      throw new Error(`ConversationController.getOrCreate|${tag}: needs complete initial fetch`)
    }

    let conversation = this._conversations.getByIdentifier(ourId, identifier)
    if (conversation) {
      return conversation
    }

    const attributes = {
      accountId: ourId,
      identifier,
      type,
      groupType,
      version: 1,
      ...additionalInitialProps,
    }

    const id = await window.Ready.Data.createConversation(attributes)

    conversation = this._conversations.add({ id, ...attributes })

    if (conversation) {
      await conversation.initialPromise
      // if (!conversation.get('name')) await conversation.getProfile('ConversationController.create')
      return conversation
    }

    throw new Error(`ConversationController.getOrCreate|${tag}: did not get conversation`)
  }

  getConversationId(accountId: string, address: string | null): string | null {
    if (!address) {
      return null
    }

    const [id] = utils.unencodeNumber(address)
    const conv = this.get(`${accountId}:${id}`)

    if (conv) {
      return conv.get('id')!
    }

    return null
  }

  async getOurConversation(ourAccount: { id: string; address: ReadyAddressStringType }): Promise<ConversationModel> {
    return this.getOrCreate('getOurConversation', ourAccount.id, ourAccount.address, ConversationType.PRIVATE)
  }

  async getOurConversationOrThrow(ourAccount: {
    id: string
    address: ReadyAddressStringType
  }): Promise<ConversationModel> {
    const conversation = await this.getOurConversation(ourAccount)
    if (!conversation) {
      throw new Error('getOurConversationOrThrow: Failed to fetch ourConversationId')
    }
    return conversation
  }

  // async getOrCreateSignalConversation(): Promise<ConversationModel> {
  //   const conversation = await this.getOrCreateAndWait(SIGNAL_ACI, 'private', {
  //     muteExpiresAt: Number.MAX_SAFE_INTEGER,
  //     profileAvatar: { path: SIGNAL_AVATAR_PATH },
  //     profileName: 'Signal',
  //     profileSharing: true,
  //   })

  //   if (conversation.get('profileAvatar')?.path !== SIGNAL_AVATAR_PATH) {
  //     conversation.set({
  //       profileAvatar: { hash: SIGNAL_AVATAR_PATH, path: SIGNAL_AVATAR_PATH },
  //     })
  //     updateConversation(conversation.attributes)
  //   }

  //   if (!conversation.get('profileName')) {
  //     conversation.set({ profileName: 'Signal' })
  //     updateConversation(conversation.attributes)
  //   }

  //   this._signalConversationId = conversation.id

  //   return conversation
  // }

  // isSignalConversation(uuidOrId: string): boolean {
  //   if (uuidOrId === SIGNAL_ACI) {
  //     return true
  //   }

  //   return this._signalConversationId === uuidOrId
  // }

  // areWePrimaryDevice(): boolean {
  //   const ourDeviceId = window.textsecure.storage.user.getDeviceId()

  //   return ourDeviceId === 1
  // }

  // // Note: If you don't know what kind of UUID it is, put it in the 'aci' param.
  // maybeMergeContacts({
  //   aci: providedAci,
  //   e164,
  //   pni: providedPni,
  //   reason,
  //   fromPniSignature,
  //   mergeOldAndNew = safeCombineConversations,
  // }: {
  //   aci?: string
  //   e164?: string
  //   pni?: string
  //   reason: string
  //   fromPniSignature?: boolean
  //   mergeOldAndNew?: (options: SafeCombineConversationsParams) => Promise<void>
  // }): {
  //   conversation: ConversationModel
  //   mergePromises: Array<Promise<void>>
  // } {
  //   const dataProvided = []
  //   if (providedAci) {
  //     dataProvided.push(`aci=${providedAci}`)
  //   }
  //   if (e164) {
  //     dataProvided.push(`e164=${e164}`)
  //   }
  //   if (providedPni) {
  //     dataProvided.push(`pni=${providedPni}`)
  //   }
  //   const logId = `maybeMergeContacts/${reason}/${dataProvided.join(',')}`

  //   const aci = providedAci && providedAci !== providedPni ? UUID.cast(providedAci) : undefined
  //   const pni = providedPni ? UUID.cast(providedPni) : undefined
  //   const mergePromises: Array<Promise<void>> = []

  //   if (!aci && !e164 && !pni) {
  //     throw new Error(`${logId}: Need to provide at least one of: aci, e164, pni`)
  //   }

  //   const matches: Array<ConvoMatchType> = [
  //     {
  //       key: 'uuid',
  //       value: aci,
  //       match: window.Signal.conversationController.get(aci),
  //     },
  //     {
  //       key: 'e164',
  //       value: e164,
  //       match: window.Signal.conversationController.get(e164),
  //     },
  //     { key: 'pni', value: pni, match: window.Signal.conversationController.get(pni) },
  //   ]
  //   let unusedMatches: Array<ConvoMatchType> = []

  //   let targetConversation: ConversationModel | undefined
  //   let matchCount = 0
  //   matches.forEach((item) => {
  //     const { key, value, match } = item

  //     if (!value) {
  //       return
  //     }

  //     if (!match) {
  //       if (targetConversation) {
  //         log.info(
  //           `${logId}: No match for ${key}, applying to target ` +
  //             `conversation - ${targetConversation.idForLogging()}`
  //         )
  //         // Note: This line might erase a known e164 or PNI
  //         applyChangeToConversation(targetConversation, {
  //           [key]: value,
  //         })
  //       } else {
  //         unusedMatches.push(item)
  //       }
  //       return
  //     }

  //     matchCount += 1
  //     unusedMatches.forEach((unused) => {
  //       strictAssert(unused.value, 'An unused value should always be truthy')

  //       // Example: If we find that our PNI match has no ACI, then it will be our target.

  //       if (!targetConversation && !match.get(unused.key)) {
  //         log.info(
  //           `${logId}: Match on ${key} does not have ${unused.key}, ` +
  //             `so it will be our target conversation - ${match.idForLogging()}`
  //         )
  //         targetConversation = match
  //       }
  //       // Tricky: PNI can end up in UUID slot, so we need to special-case it
  //       if (!targetConversation && unused.key === 'uuid' && match.get(unused.key) === pni) {
  //         log.info(
  //           `${logId}: Match on ${key} has uuid matching incoming pni, ` +
  //             `so it will be our target conversation - ${match.idForLogging()}`
  //         )
  //         targetConversation = match
  //       }
  //       // Tricky: PNI can end up in UUID slot, so we need to special-case it
  //       if (
  //         !targetConversation &&
  //         unused.key === 'uuid' &&
  //         match.get(unused.key) === match.get('pni')
  //       ) {
  //         log.info(
  //           `${logId}: Match on ${key} has pni/uuid which are the same value, ` +
  //             `so it will be our target conversation - ${match.idForLogging()}`
  //         )
  //         targetConversation = match
  //       }

  //       // If PNI match already has an ACI, then we need to create a new one
  //       if (!targetConversation) {
  //         targetConversation = this.getOrCreate(unused.value, 'private')
  //         log.info(
  //           `${logId}: Match on ${key} already had ${unused.key}, ` +
  //             `so created new target conversation - ${targetConversation.idForLogging()}`
  //         )
  //       }

  //       log.info(`${logId}: Applying new value for ${unused.key} to target conversation`)
  //       applyChangeToConversation(targetConversation, {
  //         [unused.key]: unused.value,
  //       })
  //     })

  //     unusedMatches = []

  //     if (targetConversation && targetConversation !== match) {
  //       // We need to grab this before we start taking key data from it. If we're merging
  //       //   by e164, we want to be sure that is what is rendered in the notification.
  //       const obsoleteTitleInfo =
  //         key === 'e164'
  //           ? pick(match.attributes as ConversationDBType, ['e164', 'type'])
  //           : pick(match.attributes as ConversationDBType, [
  //               'e164',
  //               'profileFamilyName',
  //               'profileName',
  //               'systemGivenName',
  //               'systemFamilyName',
  //               'systemNickname',
  //               'type',
  //               'username',
  //             ])

  //       // Clear the value on the current match, since it belongs on targetConversation!
  //       //   Note: we need to do the remove first, because it will clear the lookup!
  //       log.info(
  //         `${logId}: Clearing ${key} on match, and adding it to target ` +
  //           `conversation - ${targetConversation.idForLogging()}`
  //       )
  //       const change: Pick<Partial<ConversationDBType>, 'uuid' | 'e164' | 'pni'> = {
  //         [key]: undefined,
  //       }
  //       // When the PNI is being used in the uuid field alone, we need to clear it
  //       if ((key === 'pni' || key === 'e164') && match.get('uuid') === pni) {
  //         change.uuid = undefined
  //       }
  //       applyChangeToConversation(match, change)

  //       // Note: The PNI check here is just to be bulletproof; if we know a UUID is a PNI,
  //       //   then that should be put in the UUID field as well!
  //       const willMerge = !match.get('uuid') && !match.get('e164') && !match.get('pni')

  //       applyChangeToConversation(targetConversation, {
  //         [key]: value,
  //       })

  //       if (willMerge) {
  //         log.warn(
  //           `${logId}: Removing old conversation which matched on ${key}. ` +
  //             `Merging with target conversation - ${targetConversation.idForLogging()}`
  //         )
  //         mergePromises.push(
  //           mergeOldAndNew({
  //             current: targetConversation,
  //             fromPniSignature,
  //             logId,
  //             obsolete: match,
  //             obsoleteTitleInfo,
  //           })
  //         )
  //       }
  //     } else if (targetConversation && !targetConversation?.get(key)) {
  //       // This is mostly for the situation where PNI was erased when updating e164
  //       log.debug(
  //         `${logId}: Re-adding ${key} on target conversation - ` +
  //           `${targetConversation.idForLogging()}`
  //       )
  //       applyChangeToConversation(targetConversation, {
  //         [key]: value,
  //       })
  //     }

  //     if (!targetConversation) {
  //       // log.debug(
  //       //   `${logId}: Match on ${key} is target conversation - ${match.idForLogging()}`
  //       // );
  //       targetConversation = match
  //     }
  //   })

  //   if (targetConversation) {
  //     return { conversation: targetConversation, mergePromises }
  //   }

  //   strictAssert(matchCount === 0, `${logId}: should be no matches if no targetConversation`)

  //   log.info(`${logId}: Creating a new conversation with all inputs`)

  //   // This is not our precedence for lookup, but it ensures that the PNI gets into the
  //   //   uuid slot if we have no ACI.
  //   const identifier = aci || pni || e164
  //   strictAssert(identifier, `${logId}: identifier must be truthy!`)

  //   return {
  //     conversation: this.getOrCreate(identifier, 'private', { e164, pni }),
  //     mergePromises,
  //   }
  // }

  /**
   * Given a UUID and/or an E164, returns a string representing the local
   * database id of the given contact. Will create a new conversation if none exists;
   * otherwise will return whatever is found.
   */
  // lookupOrCreate({
  //   e164,
  //   uuid,
  //   reason,
  // }: {
  //   e164?: string | null
  //   uuid?: string | null
  //   reason: string
  // }): ConversationModel | undefined {
  //   const normalizedUuid = uuid ? uuid.toLowerCase() : undefined
  //   const identifier = normalizedUuid || e164

  //   if ((!e164 && !uuid) || !identifier) {
  //     log.warn(`lookupOrCreate: Called with neither e164 nor uuid! reason: ${reason}`)
  //     return undefined
  //   }

  //   const convoE164 = this.get(e164)
  //   const convoUuid = this.get(normalizedUuid)

  //   // 1. Handle no match at all
  //   if (!convoE164 && !convoUuid) {
  //     log.info('lookupOrCreate: Creating new contact, no matches found')
  //     const newConvo = this.getOrCreate(identifier, 'private')

  //     // `identifier` would resolve to uuid if we had both, so fix up e164
  //     if (normalizedUuid && e164) {
  //       newConvo.updateE164(e164)
  //     }

  //     return newConvo
  //   }

  //   // 2. Handle match on only UUID
  //   if (!convoE164 && convoUuid) {
  //     return convoUuid
  //   }

  //   // 3. Handle match on only E164
  //   if (convoE164 && !convoUuid) {
  //     return convoE164
  //   }

  //   // For some reason, TypeScript doesn't believe that we can trust that these two values
  //   //   are truthy by this point. So we'll throw if that isn't the case.
  //   if (!convoE164 || !convoUuid) {
  //     throw new Error(
  //       `lookupOrCreate: convoE164 or convoUuid are falsey but should both be true! reason: ${reason}`
  //     )
  //   }

  //   // 4. If the two lookups agree, return that conversation
  //   if (convoE164 === convoUuid) {
  //     return convoUuid
  //   }

  //   // 5. If the two lookups disagree, log and return the UUID match
  //   log.warn(
  //     `lookupOrCreate: Found a split contact - UUID ${normalizedUuid} and E164 ${e164}. Returning UUID match. reason: ${reason}`
  //   )
  //   return convoUuid
  // }

  // checkForConflicts(): Promise<void> {
  //   return this._combineConversationsQueue.add(() => this.doCheckForConflicts())
  // }

  // // Note: `doCombineConversations` is directly used within this function since both
  // //   run on `_combineConversationsQueue` queue and we don't want deadlocks.
  // private async doCheckForConflicts(): Promise<void> {
  //   log.info('checkForConflicts: starting...')
  //   const byUuid = Object.create(null)
  //   const byE164 = Object.create(null)
  //   const byGroupV2Id = Object.create(null)
  //   // We also want to find duplicate GV1 IDs. You might expect to see a "byGroupV1Id" map
  //   //   here. Instead, we check for duplicates on the derived GV2 ID.

  //   const { models } = this._conversations

  //   // We iterate from the oldest conversations to the newest. This allows us, in a
  //   //   conflict case, to keep the one with activity the most recently.
  //   for (let i = models.length - 1; i >= 0; i -= 1) {
  //     const conversation = models[i]
  //     assertDev(conversation, 'Expected conversation to be found in array during iteration')

  //     const uuid = conversation.get('uuid')
  //     const pni = conversation.get('pni')
  //     const e164 = conversation.get('e164')

  //     if (uuid) {
  //       const existing = byUuid[uuid]
  //       if (!existing) {
  //         byUuid[uuid] = conversation
  //       } else {
  //         log.warn(`checkForConflicts: Found conflict with uuid ${uuid}`)

  //         // Keep the newer one if it has an e164, otherwise keep existing
  //         if (conversation.get('e164')) {
  //           // Keep new one
  //           // eslint-disable-next-line no-await-in-loop
  //           await this.doCombineConversations({
  //             current: conversation,
  //             obsolete: existing,
  //           })
  //           byUuid[uuid] = conversation
  //         } else {
  //           // Keep existing - note that this applies if neither had an e164
  //           // eslint-disable-next-line no-await-in-loop
  //           await this.doCombineConversations({
  //             current: existing,
  //             obsolete: conversation,
  //           })
  //         }
  //       }
  //     }

  //     if (pni) {
  //       const existing = byUuid[pni]
  //       if (!existing) {
  //         byUuid[pni] = conversation
  //       } else if (existing === conversation) {
  //         // Conversation has both uuid and pni set to the same value. This
  //         // happens when starting a conversation by E164.
  //         assertDev(pni === uuid, 'checkForConflicts: expected PNI to be equal to UUID')
  //       } else {
  //         log.warn(`checkForConflicts: Found conflict with pni ${pni}`)

  //         // Keep the newer one if it has additional data, otherwise keep existing
  //         if (conversation.get('e164') || conversation.get('pni')) {
  //           // Keep new one
  //           // eslint-disable-next-line no-await-in-loop
  //           await this.doCombineConversations({
  //             current: conversation,
  //             obsolete: existing,
  //           })
  //           byUuid[pni] = conversation
  //         } else {
  //           // Keep existing - note that this applies if neither had an e164
  //           // eslint-disable-next-line no-await-in-loop
  //           await this.doCombineConversations({
  //             current: existing,
  //             obsolete: conversation,
  //           })
  //         }
  //       }
  //     }

  //     if (e164) {
  //       const existing = byE164[e164]
  //       if (!existing) {
  //         byE164[e164] = conversation
  //       } else {
  //         // If we have two contacts with the same e164 but different truthy UUIDs, then
  //         //   we'll delete the e164 on the older one
  //         if (
  //           conversation.get('uuid') &&
  //           existing.get('uuid') &&
  //           conversation.get('uuid') !== existing.get('uuid')
  //         ) {
  //           log.warn(
  //             `checkForConflicts: Found two matches on e164 ${e164} with different truthy UUIDs. Dropping e164 on older.`
  //           )

  //           existing.set({ e164: undefined })
  //           updateConversation(existing.attributes)

  //           byE164[e164] = conversation

  //           continue
  //         }

  //         log.warn(`checkForConflicts: Found conflict with e164 ${e164}`)

  //         // Keep the newer one if it has a UUID, otherwise keep existing
  //         if (conversation.get('uuid')) {
  //           // Keep new one
  //           // eslint-disable-next-line no-await-in-loop
  //           await this.doCombineConversations({
  //             current: conversation,
  //             obsolete: existing,
  //           })
  //           byE164[e164] = conversation
  //         } else {
  //           // Keep existing - note that this applies if neither had a UUID
  //           // eslint-disable-next-line no-await-in-loop
  //           await this.doCombineConversations({
  //             current: existing,
  //             obsolete: conversation,
  //           })
  //         }
  //       }
  //     }

  //     let groupV2Id: undefined | string
  //     if (isGroupV1(conversation.attributes)) {
  //       maybeDeriveGroupV2Id(conversation)
  //       groupV2Id = conversation.get('derivedGroupV2Id')
  //       assertDev(
  //         groupV2Id,
  //         'checkForConflicts: expected the group V2 ID to have been derived, but it was falsy'
  //       )
  //     } else if (isGroupV2(conversation.attributes)) {
  //       groupV2Id = conversation.get('groupId')
  //     }

  //     if (groupV2Id) {
  //       const existing = byGroupV2Id[groupV2Id]
  //       if (!existing) {
  //         byGroupV2Id[groupV2Id] = conversation
  //       } else {
  //         const logParenthetical = isGroupV1(conversation.attributes)
  //           ? ' (derived from a GV1 group ID)'
  //           : ''
  //         log.warn(
  //           `checkForConflicts: Found conflict with group V2 ID ${groupV2Id}${logParenthetical}`
  //         )

  //         // Prefer the GV2 group.
  //         if (isGroupV2(conversation.attributes) && !isGroupV2(existing.attributes)) {
  //           // eslint-disable-next-line no-await-in-loop
  //           await this.doCombineConversations({
  //             current: conversation,
  //             obsolete: existing,
  //           })
  //           byGroupV2Id[groupV2Id] = conversation
  //         } else {
  //           // eslint-disable-next-line no-await-in-loop
  //           await this.doCombineConversations({
  //             current: existing,
  //             obsolete: conversation,
  //           })
  //         }
  //       }
  //     }
  //   }

  //   log.info('checkForConflicts: complete!')
  // }

  // async combineConversations(options: CombineConversationsParams): Promise<void> {
  //   return this._combineConversationsQueue.add(() => this.doCombineConversations(options))
  // }

  // private async doCombineConversations({
  //   current,
  //   obsolete,
  //   obsoleteTitleInfo,
  //   fromPniSignature,
  // }: CombineConversationsParams): Promise<void> {
  //   const logId = `combineConversations/${obsolete.id}->${current.id}`

  //   const conversationType = current.get('type')

  //   if (!this.get(obsolete.id)) {
  //     log.warn(`${logId}: Already combined obsolete conversation`)
  //     return
  //   }

  //   if (obsolete.get('type') !== conversationType) {
  //     assertDev(false, `${logId}: cannot combine a private and group conversation. Doing nothing`)
  //     return
  //   }

  //   log.warn(
  //     `${logId}: Combining two conversations -`,
  //     `old: ${obsolete.idForLogging()} -> new: ${current.idForLogging()}`
  //   )

  //   const obsoleteActiveAt = obsolete.get('active_at')
  //   const currentActiveAt = current.get('active_at')
  //   const activeAt =
  //     !obsoleteActiveAt || !currentActiveAt || currentActiveAt > obsoleteActiveAt
  //       ? currentActiveAt
  //       : obsoleteActiveAt
  //   current.set('active_at', activeAt)

  //   const dataToCopy: Partial<ConversationDBType> = pick(obsolete.attributes, [
  //     'conversationColor',
  //     'customColor',
  //     'customColorId',
  //     'draftAttachments',
  //     'draftBodyRanges',
  //     'draftTimestamp',
  //     'messageCount',
  //     'messageRequestResponseType',
  //     'profileSharing',
  //     'quotedMessageId',
  //     'sentMessageCount',
  //   ])

  //   const keys = Object.keys(dataToCopy) as Array<keyof ConversationDBType>
  //   keys.forEach((key) => {
  //     if (current.get(key) === undefined) {
  //       current.set(key, dataToCopy[key])

  //       // To ensure that any files on disk don't get deleted out from under us
  //       if (key === 'draftAttachments') {
  //         obsolete.set(key, undefined)
  //       }
  //     }
  //   })

  //   if (obsolete.get('isPinned')) {
  //     obsolete.unpin()

  //     if (!current.get('isPinned')) {
  //       current.pin()
  //     }
  //   }

  //   const obsoleteId = obsolete.get('id')
  //   const obsoleteUuid = obsolete.getUuid()
  //   const currentId = current.get('id')

  //   if (conversationType === 'private' && obsoleteUuid) {
  //     if (!current.get('profileKey') && obsolete.get('profileKey')) {
  //       log.warn(`${logId}: Copying profile key from old to new contact`)

  //       const profileKey = obsolete.get('profileKey')

  //       if (profileKey) {
  //         await current.setProfileKey(profileKey)
  //       }
  //     }

  //     log.warn(`${logId}: Delete all sessions tied to old conversationId`)
  //     // Note: we use the conversationId here in case we've already lost our uuid.
  //     await window.textsecure.storage.protocol.removeSessionsByConversation(obsoleteId)

  //     log.warn(`${logId}: Delete all identity information tied to old conversationId`)
  //     if (obsoleteUuid) {
  //       await window.textsecure.storage.protocol.removeIdentityKey(obsoleteUuid)
  //     }

  //     log.warn(`${logId}: Ensure that all V1 groups have new conversationId instead of old`)
  //     const groups = await this.getAllGroupsInvolvingUuid(obsoleteUuid)
  //     groups.forEach((group) => {
  //       const members = group.get('members')
  //       const withoutObsolete = without(members, obsoleteId)
  //       const currentAdded = uniq([...withoutObsolete, currentId])

  //       group.set({
  //         members: currentAdded,
  //       })
  //       updateConversation(group.attributes)
  //     })
  //   }

  //   // Note: we explicitly don't want to update V2 groups

  //   const obsoleteHadMessages = (obsolete.get('messageCount') ?? 0) > 0

  //   log.warn(`${logId}: Delete the obsolete conversation from the database`)
  //   await removeConversation(obsoleteId)

  //   log.warn(`${logId}: Update cached messages in MessageController`)
  //   window.MessageController.update((message: MessageModel) => {
  //     if (message.get('conversationId') === obsoleteId) {
  //       message.set({ conversationId: currentId })
  //     }
  //   })

  //   log.warn(`${logId}: Update messages table`)
  //   await migrateConversationMessages(obsoleteId, currentId)

  //   log.warn(`${logId}: Emit refreshConversation event to close old/open new`)
  //   window.Whisper.events.trigger('refreshConversation', {
  //     newId: currentId,
  //     oldId: obsoleteId,
  //   })

  //   log.warn(`${logId}: Eliminate old conversation from ConversationController lookups`)
  //   this._conversations.remove(obsolete)
  //   this._conversations.resetLookups()

  //   current.captureChange('combineConversations')
  //   drop(current.updateLastMessage())

  //   const state = window.reduxStore.getState()
  //   if (state.conversations.selectedConversationId === current.id) {
  //     // TODO: DESKTOP-4807
  //     drop(current.loadNewestMessages(undefined, undefined))
  //   }

  //   const titleIsUseful = Boolean(obsoleteTitleInfo && getTitleNoDefault(obsoleteTitleInfo))
  //   if (obsoleteTitleInfo && titleIsUseful && !fromPniSignature && obsoleteHadMessages) {
  //     drop(current.addConversationMerge(obsoleteTitleInfo))
  //   }

  //   log.warn(`${logId}: Complete!`)
  // }

  /**
   * Given a groupId and optional additional initialization properties,
   * ensures the existence of a group conversation and returns a string
   * representing the local database ID of the group conversation.
   */
  // ensureGroup(
  //   ourId: AccountIdStringType,
  //   groupId: UUIDStringType,
  //   groupType: ConversationAttributesGroupTypeType | undefined,
  //   additionalInitProps = {}
  // ): string {
  //   return this.getOrCreate(ourId, groupId, 'group', groupType, additionalInitProps).get('id')
  // }

  /**
   * Given certain metadata about a message (an identifier of who wrote the
   * message and the sent_at timestamp of the message) returns the
   * conversation the message belongs to OR null if a conversation isn't
   * found.
   */
  // async getConversationForTargetMessage(
  //   targetFromId: string,
  //   targetTimestamp: number
  // ): Promise<ConversationModel | null | undefined> {
  //   const messages = await getMessagesBySentAt(targetTimestamp)
  //   const targetMessage = messages.find((m) => getContactId(m) === targetFromId)

  //   if (targetMessage) {
  //     return this.get(targetMessage.conversationId)
  //   }

  //   return null
  // }

  // async getAllGroupsInvolvingUuid(uuid: UUID): Promise<Array<ConversationModel>> {
  //   const groups = await getAllGroupsInvolvingUuid(uuid.toString())
  //   return groups.map((group) => {
  //     const existing = this.get(group.id)
  //     if (existing) {
  //       return existing
  //     }

  //     return this._conversations.add(group)
  //   })
  // }

  // getByDerivedGroupV2Id(groupId: string): ConversationModel | undefined {
  //   return this._conversations.find((item) => item.get('derivedGroupV2Id') === groupId)
  // }

  // A number of things outside conversation.attributes affect conversation re-rendering.
  //   If it's scoped to a given conversation, it's easy to trigger('change'). There are
  //   important values in storage and the storage service which change rendering pretty
  //   radically, so this function is necessary to force regeneration of props.
  // async forceRerender(identifiers?: Array<string>): Promise<void> {
  //   let count = 0
  //   const conversations = identifiers
  //     ? identifiers.map((identifier) => this.get(identifier)).filter(isNotNil)
  //     : this._conversations.models.slice()
  //   log.info(`forceRerender: Starting to loop through ${conversations.length} conversations`)

  //   for (let i = 0, max = conversations.length; i < max; i += 1) {
  //     const conversation = conversations[i]

  //     if (conversation.cachedProps) {
  //       conversation.oldCachedProps = conversation.cachedProps
  //       conversation.cachedProps = null

  //       conversation.trigger('props-change', conversation, false)
  //       count += 1
  //     }

  //     if (count % 10 === 0) {
  //       // eslint-disable-next-line no-await-in-loop
  //       await sleep(300)
  //     }
  //   }
  //   log.info(`forceRerender: Updated ${count} conversations`)
  // }

  onConvoOpenStart(conversationId: string): void {
    this._conversationOpenStart.set(conversationId, Date.now())
  }

  onConvoMessageMount(conversationId: string): void {
    const loadStart = this._conversationOpenStart.get(conversationId)
    if (loadStart === undefined) {
      return
    }

    this._conversationOpenStart.delete(conversationId)
    // this.get(conversationId)?.onOpenComplete(loadStart)
  }

  // repairPinnedConversations(): void {
  //   const pinnedIds = window.storage.get('pinnedConversationIds', [])

  //   // eslint-disable-next-line no-restricted-syntax
  //   for (const id of pinnedIds) {
  //     const convo = this.get(id)

  //     if (!convo || convo.get('isPinned')) {
  //       continue
  //     }

  //     log.warn(`ConversationController: Repairing ${convo.idForLogging()}'s isPinned`)
  //     convo.set('isPinned', true)

  //     window.Signal.Data.updateConversation(convo.attributes)
  //   }
  // }

  // For testing
  // async _forgetE164(e164: string): Promise<void> {
  //   const { server } = window.textsecure
  //   strictAssert(server, 'Server must be initialized')
  //   const uuidMap = await getUuidsForE164s(server, [e164])

  //   const pni = uuidMap.get(e164)?.pni

  //   log.info(`ConversationController: forgetting e164=${e164} pni=${pni}`)

  //   const convos = [this.get(e164), this.get(pni)]

  //   for (const convo of convos) {
  //     if (!convo) {
  //       continue
  //     }

  //     // eslint-disable-next-line no-await-in-loop
  //     await removeConversation(convo.id)
  //     this._conversations.remove(convo)
  //     this._conversations.resetLookups()
  //   }
  // }
}
