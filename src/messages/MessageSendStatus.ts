/* eslint-disable import/no-unused-modules */

export enum SendStatus {
  Failed = 'Failed',
  Pending = 'Pending',
  Sent = 'Sent',
  Delivered = 'Delivered', // ~ Unread
  Read = 'Read',
  Viewed = 'Viewed',
}

const STATUS_NUMBERS: Record<SendStatus, number> = {
  [SendStatus.Failed]: 0,
  [SendStatus.Pending]: 1,
  [SendStatus.Sent]: 2,
  [SendStatus.Delivered]: 3,
  [SendStatus.Read]: 4,
  [SendStatus.Viewed]: 5,
}

export const isPending = (status: SendStatus): boolean => status === SendStatus.Pending
export const isFailed = (status: SendStatus): boolean => status === SendStatus.Failed
export const isSent = (status: SendStatus): boolean => STATUS_NUMBERS[status] >= STATUS_NUMBERS[SendStatus.Sent]
export const isDelivered = (status: SendStatus): boolean =>
  STATUS_NUMBERS[status] >= STATUS_NUMBERS[SendStatus.Delivered]
export const isRead = (status: SendStatus): boolean => STATUS_NUMBERS[status] >= STATUS_NUMBERS[SendStatus.Read]
export const isViewed = (status: SendStatus): boolean => status === SendStatus.Viewed

/**
 * `SendState` combines `SendStatus` and a timestamp. You can use it to show things to the
 * user such as "this message was delivered at 6:09pm".
 *
 * The timestamp may be undefined if reading old data, which did not store a timestamp.
 */
export type SendState = Readonly<{
  // When sending a story to multiple distribution lists at once, we need to
  // de-duplicate the recipients. The story should only be sent once to each
  // recipient in the list so the recipient only sees it rendered once.
  isAlreadyIncludedInAnotherDistributionList?: boolean
  isAllowedToReplyToStory?: boolean
  status:
    | SendStatus.Pending
    | SendStatus.Failed
    | SendStatus.Sent
    | SendStatus.Delivered
    | SendStatus.Read
    | SendStatus.Viewed
  updatedAt?: number
}>

export type SendStates = Record<string, SendState>
