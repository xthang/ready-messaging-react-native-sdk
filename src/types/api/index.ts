import { SendChatMessageData, SendPublicGroupMessageData } from './requests/chat'
import { SendChatMessageResult, SendPublicChatMessageResult, EmtpyResult } from './responses'

export type GeneralApiProblem =
  /**
   * Times up.
   */
  | { kind: 'timeout'; temporary: true }
  /**
   * Cannot connect to the server for some reason.
   */
  | { kind: 'cannot-connect'; temporary: true }
  /**
   * The server experienced a problem. Any 5xx error.
   */
  | { kind: 'server' }
  /**
   * We're not allowed because we haven't identified ourself. This is 401.
   */
  | { kind: 'unauthorized'; data?: any }
  /**
   * We don't have access to perform that request. This is 403.
   */
  | { kind: 'forbidden' }
  /**
   * Unable to find that resource.  This is a 404.
   */
  | { kind: 'not-found' }
  /**
   * All other 4xx series errors.
   */
  | { kind: 'rejected' }
  /**
   * Something truly unexpected happened. Most likely can try again. This is a catch all.
   */
  | { kind: 'unknown'; temporary: true }
  /**
   * The data we received is not in the expected format.
   */
  | { kind: 'bad-data'; data?: any }
  | { kind: 'gone'; data?: any }
  | { kind: 'conflict'; data?: any }

/**
 * Attempts to get a common cause of problems from an api response.
 *
 * @param response The api response.
 */
export async function getGeneralApiProblem(response: Response): Promise<GeneralApiProblem> {
  const data = await response.json()
  switch (response.status) {
    case 400:
      return { kind: 'bad-data', data }
    case 401:
      return { kind: 'unauthorized', data }
    case 403:
      return { kind: 'forbidden' }
    case 404:
      return { kind: 'not-found' }
    case 409:
      return { kind: 'conflict', data }
    case 410:
      return { kind: 'gone', data }
    case 413:
    default:
      return { kind: 'rejected' }
  }
}

export class ApiError extends Error {
  constructor(public problem: GeneralApiProblem) {
    let message: string
    switch (problem.kind) {
      case 'timeout':
      case 'cannot-connect':
      case 'server':
      case 'unauthorized':
      case 'forbidden':
      case 'not-found':
      case 'rejected':
      case 'unknown':
      case 'bad-data':
      case 'gone':
      case 'conflict':
      default:
        message = problem.kind
    }
    if ('data' in problem) message = `[${message}] ${JSON.stringify(problem.data)}`

    super(message)

    this.name = 'ApiError'
  }
}

export type ServerApi = {
  sendMessage: (payload: SendChatMessageData, destination: string) => Promise<SendChatMessageResult>
  sendPublicGroupMessage: (payload: SendPublicGroupMessageData) => Promise<SendPublicChatMessageResult>
  deletePublicGroupMessage: (groupId: string, guid: string) => Promise<EmtpyResult>
  deletePublicGroupAttachment: (groupId: string, cloudUrl: string) => Promise<EmtpyResult>
  reactMessagePublicGroup: (groupId: string, guid: string, reaction: string) => Promise<EmtpyResult>
}
