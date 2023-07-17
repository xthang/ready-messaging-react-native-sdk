import { appSchema, tableSchema } from '@nozbe/watermelondb'

export default appSchema({
  version: 1,
  tables: [
    // Account

    tableSchema({
      name: 'accounts',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'custom_username', type: 'string' },
        { name: 'avatar', type: 'string' },
        { name: 'avatar_thumb', type: 'string' },
        { name: 'address', type: 'string' },
        { name: 'password', type: 'string' },
        { name: 'registration_id', type: 'number' },
        { name: 'device_user_id', type: 'number' },
        { name: 'public_key', type: 'string' },
        { name: 'private_key', type: 'string' },
      ],
    }),

    tableSchema({
      name: 'contacts',
      columns: [
        { name: 'account_id', type: 'string' },
        { name: 'address', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'custom_username', type: 'string' },
        { name: 'avatar', type: 'string' },
        { name: 'avatar_thumb', type: 'string' },
        { name: 'last_online', type: 'number' },
        { name: 'nickname', type: 'string' },
        { name: 'is_strange', type: 'boolean' },
        { name: 'is_deleted', type: 'boolean' },
      ],
    }),

    // Chat

    tableSchema({
      name: 'jobs',
      columns: [
        { name: 'queue_type', type: 'string' },
        { name: 'timestamp', type: 'number' },
        { name: 'data', type: 'string' },
      ],
    }),

    tableSchema({
      name: 'unprocessed_data',
      columns: [
        { name: 'guid', type: 'string' },
        { name: 'account_id', type: 'string' },
        { name: 'version', type: 'number' },
        { name: 'source', type: 'string' },
        { name: 'source_uuid', type: 'string' },
        { name: 'source_device', type: 'number' },
        { name: 'destination_uuid', type: 'string', isOptional: true },
        { name: 'conversation_destination_address', type: 'string', isOptional: true },
        { name: 'envelope', type: 'string' },
        { name: 'decrypted', type: 'string', isOptional: true },
        { name: 'timestamp', type: 'number' },
        { name: 'server_timestamp', type: 'number' },
        { name: 'attempts', type: 'number' },
        { name: 'message_age_sec', type: 'number' },
        { name: 'urgent', type: 'boolean', isOptional: true },
        { name: 'background', type: 'boolean', isOptional: true },
      ],
    }),

    tableSchema({
      name: 'conversations',
      columns: [
        { name: 'account_id', type: 'string' },
        { name: 'identifier', type: 'string' },
        { name: 'type', type: 'number' },
        { name: 'group_type', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'last_seen', type: 'number', isOptional: true },
        { name: 'last_read', type: 'number', isOptional: true },
        { name: 'description', type: 'string', isOptional: true },
        { name: 'avatar', type: 'string', isOptional: true },
        { name: 'mute_until', type: 'number', isOptional: true },
        { name: 'no_push', type: 'boolean', isOptional: true },
        { name: 'is_blocked', type: 'boolean', isOptional: true },
        { name: 'is_account_deleted', type: 'boolean', isOptional: true },
      ],
    }),

    tableSchema({
      name: 'messages',
      columns: [
        { name: 'uuid', type: 'string' },
        { name: 'guid', type: 'string' },

        { name: 'created_at', type: 'number' },
        { name: 'deleted_at', type: 'number', isOptional: true },

        { name: 'source_uuid', type: 'string' },
        { name: 'source', type: 'string' },
        { name: 'source_device', type: 'number' },

        { name: 'conversation_id', type: 'string' },

        { name: 'type_', type: 'string', isOptional: true },

        { name: 'type', type: 'number' },

        { name: 'body', type: 'string', isOptional: true },
        { name: 'json', type: 'string', isOptional: true },
        { name: 'reactions', type: 'string' },
        { name: 'reply_to', type: 'string' },
        { name: 'forward_to', type: 'string' },

        { name: 'is_pin', type: 'boolean' },

        { name: 'send_at', type: 'number', isOptional: true },
        { name: 'send_states', type: 'string', isOptional: true },
        { name: 'is_sent', type: 'boolean', isOptional: true },

        { name: 'received_at', type: 'number', isOptional: true },
        { name: 'receive_status', type: 'string', isOptional: true },

        { name: 'deleted_for_everyone_send_status', type: 'string', isOptional: true },
        { name: 'deleted_for_everyone_failed', type: 'boolean', isOptional: true },
      ],
    }),

    tableSchema({
      name: 'attachments',
      columns: [
        { name: 'conversation_id', type: 'string' },
        { name: 'message_id', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'type', type: 'number' },
        { name: 'cloud_url', type: 'string' },
        { name: 'local_url', type: 'string' },
        { name: 'secure', type: 'boolean' },
        { name: 'metadata', type: 'string' },
        { name: 'decryption_key', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'size', type: 'number' },
      ],
    }),

    // Signal

    tableSchema({
      name: 'signal_signed_pre_keys',
      columns: [
        { name: 'account_id', type: 'string' },
        { name: 'key_id', type: 'number' },
        { name: 'public_key', type: 'string' },
        { name: 'private_key', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'confirmed', type: 'boolean' },
      ],
    }),

    tableSchema({
      name: 'signal_pre_keys',
      columns: [
        { name: 'account_id', type: 'string' },
        { name: 'key_id', type: 'number' },
        { name: 'public_key', type: 'string' },
        { name: 'private_key', type: 'string' },
      ],
    }),

    tableSchema({
      name: 'signal_sessions',
      columns: [
        { name: 'conversation_id', type: 'string' },
        { name: 'session_id', type: 'string' },
        { name: 'device_id', type: 'number' },
        { name: 'record', type: 'string' },
      ],
    }),

    tableSchema({
      name: 'signal_identity_keys',
      columns: [
        { name: 'our_id', type: 'string' },
        { name: 'their_id', type: 'string' },
        { name: 'conversation_id', type: 'string' },
        { name: 'public_key', type: 'string' },
        { name: 'first_use', type: 'boolean' },
        { name: 'timestamp', type: 'number' },
        { name: 'verified', type: 'number' },
        { name: 'nonblocking_approval', type: 'boolean' },
      ],
    }),

    tableSchema({
      name: 'signal_devices',
      columns: [
        { name: 'conversation_id', type: 'string' },
        { name: 'contact_address', type: 'string' },
        { name: 'device_user_id', type: 'number' },
        { name: 'registration_id', type: 'number' },
      ],
    }),
  ],
})
