import { GroupRole, ModeratorPermissions } from '../../chat'
import { SocketEnvelopType } from '../../socket'

export type ApiMessageData = {
  type: SocketEnvelopType
  destination_device_id: number
  destination_registration_id: number
  body: string
  content: string
}

export type SendChatMessageData = {
  timestamp: number
  online: boolean
  messages: ReadonlyArray<ApiMessageData>
  real_destination?: string
  guid?: string
}

export type SendPublicGroupMessageData = {
  timestamp: number
  online: boolean
  message: {
    type: number
    destination: string
    body: string
    content: string
  }
}

export type CreatePublicGroupData = {
  name: string
  description: string
  avatar?: string
}

export type UpdatePublicGroupData = {
  name: string
  description: string
  avatar?: string
  type?: 'public' | 'private'
}

export type AddPublicGroupMembersData = {
  members: {
    username: string
    role: GroupRole
  }[]
}

export type UpdatePublicGroupMemberData = {
  role: GroupRole
}

export type UpdateModeratorPermissionData = {
  codename: ModeratorPermissions
  is_enabled: boolean
}

export type SeachMessageParam = {
  q?: string
  messageType?: string
  from?: number
  to?: number
  chatAddress?: string
}
