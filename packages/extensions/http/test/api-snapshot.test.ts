import { describe, expect, test } from 'bun:test'
import * as Api from '../src/index.js'

// Locks the public value surface of @liche/http. Add deliberately; this guards accidental exports.
const FROZEN_PUBLIC_VALUES = ['callHttpOperation', 'serializeHttpOperationRequest'].sort()

describe('@liche/http public surface', () => {
  test('value exports match the frozen surface', () => {
    expect(Object.keys(Api).sort()).toEqual(FROZEN_PUBLIC_VALUES)
  })
})

// Compile-time lock on the public type surface — removing/renaming a type breaks typecheck here.
export type _PublicTypeBag = [
  Api.HttpAuth,
  Api.HttpFetch,
  Api.HttpMethod,
  Api.HttpOperationBind,
  Api.HttpOperationCall,
  Api.HttpOperationRequestSpec,
  Api.RemoteErrorDetails,
  Api.RuntimeValue,
  Api.SerializedHttpRequest,
]
