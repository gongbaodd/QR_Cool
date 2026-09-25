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
file,test/api/fixtures/invalid-renderer.recipe.json;
HTTP 400
[Asserts]
jsonpath "$.error.code" == "RECIPE_INVALID"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/invalid-unknown-field.recipe.json;
HTTP 400
[Asserts]
jsonpath "$.error.code" == "RECIPE_INVALID"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/invalid-required-field.recipe.json;
HTTP 400
[Asserts]
jsonpath "$.error.code" == "RECIPE_INVALID"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/invalid-content.recipe.json;
HTTP 400
[Asserts]
jsonpath "$.error.code" == "RECIPE_INVALID"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/invalid-base64.recipe.json;
HTTP 400
[Asserts]
jsonpath "$.error.code" == "RECIPE_INVALID"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/invalid-dimensions.recipe.json;
HTTP 400
[Asserts]
jsonpath "$.error.code" == "RECIPE_INVALID"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/invalid-png.recipe.json;
HTTP 400
[Asserts]
jsonpath "$.error.code" == "PNG_INVALID"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/invalid-placement.recipe.json;
HTTP 422
[Asserts]
jsonpath "$.error.code" == "QR_LAYOUT_INVALID"

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/invalid-color.recipe.json;
HTTP 422
[Asserts]
jsonpath "$.error.code" == "COLOR_INVALID"
