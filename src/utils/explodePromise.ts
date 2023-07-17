// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */

export type ExplodePromiseResultType<T> = Readonly<{
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}>

export function explodePromise<T>(): ExplodePromiseResultType<T> {
  let resolve: (value: T) => void
  let reject: (error: Error) => void

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return {
    promise,
    // Typescript thinks that resolve and reject can be undefined here.

    resolve: resolve!,

    reject: reject!,
  }
}
