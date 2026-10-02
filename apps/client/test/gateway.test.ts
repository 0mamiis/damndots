import test from 'node:test';import assert from 'node:assert/strict';
import { NativeGateway } from '../src/gateway.js';
test('gateway rejects remote HTTP and embedded secrets before opening sockets',()=>{assert.throws(()=>new NativeGateway({server:'http://example.com',dataDir:'.data/test'}),/HTTPS/);assert.throws(()=>new NativeGateway({server:'https://user:password@example.com',dataDir:'.data/test'}),/HTTPS/);assert.doesNotThrow(()=>new NativeGateway({server:'http://127.0.0.1:9340',dataDir:'.data/test'}));});
