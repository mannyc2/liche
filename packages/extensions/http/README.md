# @liche/http

HTTP transport runtime for Liche CLIs.

Declarative **outbound** API operations: serialize a command's inputs into an HTTP
request via a field→location binding, execute it (timeout, abort, retry
classification), validate the response against a schema, and surface every failure
as a structured, secret-redacted error.

## Public API

- `callHttpOperation(spec)` — serialize → fetch → validate → typed result.
- `serializeHttpOperationRequest(spec)` — pure input → `{ url, method, headers, body }`.
- Types: `HttpOperationCall`, `HttpOperationBind`, `HttpOperationRequestSpec`,
  `HttpAuth`, `HttpMethod`, `HttpFetch`, `RuntimeValue`, `SerializedHttpRequest`,
  `RemoteErrorDetails`.

Generated Liche CLIs that wrap a remote API import `callHttpOperation` from this
package; it is the runtime counterpart to the operation bindings emitted by
`@liche/product`.
