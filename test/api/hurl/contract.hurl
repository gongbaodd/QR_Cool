GET {{base_url}}/v1/render
HTTP 405
Allow: POST
Content-Type: application/json
Cache-Control: no-store
[Asserts]
jsonpath "$.error.code" == "METHOD_NOT_ALLOWED"
jsonpath "$.error.message" isString
jsonpath "$.requestId" matches /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

PUT {{base_url}}/v1/render
HTTP 405
Allow: POST
[Asserts]
jsonpath "$.error.code" == "METHOD_NOT_ALLOWED"

OPTIONS {{base_url}}/v1/render
HTTP 405
Allow: POST
[Asserts]
jsonpath "$.error.code" == "METHOD_NOT_ALLOWED"

GET {{base_url}}/missing
HTTP 404
Content-Type: application/json
[Asserts]
jsonpath "$.error.code" == "NOT_FOUND"
jsonpath "$.requestId" matches /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

POST {{base_url}}/v1/render
Content-Type: application/json
```raw
{}
```
HTTP 401
Content-Type: application/json
[Asserts]
jsonpath "$.error.code" == "UNAUTHORIZED"

POST {{base_url}}/v1/render
Authorization: Basic {{token}}
Content-Type: application/json
```raw
{}
```
HTTP 401
[Asserts]
jsonpath "$.error.code" == "UNAUTHORIZED"

POST {{base_url}}/v1/render
Authorization: Bearer {{bad_token}}
Content-Type: application/json
```raw
not json
```
HTTP 401
[Asserts]
jsonpath "$.error.code" == "UNAUTHORIZED"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: text/plain
```raw
not json
```
HTTP 415
Content-Type: application/json
[Asserts]
jsonpath "$.error.code" == "UNSUPPORTED_MEDIA_TYPE"

POST {{base_url}}/v1/render?artifact=
Authorization: Bearer {{token}}
Content-Type: application/json
{}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "ARTIFACT_INVALID"

POST {{base_url}}/v1/render?artifact=jpeg
Authorization: Bearer {{token}}
Content-Type: application/json
{}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "ARTIFACT_INVALID"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
```raw
{bad json
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "INVALID_JSON"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/invalid-utf8.bin;
HTTP 400
[Asserts]
jsonpath "$.error.code" == "INVALID_JSON"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/invalid-schema.recipe.json;
HTTP 400
[Asserts]
jsonpath "$.error.code" == "RECIPE_INVALID"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/invalid-digest.recipe.json;
HTTP 400
[Asserts]
jsonpath "$.error.code" == "RECIPE_INVALID"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/invalid-placement.recipe.json;
HTTP 422
[Asserts]
jsonpath "$.error.code" == "QR_LAYOUT_INVALID"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json; charset=utf-8
file,test/api/fixtures/baseline.recipe.json;
HTTP 200
Content-Type: image/png
[Asserts]
# fixture-sha: baseline_poster_sha
sha256 == hex,0000000000000000000000000000000000000000000000000000000000000000;

GET {{base_url}}/health
HTTP 200
Content-Type: application/json
Cache-Control: no-store
X-Content-Type-Options: nosniff
[Asserts]
jsonpath "$.status" == "ok"

POST {{base_url}}/health
HTTP 405
Allow: GET
Cache-Control: no-store
X-Content-Type-Options: nosniff

HEAD {{base_url}}/health
HTTP 405
Allow: GET
Cache-Control: no-store
X-Content-Type-Options: nosniff

HEAD {{base_url}}/v1/render
HTTP 405
Allow: POST
Content-Type: application/json
Cache-Control: no-store
X-Content-Type-Options: nosniff

# The method guard must outrank authentication even when a token is supplied.
DELETE {{base_url}}/v1/render
Authorization: Bearer {{bad_token}}
HTTP 405
Allow: POST
[Asserts]
jsonpath "$.error.code" == "METHOD_NOT_ALLOWED"

GET {{base_url}}/health/
HTTP 404
Content-Type: application/json
[Asserts]
jsonpath "$.error.code" == "NOT_FOUND"
jsonpath "$.requestId" matches /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

PUT {{base_url}}/v1/render/
HTTP 404
Content-Type: application/json
[Asserts]
jsonpath "$.error.code" == "NOT_FOUND"
jsonpath "$.requestId" matches /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
