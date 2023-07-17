export enum ReceiveStatus {
  Unread = 'Unread',
  Read = 'Read',
  Viewed = 'Viewed',
}

const STATUS_NUMBERS: Record<ReceiveStatus, number> = {
  [ReceiveStatus.Unread]: 0,
  [ReceiveStatus.Read]: 1,
  [ReceiveStatus.Viewed]: 2,
}
