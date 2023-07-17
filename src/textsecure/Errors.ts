// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */

import type { LibSignalErrorBase } from '@readyio/lib-messaging'
import type { DataMessage } from 'types/chat'
import type { CallbackResultType } from './Types.d'

function appendStack(newError: Error, originalError: Error) {
  newError.stack += `\nOriginal stack:\n${originalError.stack}`
}

export type HTTPErrorHeadersType = {
  [name: string]: string | ReadonlyArray<string>
}

export class HTTPError extends Error {
  public readonly name = 'HTTPError'

  public readonly code: number

  public readonly responseHeaders: HTTPErrorHeadersType

  public readonly response: unknown

  constructor(
    message: string,
    options: {
      code: number
      headers: HTTPErrorHeadersType
      response?: unknown
      stack?: string
      cause?: unknown
    }
  ) {
    super(`${message}; code: ${options.code}`, { cause: options.cause })

    const { code: providedCode, headers, response, stack } = options

    this.code = providedCode > 999 || providedCode < 100 ? -1 : providedCode
    this.responseHeaders = headers

    this.stack += `\nOriginal stack:\n${stack}`
    this.response = response
  }
}

export class ReplayableError extends Error {
  functionCode?: number

  constructor(options: { name?: string; message: string; functionCode?: number; cause?: unknown }) {
    super(options.message, { cause: options.cause })

    this.name = options.name || 'ReplayableError'
    this.message = options.message

    // Maintains proper stack trace, where our error was thrown (only available on V8)
    //   via https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this)
    }

    this.functionCode = options.functionCode
  }
}

export class OutgoingIdentityKeyError extends ReplayableError {
  public readonly identifier: string

  // Note: Data to resend message is no longer captured
  constructor(incomingIdentifier: string, cause?: LibSignalErrorBase) {
    const identifier = incomingIdentifier.split('.')[0]!

    super({
      name: 'OutgoingIdentityKeyError',
      message: `The identity of ${identifier} has changed.`,
      cause,
    })

    this.identifier = identifier
  }
}

export class OutgoingMessageError extends ReplayableError {
  readonly identifier: string

  readonly httpError?: HTTPError

  // Note: Data to resend message is no longer captured
  constructor(incomingIdentifier: string, _m: unknown, _t: unknown, httpError?: HTTPError) {
    const identifier = incomingIdentifier.split('.')[0]!

    super({
      name: 'OutgoingMessageError',
      message: httpError ? httpError.message : 'no http error',
    })

    this.identifier = identifier

    if (httpError) {
      this.httpError = httpError
      appendStack(this, httpError)
    }
  }

  get code(): undefined | number {
    return this.httpError?.code
  }
}

export class SendMessageNetworkError extends ReplayableError {
  readonly identifier: string

  readonly httpError: HTTPError

  constructor(identifier: string, _m: unknown, httpError: HTTPError) {
    super({
      name: 'SendMessageNetworkError',
      message: httpError.message,
    })
    this.identifier = identifier.split('.')[0]!
    this.httpError = httpError

    appendStack(this, httpError)
  }

  get code(): number {
    return this.httpError.code
  }

  get responseHeaders(): undefined | HTTPErrorHeadersType {
    return this.httpError.responseHeaders
  }
}

export type SendMessageChallengeData = Readonly<{
  token?: string
  options?: ReadonlyArray<string>
}>

// export class SendMessageChallengeError extends ReplayableError {
//   public identifier: string;

//   public readonly httpError: HTTPError;

//   public readonly data: SendMessageChallengeData | undefined;

//   public readonly retryAt?: number;

//   constructor(identifier: string, httpError: HTTPError) {
//     super({
//       name: 'SendMessageChallengeError',
//       message: httpError.message,
//       cause: httpError,
//     });

//     [this.identifier] = identifier.split('.');
//     this.httpError = httpError;

//     this.data = httpError.response as SendMessageChallengeData;

//     const headers = httpError.responseHeaders || {};

//     const retryAfter = parseRetryAfter(headers['retry-after']);
//     if (retryAfter) {
//       this.retryAt = Date.now() + retryAfter;
//     }

//     appendStack(this, httpError);
//   }

//   get code(): number {
//     return this.httpError.code;
//   }
// }

export class SendMessageProtoError extends Error implements CallbackResultType {
  public readonly successfulIdentifiers?: Array<string>

  public readonly failoverIdentifiers?: Array<string>

  public readonly errors?: CallbackResultType['errors']

  // public readonly unidentifiedDeliveries?: Array<string>

  public readonly dataMessage: DataMessage | undefined

  public readonly editMessage: DataMessage | undefined

  // Fields necessary for send log save
  // public readonly contentHint?: number

  // public readonly contentProto?: Uint8Array

  public readonly timestamp?: number

  public readonly recipients?: Record<string, Array<number>>

  public readonly sendIsNotFinal?: boolean

  constructor({
    successfulIdentifiers,
    failoverIdentifiers,
    errors,
    // unidentifiedDeliveries,
    dataMessage,
    editMessage,
    // contentHint,
    // contentProto,
    timestamp,
    recipients,
    sendIsNotFinal,
  }: CallbackResultType) {
    super(`SendMessageProtoError: ${SendMessageProtoError.getMessage(errors)}`)

    this.successfulIdentifiers = successfulIdentifiers
    this.failoverIdentifiers = failoverIdentifiers
    this.errors = errors
    // this.unidentifiedDeliveries = unidentifiedDeliveries
    this.dataMessage = dataMessage
    this.editMessage = editMessage
    // this.contentHint = contentHint
    // this.contentProto = contentProto
    this.timestamp = timestamp
    this.recipients = recipients
    this.sendIsNotFinal = sendIsNotFinal
  }

  protected static getMessage(errors: CallbackResultType['errors']): string {
    if (!errors) {
      return 'No errors'
    }

    return errors.map((error, index) => `[${index}] - ${error.toString()}`).join(',\n')
  }
}

export class SignedPreKeyRotationError extends ReplayableError {
  constructor() {
    super({
      name: 'SignedPreKeyRotationError',
      message: 'Too many signed prekey rotation failures',
    })
  }
}

export class MessageError extends ReplayableError {
  readonly httpError: HTTPError

  constructor(_m: unknown, httpError: HTTPError) {
    super({
      name: 'MessageError',
      message: httpError.message,
    })

    this.httpError = httpError

    appendStack(this, httpError)
  }

  get code(): number {
    return this.httpError.code
  }
}

export class UnregisteredUserError extends Error {
  readonly identifier: string

  readonly error: Error

  constructor(identifier: string, error: Error) {
    const { message } = error

    super(message)

    this.message = message
    this.name = 'UnregisteredUserError'

    // Maintains proper stack trace, where our error was thrown (only available on V8)
    //   via https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this)
    }

    this.identifier = identifier
    this.error = error

    appendStack(this, error)
  }

  get code(): number {
    return this.error instanceof HTTPError ? this.error.code : -1
  }
}

export class ConnectTimeoutError extends Error {}

export class UnknownRecipientError extends Error {}

export class IncorrectSenderKeyAuthError extends Error {}

export class WarnOnlyError extends Error {}

export class NoSenderKeyError extends Error {}
