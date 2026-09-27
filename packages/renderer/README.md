# @gongbaodd/qr-renderer

Render `mahu-qr.recipe.json` files exported by the mahu-QR editor with the same renderer used by the editor and its replay Worker.

Requires Node.js 22 or newer. The Node entry uses Sharp for PNG processing; Sharp installs a native binary for the current platform.

```sh
npm install @gongbaodd/qr-renderer
```

```js
import { readFile, writeFile } from 'node:fs/promises'
import { renderRecipeFile } from '@gongbaodd/qr-renderer/node'

const { png, filename } = await renderRecipeFile(await readFile('mahu-qr.recipe.json'), { artifact: 'poster.png' })
await writeFile(filename, png)
```

`poster.png` is the default and contains the full assembled poster. Select `{ artifact: 'qr.png' }` for the standalone transparent QR image. The API returns `Uint8Array` PNG bytes and the matching filename; it does not read or write filesystem paths itself.

`renderRecipeFile(input, options?)` accepts UTF-8 JSON text or bytes. `renderRecipeJson(value, options?)` accepts an already parsed JSON value. Both validate the recipe schema and renderer version, enforce recipe and PNG limits, verify embedded image SHA-256 digests and dimensions, and run the normal assembly validation before returning an image. Invalid or unsupported recipes reject with an error. Inputs are processed locally: recipe content is never fetched, and this package makes no network requests.

Recipes are versioned rendering inputs. A package release does not promise replay of renderer versions it does not support. Keep the recipe with its source assets and use a compatible renderer release for long-term reproduction.

Only the `/node` entry is supported as a public Node.js API. Other package subpaths are internal workspace integration points and may change.
