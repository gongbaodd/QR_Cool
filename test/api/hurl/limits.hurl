# Run after the regular suite, with an idle local rate-limit window.
POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,output/api-tests/fixtures/oversized-request.json;
HTTP 413
[Asserts]
jsonpath "$.error.code" == "REQUEST_TOO_LARGE"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,output/api-tests/fixtures/oversized-image.recipe.json;
HTTP 413
[Asserts]
jsonpath "$.error.code" == "IMAGE_TOO_LARGE"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,output/api-tests/fixtures/oversized-dimensions.recipe.json;
HTTP 413
[Asserts]
jsonpath "$.error.code" == "IMAGE_TOO_LARGE"
