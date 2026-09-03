// Print a fresh TOKEN_ENCRYPTION_KEY. Add it to .env.local and to the hosting environment.
import { generateKey } from '../lib/app/crypto';
console.log(`TOKEN_ENCRYPTION_KEY=${generateKey()}`);
