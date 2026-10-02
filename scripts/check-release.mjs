import {verifyRelease} from './release-files.mjs';
const files=await verifyRelease();
console.log('Release source check passed: '+files.length+' files; runtime state and private credentials excluded.');
