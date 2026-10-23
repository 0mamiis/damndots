"use client";
import {useContext,useState} from "react";
import type {ApiList,Dot} from "@dots/contracts";
import {Button} from "@heroui/react";
import {Action,Actions,ApiContext,Check,Disclose,Field,Form,FormGrid,Loading,Notice,Section,SelectField,Status,str,time,useData} from "./ui";
type TelegramSettings={enabled:boolean;hasBotToken:boolean;ownerUserId:string;dotId:string|null;mirrorUserMessages:boolean;mirrorReplies:boolean;botUsername:string|null;lastPollAt:string|null;lastMessageAt:string|null;lastDeliveryAt:string|null;lastError:string|null;deliveryUnknown:number};
export function TelegramPanel(){
 const settings=useData<TelegramSettings>("telegram",5000),dots=useData<ApiList<Dot>>("dots");const {mutate}=useContext(ApiContext);const [test,setTest]=useState("");const [testError,setTestError]=useState("");const [testing,setTesting]=useState(false);const s=settings.data;
 async function check(send:boolean){setTesting(true);setTestError("");setTest("");try{const r=await mutate(send?"telegram/test-message":"telegram/test","POST",{}) as {botUsername?:string};setTest(send?"Test message sent to your Telegram account.":"Connected to @"+r.botUsername);}catch(e){setTestError(e instanceof Error?e.message:"Connection test failed");}finally{setTesting(false);}}
 return <Section title="Telegram" description="Chat with your Dot from your private Telegram account. Desktop messages and replies can appear in the same Telegram chat.">
  <Notice error={testError||settings.error||s?.lastError||""}/>
  {!s?<Loading/>:<>
   <div className="flex flex-wrap items-center gap-3 text-sm"><Status value={s.enabled?"enabled":"disabled"}/>{s.botUsername&&<a className="underline" href={`https://t.me/${encodeURIComponent(s.botUsername)}`} target="_blank" rel="noreferrer">@{s.botUsername}</a>}{s.lastPollAt&&<span className="text-muted">Last poll: {time(s.lastPollAt)}</span>}</div>
   <Form key={JSON.stringify([s.enabled,s.hasBotToken,s.ownerUserId,s.dotId,s.mirrorUserMessages,s.mirrorReplies])} submit="Save Telegram settings" onSubmit={async d=>{await mutate("telegram","PATCH",{enabled:d.has("enabled"),botToken:str(d,"botToken"),ownerUserId:str(d,"ownerUserId"),dotId:str(d,"dotId")||null,mirrorUserMessages:d.has("mirrorUserMessages"),mirrorReplies:d.has("mirrorReplies")});setTest("");}}>
    <FormGrid>
     <Field label="Bot token" name="botToken" type="password" placeholder={s.hasBotToken?"Saved — leave blank to keep":"Paste the token from BotFather"} description="Stored encrypted on the selected server. The saved token is never returned to this page."/>
     <Field label="Your Telegram user ID" name="ownerUserId" value={s.ownerUserId} description="Your numeric user ID, not a bot username. Only this account in a private chat can use the bot."/>
     <SelectField label="Dot" name="dotId" defaultValue={s.dotId??""} options={(dots.data?.items??[]).map(d=>({value:d.id,label:d.name}))} placeholder="Select a Dot"/>
    </FormGrid>
    <Check name="enabled" label="Enable Telegram" checked={s.enabled} description="Open your bot in Telegram and press Start before sending messages."/>
    <Check name="mirrorUserMessages" label="Mirror desktop messages" checked={s.mirrorUserMessages} description="Send messages you write in Codex or the dashboard to Telegram too."/>
    <Check name="mirrorReplies" label="Mirror Dot replies" checked={s.mirrorReplies} description="Send replies to Telegram, including replies to messages sent from Codex."/>
   </Form>
   <Actions>
    <Button variant="secondary" isDisabled={testing||!s.hasBotToken} onPress={()=>void check(false)}>Check connection</Button>
    <Button variant="secondary" isDisabled={testing||!s.hasBotToken||!s.ownerUserId} onPress={()=>void check(true)}>Send test message</Button>
   </Actions>
   {test&&<p role="status" className="text-sm">{test}</p>}
   {s.lastDeliveryAt&&<p className="text-sm text-muted">Last delivery: {time(s.lastDeliveryAt)}</p>}
   {s.deliveryUnknown>0&&<p role="alert" className="text-sm text-warning">{s.deliveryUnknown} delivery result(s) could not be confirmed. Check Telegram before sending these messages again.</p>}
   <p className="text-sm text-muted">Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline">BotFather</a>. Text messages are supported. Photo and voice messages are not supported yet. Run only one Telegram poller for this bot.</p>
   <Disclose summary="Disconnect Telegram"><p className="text-sm text-muted">Stops this connection and removes the saved token. Your Dot conversations stay available.</p><Action path="telegram" method="DELETE" variant="secondary">Disconnect</Action></Disclose>
  </>}
 </Section>;
}
