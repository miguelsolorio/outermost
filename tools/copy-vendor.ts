// Copies runtime files that must be served unhashed (the Basis Universal
// transcoder used by KTX2Loader) from node_modules into public/vendor/.
import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const dest = join(root, 'public', 'vendor', 'basis');
await mkdir(dest, { recursive: true });
await cp(join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis'), dest, { recursive: true });
