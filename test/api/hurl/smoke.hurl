POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
[Options]
output: output/api-tests/baseline.poster.png
file,test/api/fixtures/baseline.recipe.json;
HTTP 200
Content-Type: image/png
Cache-Control: no-store
X-Content-Type-Options: nosniff
Content-Disposition: attachment; filename="poster.png"
[Asserts]
header "X-Request-Id" matches /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
# fixture-sha: baseline_poster_sha
sha256 == hex,0000000000000000000000000000000000000000000000000000000000000000;

POST {{base_url}}/v1/render?artifact=poster.png
Authorization: Bearer {{token}}
Content-Type: application/json
[Options]
output: output/api-tests/baseline.explicit-poster.png
file,test/api/fixtures/baseline.recipe.json;
HTTP 200
Content-Type: image/png
Cache-Control: no-store
X-Content-Type-Options: nosniff
Content-Disposition: attachment; filename="poster.png"
[Asserts]
# fixture-sha: baseline_poster_sha
sha256 == hex,0000000000000000000000000000000000000000000000000000000000000000;

POST {{base_url}}/v1/render?artifact=qr.png
Authorization: Bearer {{token}}
Content-Type: application/json
[Options]
output: output/api-tests/baseline.qr.png
file,test/api/fixtures/baseline.recipe.json;
HTTP 200
Content-Type: image/png
Cache-Control: no-store
X-Content-Type-Options: nosniff
Content-Disposition: attachment; filename="qr.png"
[Asserts]
# fixture-sha: baseline_qr_sha
sha256 == hex,0000000000000000000000000000000000000000000000000000000000000000;

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/transparent.recipe.json;
HTTP 200
Content-Type: image/png
Cache-Control: no-store
Content-Disposition: attachment; filename="poster.png"
[Asserts]
# fixture-sha: transparent_poster_sha
sha256 == hex,0000000000000000000000000000000000000000000000000000000000000000;

POST {{base_url}}/v1/render
Authorization: Bearer {{token}}
Content-Type: application/json
file,test/api/fixtures/rotated.recipe.json;
HTTP 200
Content-Type: image/png
Cache-Control: no-store
Content-Disposition: attachment; filename="poster.png"
[Asserts]
# fixture-sha: rotated_poster_sha
sha256 == hex,0000000000000000000000000000000000000000000000000000000000000000;
