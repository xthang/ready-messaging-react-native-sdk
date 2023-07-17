/* eslint-disable import/no-unused-modules */

export class XEvent implements Event {
  bubbles!: boolean
  cancelBubble!: boolean
  cancelable!: boolean
  composed!: boolean
  currentTarget!: EventTarget
  defaultPrevented!: boolean
  eventPhase!: number
  isTrusted!: boolean
  returnValue!: boolean
  srcElement!: EventTarget
  target!: EventTarget
  timeStamp!: number

  constructor(readonly type: string, readonly eventInitDict?: EventInit) {}

  composedPath(): EventTarget[] {
    throw new Error('Method not implemented.')
  }
  initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void {
    throw new Error('Method not implemented.')
  }
  preventDefault(): void {
    throw new Error('Method not implemented.')
  }
  stopImmediatePropagation(): void {
    throw new Error('Method not implemented.')
  }
  stopPropagation(): void {
    throw new Error('Method not implemented.')
  }

  prototype!: Event
  readonly NONE!: 0
  readonly CAPTURING_PHASE!: 1
  readonly AT_TARGET!: 2
  readonly BUBBLING_PHASE!: 3
}
