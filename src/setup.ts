import Backbone from 'backbone'
import { ConversationController } from 'ConversationController'
import { db } from 'db'
import { clone } from 'lodash'
import { MessageController } from 'MessageController'
import { ConversationCollection } from 'models/conversations'
import { SignalProtocolStore } from 'SignalProtocolStore'
import MessageReceiver from 'textsecure/MessageReceiver'

window.Whisper = {} as any
window.Whisper.events = clone(Backbone.Events)

window.Ready = {} as any

window.Ready.types = {} as any
window.Ready.utils = {} as any
window.Ready.api = {} as any

window.Ready.Data = db

window.Ready.protocol = new SignalProtocolStore()
window.Ready.protocol.hydrateCaches()

const convoCollection = new ConversationCollection()
window.Ready.conversationController = new ConversationController(convoCollection)

window.Ready.messageController = new MessageController()
window.Ready.messageController.startCleanupInterval()

const messageReceiver = new MessageReceiver({ protocol: window.Ready.protocol })
window.Ready.messageReceiver = messageReceiver
