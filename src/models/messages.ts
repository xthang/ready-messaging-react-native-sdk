// Copyright 2023 Ready.io

import Backbone from 'backbone'
import { mapValues, pick } from 'lodash'
import {
  type AttachmentDBType,
  type MessageDBType,
  MessageModelCollectionType,
  type MessageReactionData,
  MessageType,
} from 'types/chat'
import { logger as log, logger } from 'utils/logger'
import { queueAttachmentDownloads } from 'utils/queue/queueAttachmentDownloads'
import { generateGroupAttachmentId } from '../helpers'
import { conversationJobQueue, conversationQueueJobEnum } from '../jobs/conversationJobQueue'
import { type SendStates, SendStatus, isPending, isSent } from '../messages/MessageSendStatus'
import { SendMessageProtoError } from '../textsecure/Errors'
import { type SentEventData } from '../textsecure/messageReceiverEvents'
import { type SendOptionsType } from '../textsecure/MessageSender'
import type { CallbackResultType, CustomError, ProcessedDataMessage } from '../textsecure/Types.d'
import * as Errors from '../types/errors'
import { handleMessageSend } from '../utils/handleMessageSend'
import { hasAttachmentDownloads } from '../utils/hasAttachmentDownloads'
import { getMessageIdForLogging } from '../utils/idForLogging'
import { saveNewMessageBatcher } from '../utils/messageBatcher'
import { isDirectConversation, isGroup, isMe, isPublicGroup } from '../utils/whatTypeOfConversation'
import type { ConversationModel } from './conversations'

export abstract class MessageModel extends Backbone.Model<MessageDBType> {
  declare attributes: MessageDBType
  declare id: string

  CURRENT_PROTOCOL_VERSION?: number
  INITIAL_PROTOCOL_VERSION?: number

  // Set when sending some sync messages, so we get the functionality of
  //   send(), without zombie messages going into the database.
  doNotSave?: boolean
  // Set when sending stories, so we get the functionality of send() but we are
  //   able to send the sync message elsewhere.
  doNotSendSyncMessage?: boolean

  deletingForEveryone?: boolean

  isSelected?: boolean

  private pendingMarkRead?: number

  syncPromise?: Promise<CallbackResultType | void>

  // cachedOutgoingContactData?: Array<EmbeddedContactWithHydratedAvatar>

  // cachedOutgoingPreviewData?: Array<LinkPreviewWithHydratedData>

  // cachedOutgoingQuoteData?: QuotedMessageType

  // cachedOutgoingStickerData?: StickerWithHydratedData

  constructor(attributes: MessageDBType, private background: boolean) {
    super(attributes)

    // Note that we intentionally don't use `initialize()` method because it
    // isn't compatible with esnext output of esbuild.
    // if (isObject(attributes)) {
    //   this.set(
    //     TypedMessage.initializeSchemaVersion({
    //       message: attributes as MessageDBType,
    //       logger: log,
    //     })
    //   );
    // }

    // const readStatus = migrateLegacyReadStatus(this.attributes);
    // if (readStatus !== undefined) {
    //   this.set(
    //     {
    //       readStatus,
    //       seenStatus:
    //         readStatus === ReadStatus.Unread
    //           ? SeenStatus.Unseen
    //           : SeenStatus.Seen,
    //     },
    //     { silent: true }
    //   );
    // }

    // const ourConversationId =
    //   window.Signal.conversationController.getOurConversationId();
    // if (ourConversationId) {
    //   const sendStateByConversationId = migrateLegacySendAttributes(
    //     this.attributes,
    //     window.Signal.conversationController.get.bind(window.Signal.conversationController),
    //     ourConversationId
    //   );
    //   if (sendStateByConversationId) {
    //     this.set('sendStateByConversationId', sendStateByConversationId, {
    //       silent: true,
    //     });
    //   }
    // }

    // this.CURRENT_PROTOCOL_VERSION = Proto.DataMessage.ProtocolVersion.CURRENT
    // this.INITIAL_PROTOCOL_VERSION = Proto.DataMessage.ProtocolVersion.INITIAL

    this.on('change', this.onChange)
  }

  defaults(): Partial<MessageDBType> {
    return {
      createdAt: new Date().getTime(),
      // attachments: [],
    }
  }

  abstract onChange(): Promise<void>

  getSenderIdentifier(): string {
    const sourceUuid = this.get('sourceUuid')
    const sourceDevice = this.get('sourceDevice')
    const sentAt = this.get('sendAt')

    return `${sourceUuid}.${sourceDevice}-${sentAt}`
  }

  // getReceivedAt(): number {
  //   // We would like to get the received_at_ms ideally since received_at is
  //   // now an incrementing counter for messages and not the actual time that
  //   // the message was received. If this field doesn't exist on the message
  //   // then we can trust received_at.
  //   return Number(this.get('received_at_ms') || this.get('received_at'));
  // }

  // isNormalBubble(): boolean {
  //   const { attributes } = this;

  //   return (
  //     !isCallHistory(attributes) &&
  //     !isChatSessionRefreshed(attributes) &&
  //     !isContactRemovedNotification(attributes) &&
  //     !isConversationMerge(attributes) &&
  //     !isEndSession(attributes) &&
  //     !isExpirationTimerUpdate(attributes) &&
  //     !isGroupUpdate(attributes) &&
  //     !isGroupV1Migration(attributes) &&
  //     !isGroupV2Change(attributes) &&
  //     !isKeyChange(attributes) &&
  //     !isProfileChange(attributes) &&
  //     !isUniversalTimerNotification(attributes) &&
  //     !isUnsupportedMessage(attributes) &&
  //     !isVerifiedChange(attributes)
  //   );
  // }

  // async hydrateStoryContext(
  //   inMemoryMessage?: MessageDBType
  // ): Promise<void> {
  //   const storyId = this.get('storyId');
  //   if (!storyId) {
  //     return;
  //   }

  //   const context = this.get('storyReplyContext');
  //   // We'll continue trying to get the attachment as long as the message still exists
  //   if (context && (context.attachment?.url || !context.messageId)) {
  //     return;
  //   }

  //   const message =
  //     inMemoryMessage === undefined
  //       ? (await getMessageById(storyId))?.attributes
  //       : inMemoryMessage;

  //   if (!message) {
  //     const conversation = this.getConversation();
  //     softAssert(
  //       conversation && isDirectConversation(conversation.attributes),
  //       'hydrateStoryContext: Not a type=direct conversation'
  //     );
  //     this.set({
  //       storyReplyContext: {
  //         attachment: undefined,
  //         // This is ok to do because story replies only show in 1:1 conversations
  //         // so the story that was quoted should be from the same conversation.
  //         authorUuid: conversation?.get('uuid'),
  //         // No messageId, referenced story not found!
  //         messageId: '',
  //       },
  //     });
  //     return;
  //   }

  //   const attachments = getAttachmentsForMessage({ ...message });
  //   let attachment: AttachmentType | undefined = attachments?.[0];
  //   if (attachment && !attachment.url && !attachment.textAttachment) {
  //     attachment = undefined;
  //   }

  //   this.set({
  //     storyReplyContext: {
  //       attachment,
  //       authorUuid: message.sourceUuid,
  //       messageId: message.id,
  //     },
  //   });
  // }

  // Dependencies of prop-generation functions
  getConversation(): ConversationModel | undefined {
    return window.Ready.conversationController.get(this.get('conversationId')!)
  }

  // getNotificationData(): {
  //   emoji?: string;
  //   text: string;
  //   bodyRanges?: ReadonlyArray<RawBodyRange>;
  // } {
  //   // eslint-disable-next-line prefer-destructuring
  //   const attributes: MessageDBType = this.attributes;

  //   if (isDeliveryIssue(attributes)) {
  //     return {
  //       emoji: '⚠️',
  //       text: window.i18n('icu:DeliveryIssue--preview'),
  //     };
  //   }

  //   if (isConversationMerge(attributes)) {
  //     const conversation = this.getConversation();
  //     strictAssert(
  //       conversation,
  //       'getNotificationData/isConversationMerge/conversation'
  //     );
  //     strictAssert(
  //       attributes.conversationMerge,
  //       'getNotificationData/isConversationMerge/conversationMerge'
  //     );

  //     return {
  //       text: getStringForConversationMerge({
  //         obsoleteConversationTitle: getTitleNoDefault(
  //           attributes.conversationMerge.renderInfo
  //         ),
  //         obsoleteConversationNumber: getNumber(
  //           attributes.conversationMerge.renderInfo
  //         ),
  //         conversationTitle: conversation.getTitle(),
  //         i18n: window.i18n,
  //       }),
  //     };
  //   }

  //   if (isChatSessionRefreshed(attributes)) {
  //     return {
  //       emoji: '🔁',
  //       text: window.i18n('icu:ChatRefresh--notification'),
  //     };
  //   }

  //   if (isUnsupportedMessage(attributes)) {
  //     return {
  //       text: window.i18n('icu:message--getDescription--unsupported-message'),
  //     };
  //   }

  //   if (isGroupV1Migration(attributes)) {
  //     return {
  //       text: window.i18n('icu:GroupV1--Migration--was-upgraded'),
  //     };
  //   }

  //   if (isProfileChange(attributes)) {
  //     const change = this.get('profileChange');
  //     const changedId = this.get('changedId');
  //     const changedContact = findAndFormatContact(changedId);
  //     if (!change) {
  //       throw new Error('getNotificationData: profileChange was missing!');
  //     }

  //     return {
  //       text: getStringForProfileChange(change, changedContact, window.i18n),
  //     };
  //   }

  //   if (isGroupV2Change(attributes)) {
  //     const change = this.get('groupV2Change');
  //     strictAssert(
  //       change,
  //       'getNotificationData: isGroupV2Change true, but no groupV2Change!'
  //     );

  //     const changes = GroupChange.renderChange<string>(change, {
  //       i18n: window.i18n,
  //       ourACI: window.textsecure.storage.user
  //         .getCheckedUuid(UUIDKind.ACI)
  //         .toString(),
  //       ourPNI: window.textsecure.storage.user
  //         .getCheckedUuid(UUIDKind.PNI)
  //         .toString(),
  //       renderContact: (conversationId: string) => {
  //         const conversation =
  //           window.Signal.conversationController.get(conversationId);
  //         return conversation
  //           ? conversation.getTitle()
  //           : window.i18n('icu:unknownContact');
  //       },
  //       renderString: (
  //         key: string,
  //         _i18n: unknown,
  //         components: ReplacementValuesType<string | number> | undefined
  //       ) =>
  //         // eslint-disable-next-line local-rules/valid-i18n-keys
  //          window.i18n(key, components)
  //       ,
  //     });

  //     return { text: changes.map(({ text }) => text).join(' ') };
  //   }

  //   if (messageHasPaymentEvent(attributes)) {
  //     const sender = findAndFormatContact(attributes.sourceUuid);
  //     const conversation = findAndFormatContact(attributes.conversationId);
  //     return {
  //       text: getPaymentEventNotificationText(
  //         attributes.payment,
  //         sender.title,
  //         conversation.title,
  //         sender.isMe,
  //         window.i18n
  //       ),
  //       emoji: '💳',
  //     };
  //   }

  //   const attachments = this.get('attachments') || [];

  //   if (isTapToView(attributes)) {
  //     if (this.isErased()) {
  //       return {
  //         text: window.i18n('icu:message--getDescription--disappearing-media'),
  //       };
  //     }

  //     if (Attachment.isImage(attachments)) {
  //       return {
  //         text: window.i18n('icu:message--getDescription--disappearing-photo'),
  //         emoji: '📷',
  //       };
  //     }
  //     if (Attachment.isVideo(attachments)) {
  //       return {
  //         text: window.i18n('icu:message--getDescription--disappearing-video'),
  //         emoji: '🎥',
  //       };
  //     }
  //     // There should be an image or video attachment, but we have a fallback just in
  //     //   case.
  //     return { text: window.i18n('icu:mediaMessage'), emoji: '📎' };
  //   }

  //   if (isGroupUpdate(attributes)) {
  //     const groupUpdate = this.get('group_update');
  //     const fromContact = getContact(this.attributes);
  //     const messages = [];
  //     if (!groupUpdate) {
  //       throw new Error('getNotificationData: Missing group_update');
  //     }

  //     if (groupUpdate.left === 'You') {
  //       return { text: window.i18n('icu:youLeftTheGroup') };
  //     }
  //     if (groupUpdate.left) {
  //       return {
  //         text: window.i18n('icu:leftTheGroup', {
  //           name: this.getNameForNumber(groupUpdate.left),
  //         }),
  //       };
  //     }

  //     if (!fromContact) {
  //       return { text: '' };
  //     }

  //     if (isMe(fromContact.attributes)) {
  //       messages.push(window.i18n('icu:youUpdatedTheGroup'));
  //     } else {
  //       messages.push(
  //         window.i18n('icu:updatedTheGroup', {
  //           name: fromContact.getTitle(),
  //         })
  //       );
  //     }

  //     if (groupUpdate.joined && groupUpdate.joined.length) {
  //       const joinedContacts = groupUpdate.joined.map(item =>
  //         window.Signal.conversationController.getOrCreate(item, 'private')
  //       );
  //       const joinedWithoutMe = joinedContacts.filter(
  //         contact => !isMe(contact.attributes)
  //       );

  //       if (joinedContacts.length > 1) {
  //         messages.push(
  //           window.i18n('icu:multipleJoinedTheGroup', {
  //             names: joinedWithoutMe
  //               .map(contact => contact.getTitle())
  //               .join(', '),
  //           })
  //         );

  //         if (joinedWithoutMe.length < joinedContacts.length) {
  //           messages.push(window.i18n('icu:youJoinedTheGroup'));
  //         }
  //       } else {
  //         const joinedContact = window.Signal.conversationController.getOrCreate(
  //           groupUpdate.joined[0],
  //           'private'
  //         );
  //         if (isMe(joinedContact.attributes)) {
  //           messages.push(window.i18n('icu:youJoinedTheGroup'));
  //         } else {
  //           messages.push(
  //             window.i18n('icu:joinedTheGroup', {
  //               name: joinedContacts[0].getTitle(),
  //             })
  //           );
  //         }
  //       }
  //     }

  //     if (groupUpdate.name) {
  //       messages.push(
  //         window.i18n('icu:titleIsNow', {
  //           name: groupUpdate.name,
  //         })
  //       );
  //     }
  //     if (groupUpdate.avatarUpdated) {
  //       messages.push(window.i18n('icu:updatedGroupAvatar'));
  //     }

  //     return { text: messages.join(' ') };
  //   }
  //   if (isEndSession(attributes)) {
  //     return { text: window.i18n('icu:sessionEnded') };
  //   }
  //   if (isIncoming(attributes) && hasErrors(attributes)) {
  //     return { text: window.i18n('icu:incomingError') };
  //   }

  //   const body = (this.get('body') || '').trim();
  //   const bodyRanges = this.get('bodyRanges') || [];

  //   if (attachments.length) {
  //     // This should never happen but we want to be extra-careful.
  //     const attachment = attachments[0] || {};
  //     const { contentType } = attachment;

  //     if (contentType === MIME.IMAGE_GIF || Attachment.isGIF(attachments)) {
  //       return {
  //         bodyRanges,
  //         emoji: '🎡',
  //         text: body || window.i18n('icu:message--getNotificationText--gif'),
  //       };
  //     }
  //     if (Attachment.isImage(attachments)) {
  //       return {
  //         bodyRanges,
  //         emoji: '📷',
  //         text: body || window.i18n('icu:message--getNotificationText--photo'),
  //       };
  //     }
  //     if (Attachment.isVideo(attachments)) {
  //       return {
  //         bodyRanges,
  //         emoji: '🎥',
  //         text: body || window.i18n('icu:message--getNotificationText--video'),
  //       };
  //     }
  //     if (Attachment.isVoiceMessage(attachment)) {
  //       return {
  //         bodyRanges,
  //         emoji: '🎤',
  //         text:
  //           body ||
  //           window.i18n('icu:message--getNotificationText--voice-message'),
  //       };
  //     }
  //     if (Attachment.isAudio(attachments)) {
  //       return {
  //         bodyRanges,
  //         emoji: '🔈',
  //         text:
  //           body ||
  //           window.i18n('icu:message--getNotificationText--audio-message'),
  //       };
  //     }

  //     return {
  //       bodyRanges,
  //       text: body || window.i18n('icu:message--getNotificationText--file'),
  //       emoji: '📎',
  //     };
  //   }

  //   const stickerData = this.get('sticker');
  //   if (stickerData) {
  //     const emoji =
  //       Stickers.getSticker(stickerData.packId, stickerData.stickerId)?.emoji ||
  //       stickerData?.emoji;

  //     if (!emoji) {
  //       log.warn('Unable to get emoji for sticker');
  //     }
  //     return {
  //       text: window.i18n('icu:message--getNotificationText--stickers'),
  //       emoji: dropNull(emoji),
  //     };
  //   }

  //   if (isCallHistory(attributes)) {
  //     const state = window.reduxStore.getState();
  //     const callingNotification = getPropsForCallHistory(attributes, {
  //       conversationSelector: findAndFormatContact,
  //       callSelector: getCallSelector(state),
  //       activeCall: getActiveCall(state),
  //     });
  //     if (callingNotification) {
  //       return {
  //         text: getCallingNotificationText(callingNotification, window.i18n),
  //       };
  //     }

  //     log.error("This call history message doesn't have valid call history");
  //   }
  //   if (isExpirationTimerUpdate(attributes)) {
  //     // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  //     const { expireTimer } = this.get('expirationTimerUpdate')!;
  //     if (!expireTimer) {
  //       return { text: window.i18n('icu:disappearingMessagesDisabled') };
  //     }

  //     return {
  //       text: window.i18n('icu:timerSetTo', {
  //         time: expirationTimer.format(window.i18n, expireTimer),
  //       }),
  //     };
  //   }

  //   if (isKeyChange(attributes)) {
  //     const identifier = this.get('key_changed');
  //     const conversation = window.Signal.conversationController.get(identifier);
  //     return {
  //       text: window.i18n('icu:safetyNumberChangedGroup', {
  //         name: conversation ? conversation.getTitle() : '',
  //       }),
  //     };
  //   }
  //   const contacts = this.get('contact');
  //   if (contacts && contacts.length) {
  //     return {
  //       text:
  //         EmbeddedContact.getName(contacts[0]) ||
  //         window.i18n('icu:unknownContact'),
  //       emoji: '👤',
  //     };
  //   }

  //   const giftBadge = this.get('giftBadge');
  //   if (giftBadge) {
  //     const emoji = '✨';
  //     const fromContact = getContact(this.attributes);

  //     if (isOutgoing(this.attributes)) {
  //       const recipient =
  //         fromContact?.getTitle() ?? window.i18n('icu:unknownContact');
  //       return {
  //         emoji,
  //         text: window.i18n('icu:message--donation--preview--sent', {
  //           recipient,
  //         }),
  //       };
  //     }

  //     const sender =
  //       fromContact?.getTitle() ?? window.i18n('icu:unknownContact');
  //     return {
  //       emoji,
  //       text:
  //         giftBadge.state === GiftBadgeStates.Unopened
  //           ? window.i18n('icu:message--donation--preview--unopened', {
  //               sender,
  //             })
  //           : window.i18n('icu:message--donation--preview--redeemed'),
  //     };
  //   }

  //   if (body) {
  //     return {
  //       text: body,
  //       bodyRanges,
  //     };
  //   }

  //   return { text: '' };
  // }

  // getAuthorText(): string | undefined {
  //   // if it's outgoing, it must be self-authored
  //   const selfAuthor = isOutgoing(this.attributes)
  //     ? window.i18n('icu:you')
  //     : undefined;

  //   // if it's not selfAuthor and there's no incoming contact,
  //   // it might be a group notification, so we return undefined
  //   return selfAuthor ?? this.getIncomingContact()?.getTitle({ isShort: true });
  // }

  // getNotificationText(): string {
  //   const { text, emoji } = this.getNotificationData();
  //   const { attributes } = this;

  //   const conversation = this.getConversation();

  //   strictAssert(
  //     conversation != null,
  //     'Conversation not found in ConversationController'
  //   );

  //   if (!isConversationAccepted(conversation.attributes)) {
  //     return window.i18n('icu:message--getNotificationText--messageRequest');
  //   }

  //   if (attributes.storyReaction) {
  //     if (attributes.type === 'outgoing') {
  //       const name = this.getConversation()?.get('profileName');

  //       if (!name) {
  //         return window.i18n(
  //           'icu:Quote__story-reaction-notification--outgoing--nameless',
  //           {
  //             emoji: attributes.storyReaction.emoji,
  //           }
  //         );
  //       }

  //       return window.i18n('icu:Quote__story-reaction-notification--outgoing', {
  //         emoji: attributes.storyReaction.emoji,
  //         name,
  //       });
  //     }

  //     const ourUuid = window.textsecure.storage.user
  //       .getCheckedUuid()
  //       .toString();

  //     if (
  //       attributes.type === 'incoming' &&
  //       attributes.storyReaction.targetAuthorUuid === ourUuid
  //     ) {
  //       return window.i18n('icu:Quote__story-reaction-notification--incoming', {
  //         emoji: attributes.storyReaction.emoji,
  //       });
  //     }

  //     if (!window.Signal.OS.isLinux()) {
  //       return attributes.storyReaction.emoji;
  //     }

  //     return window.i18n('icu:Quote__story-reaction--single');
  //   }

  //   const mentions =
  //     extractHydratedMentions(attributes, {
  //       conversationSelector: findAndFormatContact,
  //     }) || [];
  //   const spoilers = (attributes.bodyRanges || []).filter(
  //     range =>
  //       BodyRange.isFormatting(range) && range.style === BodyRange.Style.SPOILER
  //   ) as Array<BodyRange<BodyRange.Formatting>>;
  //   const modifiedText = applyRangesForText({ text, mentions, spoilers });

  //   // Linux emoji support is mixed, so we disable it. (Note that this doesn't touch
  //   //   the `text`, which can contain emoji.)
  //   const shouldIncludeEmoji = Boolean(emoji) && !window.Signal.OS.isLinux();
  //   if (shouldIncludeEmoji) {
  //     return window.i18n('icu:message--getNotificationText--text-with-emoji', {
  //       text: modifiedText,
  //       emoji,
  //     });
  //   }

  //   return modifiedText || '';
  // }

  // General
  idForLogging(): string {
    return getMessageIdForLogging(this.attributes)
  }

  validate(attributes: Record<string, unknown>): void {
    const required = ['conversationId', 'receivedAt', 'sentAt']
    const missing = required.filter((attr) => !attributes[attr])
    if (missing.length) {
      log.warn(`Message missing attributes: ${missing}`)
    }
  }

  // merge(model: MessageModel): void {
  //   const attributes = model.attributes || model;
  //   this.set(attributes);
  // }

  // getNameForNumber(number: string): string {
  //   const conversation = window.Signal.conversationController.get(number);
  //   if (!conversation) {
  //     return number;
  //   }
  //   return conversation.getTitle();
  // }

  // async cleanup(): Promise<void> {
  //   await cleanupMessage(this.attributes);
  // }

  // async deleteData(): Promise<void> {
  //   await deleteMessageData(this.attributes);
  // }

  // isValidTapToView(): boolean {
  //   const body = this.get('body');
  //   if (body) {
  //     return false;
  //   }

  //   const attachments = this.get('attachments');
  //   if (!attachments || attachments.length !== 1) {
  //     return false;
  //   }

  //   const firstAttachment = attachments[0];
  //   if (
  //     !GoogleChrome.isImageTypeSupported(firstAttachment.contentType) &&
  //     !GoogleChrome.isVideoTypeSupported(firstAttachment.contentType)
  //   ) {
  //     return false;
  //   }

  //   const quote = this.get('quote');
  //   const sticker = this.get('sticker');
  //   const contact = this.get('contact');
  //   const preview = this.get('preview');

  //   if (
  //     quote ||
  //     sticker ||
  //     (contact && contact.length > 0) ||
  //     (preview && preview.length > 0)
  //   ) {
  //     return false;
  //   }

  //   return true;
  // }

  // async markViewOnceMessageViewed(options?: {
  //   fromSync?: boolean;
  // }): Promise<void> {
  //   const { fromSync } = options || {};

  //   if (!this.isValidTapToView()) {
  //     log.warn(
  //       `markViewOnceMessageViewed: Message ${this.idForLogging()} is not a valid tap to view message!`
  //     );
  //     return;
  //   }
  //   if (this.isErased()) {
  //     log.warn(
  //       `markViewOnceMessageViewed: Message ${this.idForLogging()} is already erased!`
  //     );
  //     return;
  //   }

  //   if (this.get('readStatus') !== ReadStatus.Viewed) {
  //     this.set(markViewed(this.attributes));
  //   }

  //   await this.eraseContents();

  //   if (!fromSync) {
  //     const senderE164 = getSource(this.attributes);
  //     const senderUuid = getSourceUuid(this.attributes);
  //     const timestamp = this.get('sent_at');

  //     if (senderUuid === undefined) {
  //       throw new Error('markViewOnceMessageViewed: senderUuid is undefined');
  //     }

  //     if (window.Signal.conversationController.areWePrimaryDevice()) {
  //       log.warn(
  //         'markViewOnceMessageViewed: We are primary device; not sending view once open sync'
  //       );
  //       return;
  //     }

  //     try {
  //       await viewOnceOpenJobQueue.add({
  //         viewOnceOpens: [
  //           {
  //             senderE164,
  //             senderUuid,
  //             timestamp,
  //           },
  //         ],
  //       });
  //     } catch (error) {
  //       log.error(
  //         'markViewOnceMessageViewed: Failed to queue view once open sync',
  //         Errors.toLogFormat(error)
  //       );
  //     }
  //   }
  // }

  // async doubleCheckMissingQuoteReference(): Promise<void> {
  //   const logId = this.idForLogging();

  //   const storyId = this.get('storyId');
  //   if (storyId) {
  //     log.warn(
  //       `doubleCheckMissingQuoteReference/${logId}: missing story reference`
  //     );

  //     const message = window.Signal.messageController.getById(storyId);
  //     if (!message) {
  //       return;
  //     }

  //     if (this.get('storyReplyContext')) {
  //       this.unset('storyReplyContext');
  //     }
  //     await this.hydrateStoryContext(message.attributes);
  //     return;
  //   }

  //   const quote = this.get('quote');
  //   if (!quote) {
  //     log.warn(`doubleCheckMissingQuoteReference/${logId}: Missing quote!`);
  //     return;
  //   }

  //   const { authorUuid, author, id: sentAt, referencedMessageNotFound } = quote;
  //   const contact = window.Signal.conversationController.get(authorUuid || author);

  //   // Is the quote really without a reference? Check with our in memory store
  //   // first to make sure it's not there.
  //   if (referencedMessageNotFound && contact) {
  //     log.info(
  //       `doubleCheckMissingQuoteReference/${logId}: Verifying reference to ${sentAt}`
  //     );
  //     const inMemoryMessages = window.Signal.messageController.filterBySentAt(
  //       Number(sentAt)
  //     );
  //     let matchingMessage = find(inMemoryMessages, message =>
  //       isQuoteAMatch(message.attributes, this.get('conversationId'), quote)
  //     );
  //     if (!matchingMessage) {
  //       const messages = await window.Signal.Data.getMessagesBySentAt(
  //         Number(sentAt)
  //       );
  //       const found = messages.find(item =>
  //         isQuoteAMatch(item, this.get('conversationId'), quote)
  //       );
  //       if (found) {
  //         matchingMessage = window.Signal.messageController.register(found.id, found);
  //       }
  //     }

  //     if (!matchingMessage) {
  //       log.info(
  //         `doubleCheckMissingQuoteReference/${logId}: No match for ${sentAt}.`
  //       );
  //       return;
  //     }

  //     this.set({
  //       quote: {
  //         ...quote,
  //         referencedMessageNotFound: false,
  //       },
  //     });

  //     log.info(
  //       `doubleCheckMissingQuoteReference/${logId}: Found match for ${sentAt}, updating.`
  //     );

  //     await this.copyQuoteContentFromOriginal(matchingMessage, quote);
  //     this.set({
  //       quote: {
  //         ...quote,
  //         referencedMessageNotFound: false,
  //       },
  //     });
  //     queueUpdateMessage(this.attributes);
  //   }
  // }

  // isErased(): boolean {
  //   return Boolean(this.get('isErased'))
  // }

  // async eraseContents(
  //   additionalProperties = {},
  //   shouldPersist = true
  // ): Promise<void> {
  //   log.info(`Erasing data for message ${this.idForLogging()}`);

  //   // Note: There are cases where we want to re-erase a given message. For example, when
  //   //   a viewed (or outgoing) View-Once message is deleted for everyone.

  //   try {
  //     await this.deleteData();
  //   } catch (error) {
  //     log.error(
  //       `Error erasing data for message ${this.idForLogging()}:`,
  //       Errors.toLogFormat(error)
  //     );
  //   }

  //   this.set({
  //     attachments: [],
  //     body: '',
  //     bodyRanges: undefined,
  //     contact: [],
  //     editHistory: undefined,
  //     isErased: true,
  //     preview: [],
  //     quote: undefined,
  //     sticker: undefined,
  //     ...additionalProperties,
  //   });
  //   this.getConversation()?.debouncedUpdateLastMessage?.();

  //   if (shouldPersist) {
  //     await window.Signal.Data.saveMessage(this.attributes, {
  //       ourUuid: window.textsecure.storage.user.getCheckedUuid().toString(),
  //     });
  //   }

  //   await window.Signal.Data.deleteSentProtoByMessageId(this.id);

  //   scheduleOptimizeFTS();
  // }

  // isEmpty(): boolean {
  //   const { attributes } = this;

  //   // Core message types - we check for all four because they can each stand alone
  //   const hasBody = Boolean(this.get('body'));
  //   const hasAttachment = (this.get('attachments') || []).length > 0;
  //   const hasEmbeddedContact = (this.get('contact') || []).length > 0;
  //   const isSticker = Boolean(this.get('sticker'));

  //   // Rendered sync messages
  //   const isCallHistoryValue = isCallHistory(attributes);
  //   const isChatSessionRefreshedValue = isChatSessionRefreshed(attributes);
  //   const isDeliveryIssueValue = isDeliveryIssue(attributes);
  //   const isGiftBadgeValue = isGiftBadge(attributes);
  //   const isGroupUpdateValue = isGroupUpdate(attributes);
  //   const isGroupV2ChangeValue = isGroupV2Change(attributes);
  //   const isEndSessionValue = isEndSession(attributes);
  //   const isExpirationTimerUpdateValue = isExpirationTimerUpdate(attributes);
  //   const isVerifiedChangeValue = isVerifiedChange(attributes);

  //   // Placeholder messages
  //   const isUnsupportedMessageValue = isUnsupportedMessage(attributes);
  //   const isTapToViewValue = isTapToView(attributes);

  //   // Errors
  //   const hasErrorsValue = hasErrors(attributes);

  //   // Locally-generated notifications
  //   const isKeyChangeValue = isKeyChange(attributes);
  //   const isProfileChangeValue = isProfileChange(attributes);
  //   const isUniversalTimerNotificationValue =
  //     isUniversalTimerNotification(attributes);
  //   const isConversationMergeValue = isConversationMerge(attributes);

  //   const isPayment = messageHasPaymentEvent(attributes);

  //   // Note: not all of these message types go through message.handleDataMessage

  //   const hasSomethingToDisplay =
  //     // Core message types
  //     hasBody ||
  //     hasAttachment ||
  //     hasEmbeddedContact ||
  //     isSticker ||
  //     isPayment ||
  //     // Rendered sync messages
  //     isCallHistoryValue ||
  //     isChatSessionRefreshedValue ||
  //     isDeliveryIssueValue ||
  //     isGiftBadgeValue ||
  //     isGroupUpdateValue ||
  //     isGroupV2ChangeValue ||
  //     isEndSessionValue ||
  //     isExpirationTimerUpdateValue ||
  //     isVerifiedChangeValue ||
  //     // Placeholder messages
  //     isUnsupportedMessageValue ||
  //     isTapToViewValue ||
  //     // Errors
  //     hasErrorsValue ||
  //     // Locally-generated notifications
  //     isKeyChangeValue ||
  //     isProfileChangeValue ||
  //     isUniversalTimerNotificationValue ||
  //     isConversationMergeValue;

  //   return !hasSomethingToDisplay;
  // }

  // isUnidentifiedDelivery(
  //   contactId: string,
  //   unidentifiedDeliveriesSet: Readonly<Set<string>>
  // ): boolean {
  //   if (isIncoming(this.attributes)) {
  //     return Boolean(this.get('unidentifiedDeliveryReceived'));
  //   }

  //   return unidentifiedDeliveriesSet.has(contactId);
  // }

  async saveErrors(providedErrors: Error | Array<Error>, options: { skipSave?: boolean } = {}): Promise<void> {
    const { skipSave } = options

    let errors: Array<CustomError>

    if (!(providedErrors instanceof Array)) {
      errors = [providedErrors]
    } else {
      errors = providedErrors
    }

    errors.forEach((e) => {
      log.error('Message.saveErrors:', Errors.toLogFormat(e))
    })
    errors = errors.map((e) => {
      // Note: in our environment, instanceof can be scary, so we have a backup check
      //   (Node.js vs Browser context).
      // We check instanceof second because typescript believes that anything that comes
      //   through here must be an instance of Error, so e is 'never' after that check.
      if ((e.message && e.stack) || e instanceof Error) {
        return pick(
          e,
          'name',
          'message',
          'code',
          'number',
          'identifier',
          'retryAfter',
          'data',
          'reason'
        ) as Required<Error>
      }
      return e
    })
    errors = errors.concat(this.get('errors') || [])

    this.set({ errors })

    if (!skipSave && !this.doNotSave && !isPublicGroup(this.getConversation()!.attributes)) {
      await window.Ready.Data.updateMessage(this.id, this.attributes)
    }
  }

  // markRead(readAt?: number, options = {}): void {
  //   this.set(markRead(this.attributes, readAt, options));
  // }

  // getIncomingContact(): ConversationModel | undefined | null {
  //   if (!isIncoming(this.attributes)) {
  //     return null;
  //   }
  //   const sourceUuid = this.get('sourceUuid');
  //   if (!sourceUuid) {
  //     return null;
  //   }

  //   return window.Signal.conversationController.getOrCreate(sourceUuid, 'private');
  // }

  async retrySend(): Promise<void> {
    logger.log('--  MessageModel.retrySend ...')

    const conversation = this.getConversation()!

    const currentConversationRecipients = conversation.getMemberConversationIds()

    // Determine retry recipients and get their most up-to-date addressing information
    const oldSendStateByConversationId = this.get('sendStates') || {}

    const newSendStateByConversationId = { ...oldSendStateByConversationId }
    Object.entries(oldSendStateByConversationId).forEach(([conversationId, sendState]) => {
      if (isSent(sendState.status)) {
        return
      }

      const recipient = window.Ready.conversationController.get(conversationId)
      if (!recipient || (!currentConversationRecipients.has(conversationId) && !isMe(recipient.attributes))) {
        return
      }

      newSendStateByConversationId[conversationId] = {
        status: SendStatus.Pending,
        updatedAt: Date.now(),
      }
    })

    this.set('sendStates', newSendStateByConversationId)

    await conversationJobQueue.add(
      {
        type: conversationQueueJobEnum.enum.NormalMessage,
        conversationId: conversation.id,
        messageId: this.id,
        // revision: conversation.get('revision'),
      },
      async (jobToInsert) => {
        await window.Ready.Data.updateMessage(this.id, this.attributes)
        await window.Ready.Data.insertJob(jobToInsert)
      }
    )
  }

  isReplayableError(e: Error): boolean {
    return (
      e.name === 'MessageError' ||
      e.name === 'OutgoingMessageError' ||
      e.name === 'SendMessageNetworkError' ||
      e.name === 'SendMessageChallengeError' ||
      e.name === 'SignedPreKeyRotationError' ||
      e.name === 'OutgoingIdentityKeyError'
    )
  }

  // public hasSuccessfulDelivery(): boolean {
  //   const sendStateByConversationId = this.get('sendStateByConversationId');
  //   const withoutMe = omit(
  //     sendStateByConversationId,
  //     window.Signal.conversationController.getOurConversationIdOrThrow()
  //   );
  //   return isEmpty(withoutMe) || someSendStatus(withoutMe, isSent);
  // }

  // /**
  //  * Change any Pending send state to Failed. Note that this will not mark successful
  //  * sends failed.
  //  */
  public markFailed(): void {
    logger.log('--  Message.markFailed:', this.id)

    const now = Date.now()
    this.set(
      'sendStates',
      mapValues(this.get('sendStates') || {}, (oldStatus) => {
        let newStatus = oldStatus.status
        if (oldStatus.status === SendStatus.Pending) newStatus = SendStatus.Failed
        return newStatus === oldStatus.status
          ? oldStatus
          : {
              ...oldStatus,
              status: newStatus,
              updatedAt: now,
            }
      })
    )

    // this.notifyStorySendFailed()
  }

  // public notifyStorySendFailed(): void {
  //   if (!isStory(this.attributes)) {
  //     return;
  //   }

  //   notificationService.add({
  //     conversationId: this.get('conversationId'),
  //     storyId: this.id,
  //     messageId: this.id,
  //     senderTitle:
  //       this.getConversation()?.getTitle() ?? window.i18n('icu:Stories__mine'),
  //     message: this.hasSuccessfulDelivery()
  //       ? window.i18n('icu:Stories__failed-send--partial')
  //       : window.i18n('icu:Stories__failed-send--full'),
  //     isExpiringMessage: false,
  //   });
  // }

  // removeOutgoingErrors(incomingIdentifier: string): CustomError {
  //   const incomingConversationId =
  //     window.Signal.conversationController.getConversationId(incomingIdentifier);
  //   const errors = partition(
  //     this.get('errors'),
  //     e =>
  //       window.Signal.conversationController.getConversationId(
  //         // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  //         e.identifier || e.number!
  //       ) === incomingConversationId &&
  //       (e.name === 'MessageError' ||
  //         e.name === 'OutgoingMessageError' ||
  //         e.name === 'SendMessageNetworkError' ||
  //         e.name === 'SendMessageChallengeError' ||
  //         e.name === 'SignedPreKeyRotationError' ||
  //         e.name === 'OutgoingIdentityKeyError')
  //   );
  //   this.set({ errors: errors[1] });
  //   return errors[0][0];
  // }

  async send(
    promise: Promise<CallbackResultType | void | null>,
    saveErrors?: (errors: Array<Error>) => void
  ): Promise<void> {
    const conversation = this.getConversation()!
    const updateLeftPane = conversation?.debouncedUpdateLastMessage

    updateLeftPane?.('MM.send1')

    const isPublic = isPublicGroup(conversation.attributes)

    let result:
      | { success: true; value: CallbackResultType }
      | {
          success: false
          value: CustomError | SendMessageProtoError
        }
    try {
      const value = await (promise as Promise<CallbackResultType>)
      result = { success: true, value }
    } catch (err: any) {
      result = { success: false, value: err }
    }

    updateLeftPane?.('MM.send2')

    const attributesToUpdate: Partial<MessageDBType> = {}

    // This is used by sendSyncMessage, then set to null
    if ('dataMessage' in result.value && result.value.dataMessage) {
      attributesToUpdate.dataMessage = result.value.dataMessage
    } else if ('editMessage' in result.value && result.value.editMessage) {
      attributesToUpdate.dataMessage = result.value.editMessage
    }
    if ('guid' in result.value && result.value.guid) {
      attributesToUpdate.guid = result.value.guid
    }
    if ('message_id' in result.value && result.value.message_id) {
      // This is PUBLIC group
      attributesToUpdate.id = result.value.message_id.toString()
    }

    if (!this.doNotSave && !isPublic) {
      await window.Ready.Data.updateMessage(this.id, this.attributes)
    }

    const sendStateByConversationId = { ...(this.get('sendStates') || {}) }

    const sendIsNotFinal = 'sendIsNotFinal' in result.value && result.value.sendIsNotFinal
    const sendIsFinal = !sendIsNotFinal

    // Capture successful sends
    const successfulIdentifiers: Array<string> =
      sendIsFinal && 'successfulIdentifiers' in result.value && Array.isArray(result.value.successfulIdentifiers)
        ? result.value.successfulIdentifiers
        : []
    const sentToAtLeastOneRecipient = result.success || Boolean(successfulIdentifiers.length)

    successfulIdentifiers.forEach((identifier) => {
      const recipientConversation = window.Ready.conversationController.getByIdentifier(
        conversation.get('accountId')!,
        identifier
      )
      if (!recipientConversation) {
        return
      }

      // If we successfully sent to a user, we can remove our unregistered flag.
      // if (recipientConversation.isEverUnregistered()) {
      //   recipientConversation.setRegistered()
      // }

      const previousSendState = sendStateByConversationId[recipientConversation.id]
      if (previousSendState) {
        sendStateByConversationId[recipientConversation.id] = {
          status: SendStatus.Sent,
          updatedAt: Date.now(),
        }
      }
    })

    // Integrate sends via sealed sender
    // const previousUnidentifiedDeliveries = this.get('unidentifiedDeliveries') || []
    // const newUnidentifiedDeliveries =
    //   sendIsFinal &&
    //   'unidentifiedDeliveries' in result.value &&
    //   Array.isArray(result.value.unidentifiedDeliveries)
    //     ? result.value.unidentifiedDeliveries
    //     : []

    const promises: Array<Promise<unknown>> = []

    // Process errors
    let errors: Array<CustomError>
    if (result.value instanceof SendMessageProtoError && result.value.errors) {
      ;({ errors } = result.value)
    } else if (result.value instanceof Error) {
      errors = [result.value]
    } else if (Array.isArray(result.value.errors)) {
      ;({ errors } = result.value)
    } else {
      errors = []
    }

    // In groups, we don't treat unregistered users as a user-visible
    //   error. The message will look successful, but the details
    //   screen will show that we didn't send to these unregistered users.
    const errorsToSave: Array<CustomError> = []

    let hadSignedPreKeyRotationError = false
    errors.forEach((error) => {
      const conversation_ =
        window.Ready.conversationController.get(error.identifier!) ||
        window.Ready.conversationController.get(error.number!)

      if (conversation_ && !saveErrors && sendIsFinal) {
        const previousSendState = sendStateByConversationId[conversation_.id]
        if (previousSendState) {
          sendStateByConversationId[conversation_.id] = {
            status: SendStatus.Failed,
            updatedAt: Date.now(),
          }
          // this.notifyStorySendFailed()
        }
      }

      let shouldSaveError = true
      switch (error.name) {
        case 'SignedPreKeyRotationError':
          hadSignedPreKeyRotationError = true
          break
        case 'OutgoingIdentityKeyError': {
          if (conversation) {
            promises.push(conversation.getMembersProfiles('MessageModel.send'))
          }
          break
        }
        case 'UnregisteredUserError':
          if (conversation && isGroup(conversation.attributes)) {
            shouldSaveError = false
          }
          // If we just found out that we couldn't send to a user because they are no
          //   longer registered, we will update our unregistered flag. In groups we
          //   will not event try to send to them for 6 hours. And we will never try
          //   to fetch them on startup again.
          //
          // The way to discover registration once more is:
          //   1) any attempt to send to them in 1:1 conversation
          //   2) the six-hour time period has passed and we send in a group again
          // conversation?.setUnregistered()
          break
        default:
          break
      }

      if (shouldSaveError) {
        errorsToSave.push(error)
      }
    })

    // if (hadSignedPreKeyRotationError) {
    //   promises.push(window.getAccountManager().rotateSignedPreKey(UUIDKind.ACI))
    // }

    attributesToUpdate.sendStates = sendStateByConversationId
    attributesToUpdate.isSent = Object.values(sendStateByConversationId).some((sendState) =>
      isPending(sendState.status)
    )
      ? undefined
      : Object.values(sendStateByConversationId).every((sendState) => isSent(sendState.status))
    // Only update the expirationStartTimestamp if we don't already have one set
    // if (!this.get('expirationStartTimestamp')) {
    //   attributesToUpdate.expirationStartTimestamp = sentToAtLeastOneRecipient
    //     ? Date.now()
    //     : undefined
    // }
    // attributesToUpdate.unidentifiedDeliveries = union(
    //   previousUnidentifiedDeliveries,
    //   newUnidentifiedDeliveries
    // )
    // We may overwrite this in the `saveErrors` call below.
    // attributesToUpdate.errors = []

    if (attributesToUpdate.id) {
      // update attachments to new message ID
      attributesToUpdate.attachments = this.get('attachments')?.map((it, id) => ({
        ...it,
        messageId: attributesToUpdate.id,
        id: generateGroupAttachmentId(this.get('conversationId')!, attributesToUpdate.id!, id),
      }))
    }

    const oldId = this.id
    if (attributesToUpdate.id) {
      // update mobx message to new ID
      window.Ready.messageController.register(attributesToUpdate.id, this)
      setTimeout(() => window.Ready.messageController.unregister(oldId), 500) // remove from controller after a period or else setup.ts will throw Error when still getting lastMessage with the old temp_message_xxx id

      await this.onChangeId(oldId, attributesToUpdate.id)
      // window.rootStore.userStore.selectedAccount.conversations
      //   .find((it) => it.id === conversation.id)
      //   .reloadMessageById({
      //     id: oldId,
      //     realId: attributesToUpdate.id,
      //     guid: attributesToUpdate.guid,
      //     isSent: true,
      //   })
    }

    // set this after updating id to the new id
    this.set(attributesToUpdate)

    if (saveErrors) {
      saveErrors(errorsToSave)
    } else {
      // We skip save because we'll save in the next step.
      void this.saveErrors(errorsToSave, { skipSave: true })
    }

    if (!this.doNotSave && !isPublic) {
      await window.Ready.Data.updateMessage(this.id, this.attributes)
    }

    updateLeftPane?.('MM.send3')

    if (!this.doNotSendSyncMessage && !isPublic) {
      // sentToAtLeastOneRecipient &&
      promises.push(this.sendSyncMessage())
    }

    await Promise.all(promises)

    const isTotalSuccess: boolean = result.success && !this.get('errors')?.length
    if (isTotalSuccess) {
      // delete this.cachedOutgoingContactData
      // delete this.cachedOutgoingPreviewData
      // delete this.cachedOutgoingQuoteData
      // delete this.cachedOutgoingStickerData
    }

    updateLeftPane?.('MM.send4')
  }

  abstract onChangeId(oldValue: string, newValue: string): Promise<void>

  async sendSyncMessageOnly(saveErrors?: (errors: Array<Error>) => void): Promise<CallbackResultType | void> {
    const conv = this.getConversation()!

    const updateLeftPane = conv?.debouncedUpdateLastMessage

    try {
      this.set({
        // This is the same as a normal send()
        // expirationStartTimestamp: Date.now(),
        errors: [],
      })
      const result = await this.sendSyncMessage()
      // this.set({
      //   // We have to do this afterward, since we didn't have a previous send!
      //   unidentifiedDeliveries: result && result.unidentifiedDeliveries,
      // })
      return result
    } catch (error: any) {
      const resultErrors = error?.errors
      const errors = Array.isArray(resultErrors) ? resultErrors : [new Error('Unknown error')]
      if (saveErrors) {
        saveErrors(errors)
      } else {
        // We don't save because we're about to save below.
        void this.saveErrors(errors, { skipSave: true })
      }
      throw error
    } finally {
      if (!isPublicGroup(conv.attributes)) await window.Ready.Data.updateMessage(this.id, this.attributes)

      updateLeftPane?.('MsgModel.sendSyncMessageOnly')
    }
  }

  async sendSyncMessage(): Promise<CallbackResultType | void> {
    const ourAccount = window.utils.getCurrentAccount()
    const ourConversation = await window.Ready.conversationController.getOurConversationOrThrow(ourAccount)
    const sendOptions: SendOptionsType = { online: false } // await getSendOptions(ourConversation.attributes, {
    //   syncMessage: true,
    // })
    const { messageSender } = window.Ready
    if (!messageSender) {
      throw new Error('sendSyncMessage: messaging not available!')
    }
    this.syncPromise = this.syncPromise || Promise.resolve()
    const next = async () => {
      const dataMessage = this.get('dataMessage')
      if (!dataMessage) {
        log.warn('!-  MessageModel.sendSyncMessage: dataMessage not found')
        return
      }

      // const isUpdate = Boolean(this.get('synced'))

      const conv = this.getConversation()!
      const sendEntries = Object.entries(this.get('sendStates') || {})
      const sentEntries = sendEntries.filter(([_, { status }]) => isSent(status))
      const allConversationIdsSentTo = sentEntries.map(([conversationId]) => conversationId)
      const conversationIdsSentTo = allConversationIdsSentTo.filter(
        (conversationId) => conversationId !== ourConversation.id
      )
      // const unidentifiedDeliveries = this.get('unidentifiedDeliveries') || []
      // const maybeConversationsWithSealedSender = unidentifiedDeliveries.map((identifier) =>
      //   window.Signal.conversationController.get(identifier)
      // )
      // const conversationsWithSealedSender = maybeConversationsWithSealedSender.filter((it) => it)
      // const conversationIdsWithSealedSender = new Set(
      //   conversationsWithSealedSender.map((c) => c.id)
      // )
      const isEditedMessage = false // Boolean(this.get('editHistory'))
      const timestamp = this.get('createdAt')
      const encodedContent = isEditedMessage ? { editMessage: dataMessage } : { dataMessage }
      return handleMessageSend(
        messageSender.sendSyncMessage({
          ...encodedContent,

          ourAccountId: conv.get('accountId')!,
          ourAddress: ourAccount.address,
          destination: conv.get('identifier')!,
          // destinationUuid: undefined,

          guid: this.get('guid')!,

          // expirationStartTimestamp: this.get('expirationStartTimestamp') || null,
          conversationIdsSentTo,
          // conversationIdsWithSealedSender,

          timestamp,
          // isUpdate,
          options: sendOptions,
          // urgent: false,
        }),
        // Note: in some situations, for doNotSave messages, the message has no
        //   id, so we provide an empty array here.
        { messageIds: this.id ? [this.id] : [], sendType: 'sentSync' }
      ).then(async (result) => {
        let newSendStateByConversationId: undefined | SendStates
        const sendStateByConversationId = this.get('sendStates') || {}
        const ourOldSendState = sendStateByConversationId[ourConversation.id]
        if (ourOldSendState) {
          const ourNewSendState = {
            status: SendStatus.Sent,
            updatedAt: Date.now(),
          }
          if (ourNewSendState !== ourOldSendState) {
            newSendStateByConversationId = {
              ...sendStateByConversationId,
              [ourConversation.id]: ourNewSendState,
            }
          }
        }
        this.set({
          // synced: true,
          dataMessage: undefined,
          ...(newSendStateByConversationId
            ? {
                sendStates: newSendStateByConversationId,
                isSent: Object.values(newSendStateByConversationId).every((sendState) => isSent(sendState.status)),
              }
            : {}),
        })
        // Return early, skip the save
        if (this.doNotSave) {
          return result
        }
        if (!isPublicGroup(conv.attributes)) await window.Ready.Data.updateMessage(this.id, this.attributes)
        return result
      })
    }
    this.syncPromise = this.syncPromise.then(next, next)
    return this.syncPromise
  }

  async sendReaction(reaction: MessageReactionData): Promise<void> {
    if (this.get('deletedForEveryoneSendStatus')) {
      log.log('--  Message.handleReaction: message is being deleted')
      return
    }

    // We allow you to react to messages with outgoing errors only if it has sent
    //   successfully to at least one person.
    // if (
    //   hasErrors(attributes) &&
    //   (isIncoming(attributes) ||
    //     getMessagePropStatus(
    //       attributes,
    //       window.Signal.conversationController.getOurConversationIdOrThrow()
    //     ) !== 'partial-sent')
    // ) {
    //   return
    // }

    const conversation = this.getConversation()
    if (!conversation) {
      return
    }

    const isPublic = isPublicGroup(conversation.attributes)

    // const isFromThisDevice = reaction.get('source') === ReactionSource.FromThisDevice
    // const isFromSync = reaction.get('source') === ReactionSource.FromSync
    // const isFromSomeoneElse = reaction.get('source') === ReactionSource.FromSomeoneElse
    // strictAssert(
    //   isFromThisDevice || isFromSync || isFromSomeoneElse,
    //   'Reaction can only be from this device, from sync, or from someone else'
    // )

    let recipientConversationIds: string[]
    if (isPublic) {
      recipientConversationIds = [conversation.id]
    } else {
      const ourAccount = window.utils.getCurrentAccount()
      const ourConversation = await window.Ready.conversationController.getOurConversationOrThrow(ourAccount)
      recipientConversationIds = Array.from(conversation.getMemberConversationIds()).concat([ourConversation.id])
    }

    const sendStates = recipientConversationIds.reduce<Record<string, boolean | undefined>>((out, it) => {
      out[it] = undefined
      return out
    }, {})

    let reactionType: 'add' | 'replace' | 'remove'
    const oldReactions = this.get('reactions') // this is frozen by react
    const myExistingReactionId = oldReactions?.findIndex((r) => r.address === reaction.address)
    const myExistingReaction =
      myExistingReactionId != null && myExistingReactionId >= 0 ? oldReactions![myExistingReactionId] : null
    let newReactions: MessageReactionData[] | null
    if (myExistingReaction) {
      if (myExistingReaction.reaction === reaction.reaction) {
        reactionType = myExistingReaction.removed ? 'add' : 'remove'
        // newReactions = oldReactions.filter((r) => r.address !== reaction.address)
        newReactions = [...oldReactions!]
        newReactions[myExistingReactionId!] = {
          ...myExistingReaction, // the current object is frozen so we need to clone it
          removed: !myExistingReaction.removed,
          sendStates,
        }
      } else {
        reactionType = myExistingReaction.removed ? 'add' : 'replace'
        newReactions = [...oldReactions!]
        newReactions[myExistingReactionId!] = {
          ...newReactions[myExistingReactionId!], // the current object is frozen so we need to clone it
          reaction: reaction.reaction,
          removed: false,
          sendStates,
        }
      }
    } else {
      reactionType = 'add'
      const newReaction: MessageReactionData = {
        ...reaction,
        sendStates,
      }
      newReactions = oldReactions ? [...oldReactions].concat([newReaction]) : [newReaction]
    }

    log.info(`--  sendReaction: ${reactionType} ${reaction.reaction} to ${this.idForLogging()} from this device`)

    this.set('reactions', newReactions)

    conversationJobQueue.add(
      {
        type: conversationQueueJobEnum.enum.Reaction,
        conversationId: conversation.id,
        messageId: this.id,
      },
      async (jobToInsert) => {
        await window.Ready.Data.insertJob(jobToInsert)
      }
    )
  }

  // hasRequiredAttachmentDownloads(): boolean {
  //   const attachments: ReadonlyArray<AttachmentType> =
  //     this.get('attachments') || [];

  //   const hasLongMessageAttachments = attachments.some(attachment => MIME.isLongMessage(attachment.contentType));

  //   if (hasLongMessageAttachments) {
  //     return true;
  //   }

  //   const sticker = this.get('sticker');
  //   if (sticker) {
  //     return !sticker.data || !sticker.data.path;
  //   }

  //   return false;
  // }

  hasAttachmentDownloads(): boolean {
    return hasAttachmentDownloads(this.attributes)
  }

  async queueAttachmentDownloads(): Promise<boolean> {
    const value = await queueAttachmentDownloads('MessageModel', this.attributes)
    if (!value) {
      return false
    }

    this.set(value)
    return true
  }

  // markAttachmentAsCorrupted(attachment: AttachmentType): void {
  //   if (!attachment.path) {
  //     throw new Error(
  //       "Attachment can't be marked as corrupted because it wasn't loaded"
  //     );
  //   }

  //   // We intentionally don't check in quotes/stickers/contacts/... here,
  //   // because this function should be called only for something that can
  //   // be displayed as a generic attachment.
  //   const attachments: ReadonlyArray<AttachmentType> =
  //     this.get('attachments') || [];

  //   let changed = false;
  //   const newAttachments = attachments.map(existing => {
  //     if (existing.path !== attachment.path) {
  //       return existing;
  //     }
  //     changed = true;

  //     return {
  //       ...existing,
  //       isCorrupted: true,
  //     };
  //   });

  //   if (!changed) {
  //     throw new Error(
  //       "Attachment can't be marked as corrupted because it wasn't found"
  //     );
  //   }

  //   log.info('markAttachmentAsCorrupted: marking an attachment as corrupted');

  //   this.set({
  //     attachments: newAttachments,
  //   });
  // }

  // async copyFromQuotedMessage(
  //   quote: ProcessedQuote | undefined,
  //   conversationId: string
  // ): Promise<QuotedMessageType | undefined> {
  //   if (!quote) {
  //     return undefined;
  //   }

  //   const { id } = quote;
  //   strictAssert(id, 'Quote must have an id');

  //   const result: QuotedMessageType = {
  //     ...quote,

  //     id,

  //     attachments: quote.attachments.slice(),
  //     bodyRanges: quote.bodyRanges?.slice(),

  //     // Just placeholder values for the fields
  //     referencedMessageNotFound: false,
  //     isGiftBadge: quote.type === Proto.DataMessage.Quote.Type.GIFT_BADGE,
  //     isViewOnce: false,
  //     messageId: '',
  //   };

  //   const inMemoryMessages = window.Signal.messageController.filterBySentAt(id);
  //   const matchingMessage = find(inMemoryMessages, item =>
  //     isQuoteAMatch(item.attributes, conversationId, result)
  //   );

  //   let queryMessage: undefined | MessageModel;

  //   if (matchingMessage) {
  //     queryMessage = matchingMessage;
  //   } else {
  //     log.info('copyFromQuotedMessage: db lookup needed', id);
  //     const messages = await window.Signal.Data.getMessagesBySentAt(id);
  //     const found = messages.find(item =>
  //       isQuoteAMatch(item, conversationId, result)
  //     );

  //     if (!found) {
  //       result.referencedMessageNotFound = true;
  //       return result;
  //     }

  //     queryMessage = window.Signal.messageController.register(found.id, found);
  //   }

  //   if (queryMessage) {
  //     await this.copyQuoteContentFromOriginal(queryMessage, result);
  //   }

  //   return result;
  // }

  // async copyQuoteContentFromOriginal(
  //   originalMessage: MessageModel,
  //   quote: QuotedMessageType
  // ): Promise<void> {
  //   const { attachments } = quote;
  //   const firstAttachment = attachments ? attachments[0] : undefined;

  //   if (messageHasPaymentEvent(originalMessage.attributes)) {
  //     // eslint-disable-next-line no-param-reassign
  //     quote.payment = originalMessage.get('payment');
  //   }

  //   if (isTapToView(originalMessage.attributes)) {
  //     // eslint-disable-next-line no-param-reassign
  //     quote.text = undefined;
  //     // eslint-disable-next-line no-param-reassign
  //     quote.attachments = [
  //       {
  //         contentType: MIME.IMAGE_JPEG,
  //       },
  //     ];
  //     // eslint-disable-next-line no-param-reassign
  //     quote.isViewOnce = true;

  //     return;
  //   }

  //   const isMessageAGiftBadge = isGiftBadge(originalMessage.attributes);
  //   if (isMessageAGiftBadge !== quote.isGiftBadge) {
  //     log.warn(
  //       `copyQuoteContentFromOriginal: Quote.isGiftBadge: ${quote.isGiftBadge}, isGiftBadge(message): ${isMessageAGiftBadge}`
  //     );
  //     // eslint-disable-next-line no-param-reassign
  //     quote.isGiftBadge = isMessageAGiftBadge;
  //   }
  //   if (isMessageAGiftBadge) {
  //     // eslint-disable-next-line no-param-reassign
  //     quote.text = undefined;
  //     // eslint-disable-next-line no-param-reassign
  //     quote.attachments = [];

  //     return;
  //   }

  //   // eslint-disable-next-line no-param-reassign
  //   quote.isViewOnce = false;

  //   // eslint-disable-next-line no-param-reassign
  //   quote.text = getQuoteBodyText(originalMessage.attributes, quote.id);

  //   // eslint-disable-next-line no-param-reassign
  //   quote.bodyRanges = originalMessage.attributes.bodyRanges;

  //   if (firstAttachment) {
  //     firstAttachment.thumbnail = null;
  //   }

  //   if (
  //     !firstAttachment ||
  //     !firstAttachment.contentType ||
  //     (!GoogleChrome.isImageTypeSupported(
  //       stringToMIMEType(firstAttachment.contentType)
  //     ) &&
  //       !GoogleChrome.isVideoTypeSupported(
  //         stringToMIMEType(firstAttachment.contentType)
  //       ))
  //   ) {
  //     return;
  //   }

  //   try {
  //     const schemaVersion = originalMessage.get('schemaVersion');
  //     if (
  //       schemaVersion &&
  //       schemaVersion < TypedMessage.VERSION_NEEDED_FOR_DISPLAY
  //     ) {
  //       const upgradedMessage = await upgradeMessageSchema(
  //         originalMessage.attributes
  //       );
  //       originalMessage.set(upgradedMessage);
  //       await window.Signal.Data.saveMessage(upgradedMessage, {
  //         ourUuid: window.textsecure.storage.user.getCheckedUuid().toString(),
  //       });
  //     }
  //   } catch (error) {
  //     log.error(
  //       'Problem upgrading message quoted message from database',
  //       Errors.toLogFormat(error)
  //     );
  //     return;
  //   }

  //   const queryAttachments = originalMessage.get('attachments') || [];
  //   if (queryAttachments.length > 0) {
  //     const queryFirst = queryAttachments[0];
  //     const { thumbnail } = queryFirst;

  //     if (thumbnail && thumbnail.path) {
  //       firstAttachment.thumbnail = {
  //         ...thumbnail,
  //         copied: true,
  //       };
  //     }
  //   }

  //   const queryPreview = originalMessage.get('preview') || [];
  //   if (queryPreview.length > 0) {
  //     const queryFirst = queryPreview[0];
  //     const { image } = queryFirst;

  //     if (image && image.path) {
  //       firstAttachment.thumbnail = {
  //         ...image,
  //         copied: true,
  //       };
  //     }
  //   }

  //   const sticker = originalMessage.get('sticker');
  //   if (sticker && sticker.data && sticker.data.path) {
  //     firstAttachment.thumbnail = {
  //       ...sticker.data,
  //       copied: true,
  //     };
  //   }
  // }

  async handleDataMessage(
    initialMessage: ProcessedDataMessage,
    confirm: () => void,
    options: { data?: SentEventData } = {}
  ): Promise<void> {
    const { data } = options

    // This function is called from the background script in a few scenarios:
    //   1. on an incoming message
    //   2. on a sent message sync'd from another device
    //   3. in rare cases, an incoming message can be retried, though it will
    //      still go through one of the previous two codepaths

    const message = this
    // const source = message.get('source')
    const sourceUuid = message.get('sourceUuid')
    const type = message.get('type')
    const conversationId = message.get('conversationId')!

    // const fromContact = getContact(this.attributes)
    // if (fromContact) {
    //   fromContact.setRegistered()
    // }

    const conversation = window.Ready.conversationController.get(conversationId)!
    const idLog = `handleDataMessage/${conversation.idForLogging()} ${message.idForLogging()}`
    log.info(`--  ${idLog}`)

    await conversation.queueJob(idLog, async () => {
      log.info(`${idLog}: starting processing in queue`)

      // First, check for duplicates. If we find one, stop processing here.
      const inMemoryMessage = window.Ready.messageController.findBySender(this.getSenderIdentifier())?.attributes
      if (inMemoryMessage) {
        log.info(`${idLog}: cache hit`, this.getSenderIdentifier())
      } else {
        log.info(`${idLog}: duplicate check db lookup needed`, this.getSenderIdentifier())
      }
      const existingMessage =
        inMemoryMessage ||
        (await window.Ready.Data.getMessageBySender({
          ...this.attributes,
          sentAt: this.attributes.sendAt!,
        }))

      const isDuplicateMessage = existingMessage && type === 'incoming'
      if (isDuplicateMessage) {
        log.warn(`${idLog}: Received duplicate message`, this.idForLogging())
        confirm()
        return
      }

      if (type === 'outgoing') {
        const isUpdate = true // Boolean(data && data.isRecipientUpdate)

        if (isUpdate && !existingMessage) {
          log.warn(
            `${idLog}: Received update transcript, but no existing entry for message ${message.idForLogging()}. Dropping.`
          )

          confirm()
          return
        }
        if (existingMessage && !isUpdate) {
          log.warn(
            `${idLog}: Received duplicate transcript for message ${message.idForLogging()}, but it was not an update transcript. Dropping.`
          )

          confirm()
          return
        }
        if (isUpdate && existingMessage) {
          log.info(`${idLog}: Updating message ${message.idForLogging()} with received transcript`)

          const toUpdate = window.Ready.messageController.register(existingMessage.id, existingMessage)

          const sendStateByConversationId = { ...(toUpdate.get('sendStates') || {}) }

          toUpdate.set({
            sendStates: sendStateByConversationId,
            // unidentifiedDeliveries: [...unidentifiedDeliveriesSet],
          })
          await window.Ready.Data.createMessage(toUpdate.attributes)

          confirm()
          return
        }
      }

      // Group

      if (initialMessage.group) {
        //
      }

      // const ourACI = window.textsecure.storage.user.getCheckedUuid(UUIDKind.ACI)

      // const sender = window.Signal.conversationController.lookupOrCreate({
      //   e164: source,
      //   uuid: sourceUuid,
      //   reason: 'handleDataMessage',
      // })!
      const hasGroupProp = Boolean(initialMessage.group)

      // Drop if from blocked user. Only GroupV2 messages should need to be dropped here.
      const isBlocked = false
      // (source && window.storage.blocked.isBlocked(source)) ||
      // (sourceUuid && window.storage.blocked.isUuidBlocked(sourceUuid))
      if (isBlocked) {
        log.info(`${idLog}: Dropping message from blocked sender. hasGroupProp: ${hasGroupProp}`)

        confirm()
        return
      }

      const areWeMember = true // !conversation.get('left') && conversation.hasMember(conversation.attributes.ourAccountId)

      // Drop an incoming GroupV2 message if we or the sender are not part of the group
      //   after applying the message's associated group changes.
      if (
        type === 'incoming' &&
        !isDirectConversation(conversation.attributes) &&
        hasGroupProp &&
        (!areWeMember || (sourceUuid && !conversation.hasMember(sourceUuid)))
      ) {
        log.warn(`${idLog}: Received message destined for group, which we or the sender are not a part of. Dropping.`)
        confirm()
        return
      }

      // We drop incoming messages for v1 groups we already know about, which we're not
      //   a part of, except for group updates. Because group v1 updates haven't been
      //   applied by this point.
      // Note: if we have no information about a group at all, we will accept those
      //   messages. We detect that via a missing 'members' field.
      if (
        type === 'incoming' &&
        !isDirectConversation(conversation.attributes) &&
        !hasGroupProp &&
        conversation.get('members') &&
        !areWeMember
      ) {
        log.warn(
          `Received message destined for group ${conversation.idForLogging()}, which we're not a part of. Dropping.`
        )
        confirm()
        return
      }

      // Drop incoming messages to announcement only groups where sender is not admin
      // if (
      //   conversation.get('announcementsOnly') &&
      //   !conversation.isAdmin(UUID.checkedLookup(sender?.id))
      // ) {
      //   confirm()
      //   return
      // }

      // const [quote, storyQuote] = await Promise.all([
      //   this.copyFromQuotedMessage(initialMessage.quote, conversation.id),
      //   findStoryMessage(conversation.id, initialMessage.storyContext),
      // ])

      try {
        const now = new Date().getTime()

        // const urls = LinkPreview.findLinks(dataMessage.body || '')
        // const incomingPreview = dataMessage.preview || []
        // const preview = incomingPreview.filter((item: LinkPreviewType) => {
        //   if (!item.image && !item.title) {
        //     return false
        //   }
        //   // Story link previews don't have to correspond to links in the
        //   // message body.
        //   if (isStory(message.attributes)) {
        //     return true
        //   }
        //   return urls.includes(item.url) && LinkPreview.shouldPreviewHref(item.url)
        // })
        // if (preview.length < incomingPreview.length) {
        //   log.info(
        //     `${message.idForLogging()}: Eliminated ${
        //       preview.length - incomingPreview.length
        //     } previews with invalid urls'`
        //   )
        // }

        const isPublic = isPublicGroup(this.getConversation()!.attributes)

        message.set({
          conversationId: conversation.id,

          errors: [],

          body: initialMessage.text,
          // bodyRanges: initialMessage.bodyRanges,
          // attachments,
          // contact: dataMessage.contact,
          sticker: initialMessage.sticker,
          gif: initialMessage.gif && {
            ...initialMessage.gif,
            data: JSON.parse(initialMessage.gif.data),
          },
          quote: initialMessage.forwardTo,
          event: initialMessage.event,
          pinMessage: initialMessage.pinMessage,
          // payment: dataMessage.payment,
          sendToken: initialMessage.sendToken,
          requestToken: initialMessage.requestToken,
          replyTo: initialMessage.replyTo,

          isPin: initialMessage.pinMessage?.isPinMessage,

          // flags: dataMessage.flags,
          // giftBadge: initialMessage.giftBadge,
          // hasAttachments: dataMessage.hasAttachments,
          // hasFileAttachments: dataMessage.hasFileAttachments,
          // hasVisualMediaAttachments: dataMessage.hasVisualMediaAttachments,
          // isViewOnce: Boolean(dataMessage.isViewOnce),
          // preview,
          // requiredProtocolVersion:
          //   dataMessage.requiredProtocolVersion || this.INITIAL_PROTOCOL_VERSION,
          decryptedAt: now,
        })

        // if (storyQuote) {
        //   await this.hydrateStoryContext(storyQuote.attributes)
        // }

        const isSupported = true // !isUnsupportedMessage(message.attributes)
        // if (!isSupported) {
        //   await message.eraseContents()
        // }

        if (isSupported) {
          const attributes = {
            ...conversation.attributes,
          }

          // Drop empty messages after. This needs to happen after the initial
          // message.set call and after GroupV1 processing to make sure all possible
          // properties are set before we determine that a message is empty.
          if (message.isEmpty()) {
            log.info(`${idLog}: Dropping empty message`)
            confirm()
            return
          }

          // if (isStory(message.attributes)) {
          //   attributes.hasPostedStory = true
          // } else {
          //   attributes.active_at = now
          // }

          conversation.set(attributes)

          // Sync group story reply expiration timers with the parent story's
          // expiration timer
          // if (isGroupStoryReply && storyQuote) {
          //   message.set({
          //     expireTimer: storyQuote.get('expireTimer'),
          //     expirationStartTimestamp: storyQuote.get('expirationStartTimestamp'),
          //   })
          // }

          // if (dataMessage.expireTimer && !isExpirationTimerUpdate(dataMessage)) {
          //   message.set({ expireTimer: dataMessage.expireTimer })
          //   if (isStory(message.attributes)) {
          //     log.info(`${idLog}: Starting story expiration`)
          //     message.set({
          //       expirationStartTimestamp: dataMessage.timestamp,
          //     })
          //   }
          // }

          // if (!hasGroupV2Prop && !isStory(message.attributes)) {
          //   if (isExpirationTimerUpdate(message.attributes)) {
          //     message.set({
          //       expirationTimerUpdate: {
          //         source,
          //         sourceUuid,
          //         expireTimer: initialMessage.expireTimer,
          //       },
          //     })

          //     if (conversation.get('expireTimer') !== dataMessage.expireTimer) {
          //       log.info('Incoming expirationTimerUpdate changed timer', {
          //         id: conversation.idForLogging(),
          //         expireTimer: dataMessage.expireTimer || 'disabled',
          //         source: idLog,
          //       })
          //       conversation.set({
          //         expireTimer: dataMessage.expireTimer,
          //       })
          //     }
          //   }

          //   // Note: For incoming expire timer updates (not normal messages that come
          //   //   along with an expireTimer), the conversation will be updated by this
          //   //   point and these calls will return early.
          //   if (dataMessage.expireTimer) {
          //     void conversation.updateExpirationTimer(dataMessage.expireTimer, {
          //       source: sourceUuid || source,
          //       receivedAt: message.get('received_at'),
          //       receivedAtMS: message.get('received_at_ms'),
          //       sentAt: message.get('sent_at'),
          //       fromGroupUpdate: isGroupUpdate(message.attributes),
          //       reason: idLog,
          //     })
          //   } else if (
          //     // We won't turn off timers for these kinds of messages:
          //     !isGroupUpdate(message.attributes) &&
          //     !isEndSession(message.attributes)
          //   ) {
          //     void conversation.updateExpirationTimer(undefined, {
          //       source: sourceUuid || source,
          //       receivedAt: message.get('received_at'),
          //       receivedAtMS: message.get('received_at_ms'),
          //       sentAt: message.get('sent_at'),
          //       reason: idLog,
          //     })
          //   }
          // }

          // if (initialMessage.profileKey) {
          //   const { profileKey } = initialMessage
          //   if (
          //     source === window.textsecure.storage.user.getNumber() ||
          //     sourceUuid === window.textsecure.storage.user.getUuid()?.toString()
          //   ) {
          //     conversation.set({ profileSharing: true })
          //   } else if (isDirectConversation(conversation.attributes)) {
          //     void conversation.setProfileKey(profileKey)
          //   } else {
          //     const local = window.Signal.conversationController.lookupOrCreate({
          //       e164: source,
          //       uuid: sourceUuid,
          //       reason: 'handleDataMessage:setProfileKey',
          //     })
          //     void local?.setProfileKey(profileKey)
          //   }
          // }

          // if (isTapToView(message.attributes) && type === 'outgoing') {
          //   await message.eraseContents()
          // }

          // if (
          //   type === 'incoming' &&
          //   isTapToView(message.attributes) &&
          //   !message.isValidTapToView()
          // ) {
          //   log.warn(`${idLog}: Received tap to view message with invalid data. Erasing contents.`)
          //   message.set({
          //     isTapToViewInvalid: true,
          //   })
          //   await message.eraseContents()
          // }
        }

        // const conversationTimestamp = conversation.get('timestamp')
        // if (
        //   !isStory(message.attributes) &&
        //   !isGroupStoryReply &&
        //   (!conversationTimestamp || message.get('sent_at') > conversationTimestamp) &&
        //   messageHasPaymentEvent(message.attributes)
        // ) {
        //   conversation.set({
        //     lastMessage: message.getNotificationText(),
        //     lastMessageAuthor: message.getAuthorText(),
        //     timestamp: message.get('sent_at'),
        //   })
        // }

        // We don't save PUBLIC group to DB
        if (!this.id) {
          const messageId = await saveNewMessageBatcher.add(this.attributes)
          log.info(`--  MessageModel.handleDataMessage: Message saved: ${messageId} sentAt ${this.get('sendAt')}`)

          message.set('id', messageId)
        }

        const messageId = this.id

        let attachments: AttachmentDBType[] | null = null
        // Create attachments
        if (initialMessage.attachments?.length) {
          if (isPublic) {
            // Don't download if chat group
            attachments = initialMessage.attachments.map((attachment, index) => ({
              id: generateGroupAttachmentId(conversationId, messageId, index),
              messageId,
              conversationId,
              ...attachment,
              metadata: attachment.metadata
                ? typeof attachment.metadata === 'object'
                  ? attachment.metadata
                  : JSON.parse(attachment.metadata)
                : undefined,
              localUrl: '',
              createdAt: Date.now(),
            }))
          } else {
            // Download if chat 1-1
            attachments = []
            await Promise.all(
              initialMessage.attachments.map(async (attachment) => {
                const dbAttachmentCreateData = {
                  messageId,
                  conversationId,
                  ...attachment,
                  metadata: attachment.metadata ? JSON.parse(attachment.metadata) : undefined,
                  localUrl: '',
                }
                const attachmentId = await window.Ready.Data.createAttachment(dbAttachmentCreateData)
                attachments!.push({
                  id: attachmentId,
                  ...dbAttachmentCreateData,
                  createdAt: Date.now(),
                })
              })
            )
          }
        }

        if (attachments) message.set('attachments', attachments)

        window.Ready.messageController.register(message.id, message)

        // conversation.incrementMessageCount()

        // If we sent a message in a given conversation, unarchive it!
        if (type === 'outgoing') {
          // conversation.setArchived(false)
        }

        window.Ready.Data.updateConversation(conversation.id, conversation.attributes)

        // Only queue attachments for downloads if this is a story or
        // outgoing message or we've accepted the conversation
        // Don't download if chat group
        const shouldHoldOffDownload = this.background || isPublic

        if (
          this.hasAttachmentDownloads() &&
          // (conversation.getAccepted() || isOutgoing(message.attributes)) &&
          !shouldHoldOffDownload
        ) {
          // if (shouldUseAttachmentDownloadQueue()) {
          //   addToAttachmentDownloadQueue(idLog, message)
          // } else {
          await message.queueAttachmentDownloads()
          // }
        }

        const isFirstRun = true
        await this.modifyTargetMessage(conversation, isFirstRun)

        this.notify(conversation, confirm)
      } catch (error) {
        const errorForLog = Errors.toLogFormat(error)
        log.error(`!-  ${idLog}: error:`, errorForLog)
        throw error
      }
    })
  }

  async notify(conversation: ConversationModel, confirm: () => void): Promise<void> {
    conversation.trigger('newmessage', this)

    const isFirstRun = false
    await this.modifyTargetMessage(conversation, isFirstRun)

    // if (await shouldReplyNotifyUser(this, conversation)) {
    //   await conversation.notify(this)
    // }

    // Increment the sent message count if this is an outgoing message
    if (this.get('type') === 'outgoing') {
      // conversation.incrementSentMessageCount()
    }

    window.Whisper.events.trigger('incrementProgress')
    confirm()

    if (true) {
      // !isStory(this.attributes)) {
      conversation.queueJob('updateUnread', () => conversation.updateUnread())
    }
  }

  // This function is called twice - once from handleDataMessage, and then again from
  //    saveAndNotify, a function called at the end of handleDataMessage as a cleanup for
  //    any missed out-of-order events.
  async modifyTargetMessage(conversation: ConversationModel, isFirstRun: boolean): Promise<void> {
    const message = this
    const type = message.get('type')
    const changed = false
    // const ourUuid = window.textsecure.storage.user.getCheckedUuid().toString()
    // const sourceUuid = getSourceUuid(message.attributes)

    if (type === 'outgoing') {
      // || (type === 'story' && ourUuid === sourceUuid)) {
      // const sendActions = MessageReceipts.getSingleton()
      //   .forMessage(message)
      //   .map((receipt) => {
      //     let sendActionType: SendActionType
      //     const receiptType = receipt.get('type')
      //     switch (receiptType) {
      //       case MessageReceiptType.Delivery:
      //         sendActionType = SendActionType.GotDeliveryReceipt
      //         break
      //       case MessageReceiptType.Read:
      //         sendActionType = SendActionType.GotReadReceipt
      //         break
      //       case MessageReceiptType.View:
      //         sendActionType = SendActionType.GotViewedReceipt
      //         break
      //       default:
      //         throw missingCaseError(receiptType)
      //     }

      //     return {
      //       destinationConversationId: receipt.get('sourceConversationId'),
      //       action: {
      //         type: sendActionType,
      //         updatedAt: receipt.get('receiptTimestamp'),
      //       },
      //     }
      //   })

      const oldSendStateByConversationId = this.get('sendStates') || {}

      // const newSendStateByConversationId = reduce(
      //   sendActions,
      //   (result: SendStateByConversationId, { destinationConversationId, action }) => {
      //     const oldSendState = getOwn(result, destinationConversationId)
      //     if (!oldSendState) {
      //       log.warn(
      //         `Got a receipt for a conversation (${destinationConversationId}), but we have no record of sending to them`
      //       )
      //       return result
      //     }

      //     const newSendState = sendStateReducer(oldSendState, action)
      //     return {
      //       ...result,
      //       [destinationConversationId]: newSendState,
      //     }
      //   },
      //   oldSendStateByConversationId
      // )

      // if (!isEqual(oldSendStateByConversationId, newSendStateByConversationId)) {
      //   message.set('sendStateByConversationId', newSendStateByConversationId)
      //   changed = true
      // }
    }

    if (type === 'incoming') {
      // In a followup (see DESKTOP-2100), we want to make `ReadSyncs#forMessage` return
      //   an array, not an object. This array wrapping makes that future a bit easier.
      // const readSync = ReadSyncs.getSingleton().forMessage(message)
      // const readSyncs = readSync ? [readSync] : []

      // const viewSyncs = ViewSyncs.getSingleton().forMessage(message)

      // const isGroupStoryReply = isGroup(conversation.attributes) && message.get('storyId')

      // if (readSyncs.length !== 0 || viewSyncs.length !== 0) {
      //   const markReadAt = Math.min(
      //     Date.now(),
      //     ...readSyncs.map((sync) => sync.get('readAt')),
      //     ...viewSyncs.map((sync) => sync.get('viewedAt'))
      //   )

      //   if (message.get('expireTimer')) {
      //     const existingExpirationStartTimestamp = message.get('expirationStartTimestamp')
      //     message.set(
      //       'expirationStartTimestamp',
      //       Math.min(existingExpirationStartTimestamp ?? Date.now(), markReadAt)
      //     )
      //     changed = true
      //   }

      //   let newReadStatus: ReadStatus.Read | ReadStatus.Viewed
      //   if (viewSyncs.length) {
      //     newReadStatus = ReadStatus.Viewed
      //   } else {
      //     strictAssert(readSyncs.length !== 0, 'Should have either view or read syncs')
      //     newReadStatus = ReadStatus.Read
      //   }

      //   message.set({
      //     readStatus: newReadStatus,
      //     seenStatus: SeenStatus.Seen,
      //   })
      //   changed = true

      //   this.pendingMarkRead = Math.min(this.pendingMarkRead ?? Date.now(), markReadAt)
      // } else if (
      //   isFirstRun &&
      //   !isGroupStoryReply &&
      //   canConversationBeUnarchived(conversation.attributes)
      // ) {
      //   conversation.setArchived(false)
      // }

      if (!isFirstRun && this.pendingMarkRead) {
        const markReadAt = this.pendingMarkRead
        this.pendingMarkRead = undefined

        // This is primarily to allow the conversation to mark all older
        // messages as read, as is done when we receive a read sync for
        // a message we already know about.
        //
        // We run this when `isFirstRun` is false so that it triggers when the
        // message and the other ones accompanying it in the batch are fully in
        // the database.
        // message.getConversation()?.onReadMessage(message, markReadAt)
      }

      // Check for out-of-order view once open syncs
      // if (isTapToView(message.attributes)) {
      //   const viewOnceOpenSync = ViewOnceOpenSyncs.getSingleton().forMessage(message)
      //   if (viewOnceOpenSync) {
      //     await message.markViewOnceMessageViewed({ fromSync: true })
      //     changed = true
      //   }
      // }
    }

    // if (isStory(message.attributes)) {
    //   const viewSyncs = ViewSyncs.getSingleton().forMessage(message)

    //   if (viewSyncs.length !== 0) {
    //     message.set({
    //       readStatus: ReadStatus.Viewed,
    //       seenStatus: SeenStatus.Seen,
    //     })
    //     changed = true

    //     const markReadAt = Math.min(Date.now(), ...viewSyncs.map((sync) => sync.get('viewedAt')))
    //     this.pendingMarkRead = Math.min(this.pendingMarkRead ?? Date.now(), markReadAt)
    //   }

    //   if (!message.get('expirationStartTimestamp')) {
    //     log.info(`modifyTargetMessage/${this.idForLogging()}: setting story expiration`, {
    //       expirationStartTimestamp: message.get('timestamp'),
    //       expireTimer: message.get('expireTimer'),
    //     })
    //     message.set('expirationStartTimestamp', message.get('timestamp'))
    //     changed = true
    //   }
    // }

    // Does this message have any pending, previously-received associated reactions?
    // const reactions = Reactions.getSingleton().forMessage(message)
    // await Promise.all(
    //   reactions.map(async (reaction) => {
    //     if (isStory(this.attributes)) {
    //       // We don't set changed = true here, because we don't modify the original story
    //       const generatedMessage = reaction.get('storyReactionMessage')
    //       strictAssert(generatedMessage, 'Story reactions must provide storyReactionMessage')
    //       await generatedMessage.handleReaction(reaction, {
    //         storyMessage: this.attributes,
    //       })
    //     } else {
    //       changed = true
    //       await message.handleReaction(reaction, { shouldPersist: false })
    //     }
    //   })
    // )

    // Does this message have any pending, previously-received associated
    // delete for everyone messages?
    // const deletes = Deletes.getSingleton().forMessage(message)
    // await Promise.all(
    //   deletes.map(async (del) => {
    //     await deleteForEveryone(message, del, false)
    //     changed = true
    //   })
    // )

    // We want to make sure the message is saved first before applying any edits
    // if (!isFirstRun) {
    //   const edits = Edits.forMessage(message)
    //   log.info(`modifyTargetMessage/${this.idForLogging()}: ${edits.length} edits in second run`)
    //   await Promise.all(
    //     edits.map((editAttributes) =>
    //       conversation.queueJob('modifyTargetMessage/edits', () =>
    //         handleEditMessage(message.attributes, editAttributes)
    //       )
    //     )
    //   )
    // }

    // if (changed && !isFirstRun) {
    //   log.info(`modifyTargetMessage/${this.idForLogging()}: Changes in second run; saving.`)
    //   await window.Signal.Data.saveMessage(this.attributes, {
    //     ourUuid: window.textsecure.storage.user.getCheckedUuid().toString(),
    //   })
    // }
  }

  async handleReactionMessage(
    newReaction: MessageReactionData & {
      reactionType: 'replace' | 'remove' | 'add'
    }
  ): Promise<void> {
    const { reactionType, address, reaction } = newReaction
    let currentReactions = this.attributes.reactions && [...this.attributes.reactions]
    const existingReactionId = currentReactions?.findIndex((r) => r.address === address)
    const existingReaction =
      existingReactionId != null && existingReactionId >= 0 ? currentReactions![existingReactionId] : undefined

    if (reactionType === 'add') {
      currentReactions = currentReactions ?? []
      if (existingReaction) {
        delete currentReactions[existingReactionId!]
      }
      currentReactions.push(newReaction)
    } else if (reactionType === 'replace') {
      currentReactions = currentReactions ?? []
      if (existingReaction) {
        currentReactions[existingReactionId!] = {
          ...existingReaction, // this is frozen by react. So we need to clone it
          reaction,
        }
      } else {
        currentReactions.push(newReaction)
      }
    } else if (newReaction.reactionType === 'remove') {
      if (existingReaction?.reaction === reaction) {
        delete currentReactions![existingReactionId!]
      }
      // below is to adapt to previous version which does not contain reactionType in it payload
    } else if (existingReaction) {
      if (existingReaction.reaction === reaction) {
        // delete
        currentReactions = currentReactions!.filter((r) => r.address !== newReaction.address)
      } else {
        // replace
        currentReactions![existingReactionId!] = {
          ...existingReaction, // this is frozen by react. So we need to clone it
          reaction,
        }
      }
    } else {
      // add
      currentReactions = currentReactions ?? []
      currentReactions.push(newReaction)
    }

    this.set({ reactions: currentReactions })
    await window.Ready.Data.updateMessageByGuid(this.getConversation()!.id, this.get('guid')!, this.get('source')!, {
      reactions: currentReactions,
    })
  }

  async handleDeleteMessage(del: ProcessedDataMessage['deleted']): Promise<void> {
    const { attachments } = del!
    const conversation = this.getConversation()!

    if (attachments) {
      // Delete some attachments only
      await Promise.all(
        attachments.map(async (attachment) => {
          await window.Ready.Data.deleteAttachmentByCloudUrl(conversation.id, attachment.cloudUrl)
          const att = this.attributes.attachments?.find((a) => a.cloudUrl === attachment.cloudUrl)
          if (att?.localUrl) {
            window.utils.deleteFile(window.config.BASE_FILE_PATH + att.localUrl)
          }
        })
      )

      this.set(
        'attachments',
        this.attributes.attachments?.filter((it) => !attachments.some((a) => a.cloudUrl === it.cloudUrl))
      )
    } else {
      // Delete whole message
      const toUpdate = { contentType: MessageType.DELETED, body: '' }
      this.set(toUpdate)
      await window.Ready.Data.updateMessageByGuid(conversation.id, this.get('uuid')!, this.get('source')!, toUpdate)

      // deleted.attachments = []
      if (this.attributes.attachments?.length)
        await Promise.all(
          this.attributes.attachments!.map(async (attachment) => {
            // deleted.attachments.push(attachment as { cloudUrl: string })
            await window.Ready.Data.deleteAttachment(attachment.id)
            if (attachment.localUrl) {
              window.utils.deleteFile(window.config.BASE_FILE_PATH + attachment.localUrl)
            }
          })
        )
    }

    // reloadCachedDeletedMessage({
    //   accountId: conversation.get('accountId'),
    //   conversationId: conversation.id,
    //   guid: this.get('guid'),
    //   attachments: attachments || [],
    //   isMessageDeleted: !attachments,
    // })

    conversation.debouncedUpdateLastMessage!(`messageReceiver.on.delete`)
  }

  async handlePinMessage(pinMessage: ProcessedDataMessage['pinMessage']): Promise<void> {
    const { guid, source, messageId, isPinMessage, sendAt } = pinMessage!

    const toUpdate = { isPin: isPinMessage }
    this.set(toUpdate)
    await window.Ready.Data.updateMessageByGuid(this.getConversation()!.id, guid, source, toUpdate)
  }

  async handleRequestTokenUpdateMessage(requestTokenUpdate: ProcessedDataMessage['requestToken']): Promise<void> {
    const conversation = this.getConversation()!
    const account = window.Ready.protocol.getAccount(conversation.get('accountId')!)
    await window.Ready.Data.updateMessageByGuid(conversation.id, this.get('guid')!, account.address, {
      requestToken: requestTokenUpdate,
    })
    this.set({ requestToken: requestTokenUpdate })
  }

  // clearNotifications(reaction: Partial<ReactionType> = {}): void {
  //   notificationService.removeBy({
  //     ...reaction,
  //     messageId: this.id,
  //   });
  // }
}

export const MessageCollection: typeof MessageModelCollectionType = Backbone.Collection.extend({
  model: MessageModel,
  // comparator(left: Readonly<MessageModel>, right: Readonly<MessageModel>) {
  //   if (left.get('received_at') === right.get('received_at')) {
  //     return (left.get('sent_at') || 0) - (right.get('sent_at') || 0)
  //   }

  //   return (left.get('received_at') || 0) - (right.get('received_at') || 0)
  // },
})
