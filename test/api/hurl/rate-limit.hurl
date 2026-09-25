# Keep these 11 authenticated requests sequential. They use an invalid content type
# so the limit is exercised without invoking the renderer.
POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: text/plain
{}
HTTP 415

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: text/plain
{}
HTTP 415

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: text/plain
{}
HTTP 415

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: text/plain
{}
HTTP 415

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: text/plain
{}
HTTP 415

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: text/plain
{}
HTTP 415

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: text/plain
{}
HTTP 415

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: text/plain
{}
HTTP 415

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: text/plain
{}
HTTP 415

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: text/plain
{}
HTTP 415

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: text/plain
{}
HTTP 429
[Asserts]
jsonpath "$.error.code" == "RATE_LIMITED"
