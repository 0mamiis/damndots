import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopKeysymName,desktopColors} from '../src/desktop.js';

test('full desktop receives native panel navigation and modifier keysyms',()=>{
 assert.equal(desktopKeysymName(65293),'Return');assert.equal(desktopKeysymName(65507),'Control_L');
 assert.equal(desktopKeysymName(65361),'Left');assert.equal(desktopKeysymName(65481),'F12');
 assert.equal(desktopKeysymName(0xe7),'ç');assert.equal(desktopKeysymName(97),'a');
 assert.equal(desktopKeysymName(0xdeadbeef),undefined);
});
test('desktop theme follows the saved appearance and recovers from absent or unknown colors',()=>{
 assert.equal(desktopColors({appearance:{color:'yellow'}}).base,'#ffdf55');
 assert.equal(desktopColors({appearance:{color:'not-a-color'}}).base,desktopColors(null).base);
 assert.match(desktopColors({appearance:{color:'blue'}}).light,/^#[0-9a-f]{6}$/);
});
