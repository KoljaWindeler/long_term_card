# @kalkih/lz-string

LZ-based compression algorithm for JavaScript.

ES6 fork of [pieroxy´s](https://github.com/pieroxy) popular [lz-string](https://github.com/pieroxy/lz-string) lib.


## Example
```shell
$ npm install --save @kalkih/lz-string
```

```js
import { compress, decompress } from '@kalkih/lz-string'

const compressed = compress(data)
```