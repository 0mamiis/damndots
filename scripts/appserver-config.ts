import {loadConfig,gatewayKey} from '../apps/server/src/config.js';
/** Both fresh and existing installs route through the dashboard's live provider settings. */
export function appServerProvider(env:NodeJS.ProcessEnv=process.env){
  const config=loadConfig({...env,DOTS_DATA_DIR:env.DOTS_DATA_DIR||'apps/server/.data/server'});
  return {base:(env.DOTS_SERVER_URL||'http://127.0.0.1:'+config.port).replace(/\/$/,'')+'/model-gateway',key:gatewayKey(config.signingKey)};
}
