import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {themeScript} from '../components/theme';

function run(stored:string|null,dark:boolean){
  const classes=new Set<string>();
  const root={
    classList:{toggle:(name:string,on:boolean)=>{on?classes.add(name):classes.delete(name)}},
    dataset:{} as Record<string,string>,
    style:{} as Record<string,string>,
  };
  const context=vm.createContext({
    localStorage:{getItem:(k:string)=>k==='dots-theme'?stored:null},
    matchMedia:()=>({matches:dark}),
    document:{documentElement:root},
  });
  vm.runInContext(themeScript,context);
  return {dark:classes.has('dark'),preference:root.dataset.themePreference,theme:root.dataset.theme,colorScheme:root.style.colorScheme};
}

test('an unset preference follows the operating system',()=>{
  assert.deepEqual(run(null,true),{dark:true,preference:'auto',theme:'dark',colorScheme:'dark'});
  assert.deepEqual(run(null,false),{dark:false,preference:'auto',theme:'light',colorScheme:'light'});
});

test('a saved light or dark preference wins over the system',()=>{
  assert.deepEqual(run('light',true),{dark:false,preference:'light',theme:'light',colorScheme:'light'});
  assert.deepEqual(run('dark',false),{dark:true,preference:'dark',theme:'dark',colorScheme:'dark'});
});

test('an explicit auto preference tracks the system',()=>{
  assert.deepEqual(run('auto',true),{dark:true,preference:'auto',theme:'dark',colorScheme:'dark'});
});

