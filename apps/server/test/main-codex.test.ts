import test from 'node:test';
import assert from 'node:assert/strict';
import {isInsideTrustedProject,MainCodex} from '../src/main-codex.js';

test('trusted project checks use the target path format on every backend OS',()=>{
 const roots=['c:\\projects\\project-a','c:\\services'];
 assert.equal(isInsideTrustedProject('C:\\Projects\\Project-A',roots),true);
 assert.equal(isInsideTrustedProject('C:\\Projects\\Project-A\\src\\app',roots),true);
 assert.equal(isInsideTrustedProject('\\\\?\\C:\\Services\\app',roots),true);
 assert.equal(isInsideTrustedProject('C:\\Projects\\Project-A-evil',roots),false);
 assert.equal(isInsideTrustedProject('C:\\Projects\\Project-A\\..\\..\\Windows',roots),false);
 assert.equal(isInsideTrustedProject('C:\\Windows\\System32',roots),false);
 assert.equal(isInsideTrustedProject('C:relative',roots),false);
 assert.equal(isInsideTrustedProject('/etc',['/srv/app']),false);
 assert.equal(isInsideTrustedProject('/srv/app/sub',['/srv/app']),true);
 assert.equal(isInsideTrustedProject('/srv/app-evil',['/srv/app']),false);
 assert.equal(isInsideTrustedProject('/SRV/app',['/srv/app']),false);
 assert.equal(isInsideTrustedProject('/srv/app',roots),false);
});

test('main Codex tools stay hidden until an explicitly installed bridge token exists',()=>{
 assert.deepEqual(new MainCodex({url:'ws://127.0.0.1:1',tokenFile:'nonexistent-bridge-fixture-token',enabled:true}).definitions(),[]);
 assert.deepEqual(new MainCodex({url:'ws://127.0.0.1:1',tokenFile:'nonexistent-bridge-fixture-token',enabled:false}).definitions(),[]);
});
