/* eslint-disable import/no-unused-modules */

import { type AttachmentDBType, type MessageDBType } from 'types/chat'
import { logger } from 'utils/logger'
import { downloadQueue } from './index'

export async function queueAttachmentDownloads(
  tag: string,
  message: MessageDBType
): Promise<{ attachments: AttachmentDBType[] }> {
  logger.log(`--  queueAttachmentDownloads [${tag}]`, message)

  return {
    attachments: await Promise.all(
      message.attachments!.map(async (attachment) => {
        if (attachment.secure) {
          const result = await downloadQueue.add(() =>
            window.Ready.utils.downloadAttachment({
              attachmentId: attachment.id,
              conversationId: message.conversationId,
              spaceId: attachment.cloudUrl!,
              name: attachment.name,
              secure: attachment.secure,
              decryptionKey: attachment.decryptionKey,
              fileType: attachment.type,
            })
          )

          return {
            ...attachment,
            localUrl: result.localPath,
            decryptionKey: result.decryptionKey,
            size: result.size,
          }
        }

        return { ...attachment }
      })
    ),
  }
}
