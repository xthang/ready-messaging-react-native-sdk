// Copyright 2023 Ready.io

import { XEvent } from 'types/event'

/*
 * Implements EventTarget
 * https://developer.mozilla.org/en-US/docs/Web/API/EventTarget
 */

export type EventHandler = (event: any) => unknown

export default class EventTarget {
  listeners?: { [type: string]: Array<EventHandler> } | null

  dispatchEvent(ev: Event): Array<unknown> {
    if (!(ev instanceof XEvent)) {
      throw new Error('Expects an event')
    }
    if (this.listeners == null || typeof this.listeners !== 'object') {
      this.listeners = {}
    }
    const listeners = this.listeners[ev.type]
    const results = []
    if (typeof listeners === 'object') {
      const max = listeners.length
      for (let i = 0; i < max; i += 1) {
        const listener = listeners[i]
        if (typeof listener === 'function') {
          results.push(listener.call(null, ev))
        }
      }
    }
    return results
  }

  addEventListener(eventName: string, callback: EventHandler): void {
    if (typeof eventName !== 'string') {
      throw new Error('First argument expects a string')
    }
    if (typeof callback !== 'function') {
      throw new Error('Second argument expects a function')
    }
    if (this.listeners == null || typeof this.listeners !== 'object') {
      this.listeners = {}
    }
    let listeners = this.listeners[eventName]
    if (typeof listeners !== 'object') {
      listeners = []
    }
    listeners.push(callback)
    this.listeners[eventName] = listeners
  }

  removeEventListener(eventName: string, callback: EventHandler): void {
    if (typeof eventName !== 'string') {
      throw new Error('First argument expects a string')
    }
    if (typeof callback !== 'function') {
      throw new Error('Second argument expects a function')
    }
    if (this.listeners == null || typeof this.listeners !== 'object') {
      this.listeners = {}
    }
    const listeners = this.listeners[eventName]!
    if (typeof listeners === 'object') {
      for (let i = 0; i < listeners.length; i += 1) {
        if (listeners[i] === callback) {
          listeners.splice(i, 1)
          return
        }
      }
    }
    this.listeners[eventName] = listeners
  }

  removeAllEventListeners(): void {
    this.listeners = null
  }

  extend(source: any): any {
    const target = this as any

    for (const prop in source) {
      target[prop] = source[prop]
    }
    return target
  }
}
