"use client";
// Progress feedback for the in-panel update: a spinner, the current step and a stage bar.
const steps:Record<string,number>={queued:8,preparing:22,ready:42,applying:66,restarting:86,rolling_back:48,completed:100,failed:100,rolled_back:100};
export function Spinner({className=""}:{className?:string}){
  return <svg className={"size-3.5 shrink-0 animate-spin "+className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25"/>
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
  </svg>;
}
export function UpdateProgress({label,pending,status}:{label:string;pending:boolean;status?:string}){
  const value=pending?steps.queued:steps[status??""]??12;
  return <div className="flex flex-col gap-1.5" role="group" aria-label="Update progress">
    <div className="flex items-center gap-2"><Spinner className="text-accent"/><span role="status">{label}</span></div>
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label="Update progress">
      <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{width:value+"%"}}/>
    </div>
  </div>;
}
