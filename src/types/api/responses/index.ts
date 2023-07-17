import { GeneralApiProblem } from '..'

// export * from './account'
export * from './chat'
// export * from './contact'
// export * from './file'
// export * from './wallet'
// export * from './beta'

export type EmtpyResult = { kind: 'ok' } | GeneralApiProblem
