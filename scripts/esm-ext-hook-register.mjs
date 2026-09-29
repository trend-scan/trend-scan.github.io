// Registration entry for scripts/esm-ext-hook.mjs — passed to `node --import`
// by the npm test script so the hooks are active for every test file.
import { register } from 'node:module';

register('./esm-ext-hook.mjs', import.meta.url);
