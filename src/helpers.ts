import orderBy from 'lodash/orderBy'
import {
  type AttachmentDBType,
  AttachmentType,
  mapMessageContentTypeToDB,
  MessageContentType,
  type MessageData,
  type MessageDataV2,
  type MessageDBType,
  ReceiptType,
} from 'types/chat'
import { type SocketEnvelop } from 'types/socket'

// Socket message parser
export const parseSocketMessage = ({
  envelope: { sourceUuid, destinationUuid, conversationDestinationAddress, timestamp, contentType, groupId },
  message,
  isPublicGroupMessage,
}: {
  envelope: {
    sourceUuid: string
    destinationUuid: string | undefined
    conversationDestinationAddress: string | undefined
    timestamp: number
    contentType?: MessageContentType
    groupId?: string
  }
  message: string
  isPublicGroupMessage?: boolean
}) => {
  let parsedContent: MessageData | MessageDataV2
  try {
    parsedContent = JSON.parse(message)
  } catch (e) {
    return null
  }
  if (!parsedContent || typeof parsedContent !== 'object') {
    return null
  }

  let content: MessageDataV2
  // a update_public_message message sends the original message data appended with new other fields,
  // so we can not rely on the presence of version to determine which way to read the data
  if ('version' in parsedContent && !isPublicGroupMessage) {
    content = parsedContent
  } else {
    // the older version
    content = { version: '1.0.0' }

    if (contentType === MessageContentType.TYPING) {
      content.typingMessage = { action: 'started', timestamp, groupId }
    } else if (contentType === MessageContentType.SEEN) {
      content.receiptMessage = {
        type: ReceiptType.READ,
        timestamp: (parsedContent as MessageData).seenTime!,
      }
    } else if (sourceUuid === destinationUuid && conversationDestinationAddress) {
      // this is a sync message sent from the same account, different device
      content.syncMessage = {
        sent: {
          destinationAddress: conversationDestinationAddress,
          timestamp,
          message: parsedContent as MessageData,
        },
      }
    } else {
      content.dataMessage = parsedContent as MessageData
    }
  }

  const dataMessage = content.dataMessage || content.syncMessage?.sent?.message

  let messageBody: string | null = null
  let lastMessage: string | null = null

  if (dataMessage) {
    // Fill missing data
    if (!dataMessage.attachments) {
      dataMessage.attachments = []
    }

    // Decide content, last message and action
    if (dataMessage.gif) {
      lastMessage = 'GIF'
    }
    if (dataMessage.attachments?.length) {
      if (dataMessage.attachments[0]!.type === AttachmentType.IMAGE) {
        lastMessage = 'IMG'
      }
      if (dataMessage.attachments[0]!.type === AttachmentType.FILE) {
        lastMessage = 'FILE'
      }
      if (dataMessage.attachments[0]!.type === AttachmentType.AUDIO) {
        lastMessage = 'AUDIO'
      }
      if (dataMessage.attachments[0]!.type === AttachmentType.VIDEO) {
        lastMessage = 'VIDEO'
      }
    }
    if (dataMessage.sticker) {
      lastMessage = 'STICKER'
    }
    if (dataMessage.event) {
      lastMessage = dataMessage.event.message!
    }
    if (dataMessage.deleted) {
      lastMessage = '(deleted)'
      messageBody = null
    }
    if (dataMessage.sendToken) {
      lastMessage = `send ${dataMessage.sendToken.tokenAmount} ${dataMessage.sendToken.tokenSymbol}`
      messageBody = JSON.stringify(dataMessage.sendToken)
    }
    if (dataMessage.requestToken) {
      lastMessage = `request ${dataMessage.requestToken.tokenAmount} ${dataMessage.requestToken.tokenSymbol}`
      messageBody = JSON.stringify(dataMessage.requestToken)
    }
    if (dataMessage.requestToken?.rejected !== undefined) {
      lastMessage = `your request has been ${dataMessage.requestToken.rejected ? 'declined' : 'accepted'}`
      messageBody = JSON.stringify(dataMessage.requestToken)
    }
    if (dataMessage.pinMessage) {
      lastMessage = 'Pinned Message'
      messageBody = JSON.stringify(dataMessage.pinMessage)
    }
    if (dataMessage.text) {
      lastMessage = dataMessage.text
      messageBody = dataMessage.text
    }
  } else if (content.typingMessage) {
    //
  }

  return {
    parsedContent: content,
    messageBody,
    lastMessage,
  }
}

// Merge messages list
export const mergeMessagesList = (currentList: MessageDBType[], newList: MessageDBType[]) => {
  if (!newList.length) {
    return currentList
  }
  if (!currentList.length) {
    return newList
  }

  let results = [...currentList]
  newList.forEach((item) => {
    const index = results.findIndex((i) => i.id === item.id)
    const duplicateIndex = results.findIndex((i) => i.uuid === item.uuid && i.sendAt === item.sendAt)

    if (index >= 0) {
      results[index] = { ...item }
    } else {
      if (duplicateIndex >= 0) {
        results.splice(duplicateIndex, 1)
      }
      results.push(item)
    }
  })

  results = orderBy(results, ['sendAt'], ['desc'])
  return results
}

// Merge attacments list
export const mergeAttachmentsList = (currentList: AttachmentDBType[], newList: AttachmentDBType[]) => {
  if (!newList.length) {
    return currentList
  }
  if (!currentList.length) {
    return newList
  }

  let results = [...currentList]
  newList.forEach((item) => {
    const index = results.findIndex((i) => i.id === item.id)
    if (index >= 0) {
      results[index] = { ...item }
    } else {
      results.push(item)
    }
  })

  results = orderBy(results, ['createdAt'], ['desc'])
  return results
}

// Convert legacy message to db message
export const fromPublicGroupToDbMessage = (m: SocketEnvelop, conversationId: string) => {
  const parseResult = parseSocketMessage({
    envelope: {
      ...m,
      sourceUuid: m.source_uuid,
      destinationUuid: m.destination_uuid,
      conversationDestinationAddress: m.real_destination,
    },
    message: m.legacy_message,
    isPublicGroupMessage: true,
  })
  if (!parseResult) {
    return null
  }
  const { parsedContent, messageBody } = parseResult
  const dataMessage = parsedContent.dataMessage!

  const result: MessageDBType = {
    id: m.message_id.toString(),
    guid: m.guid,
    uuid: dataMessage.uuid,
    source: m.source,
    conversationId,

    type: undefined,

    contentType: mapMessageContentTypeToDB(m.content)!,
    body: dataMessage.pinMessage ? 'Pinned messsage' : messageBody,
    attachments: (dataMessage.attachments || []).map((a, index) => ({
      ...a,
      id: generateGroupAttachmentId(conversationId, m.message_id.toString(), index),
      messageId: m.message_id.toString(),
      conversationId,
      metadata: a.metadata ? (typeof a.metadata === 'object' ? a.metadata : JSON.parse(a.metadata)) : undefined,
      localUrl: null,
      createdAt: null,
    })),
    sticker: dataMessage.sticker,
    reactions: dataMessage.reactions,
    event: dataMessage.event,
    pinMessage: dataMessage.pinMessage,
    replyTo: dataMessage.replyTo,
    quote: dataMessage.forwardTo,

    isPin: dataMessage.pinMessage ? dataMessage.pinMessage.isPinMessage : m.is_pinned,

    createdAt: m.timestamp * 1000,
    sendAt: m.timestamp * 1000,
    isSent: true,
    receivedAt: m.server_timestamp * 1000,
  }
  return result
}

// Generate attachment id from public group message
export const generateGroupAttachmentId = (conversationId: string, messageId: string, index: number) =>
  `${conversationId}-${messageId.toString()}-${index}`
