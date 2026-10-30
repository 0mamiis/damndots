// Local display preference only. Runtime approvals and model restrictions stay native.
function damndotsPermissionInformationDialog(R,props,Original,kind,cyber){
 var state=R.useState(null),value=state[0],set=state[1],done=R.useRef(false);
 R.useEffect(function(){var disposed=false;var read=window.electronBridge?.getPermissionDisplayPreferences;
  Promise.resolve(typeof read==='function'?read():null).then(function(p){if(!disposed)set(p?.hideInformationDialogs===true);},function(){if(!disposed)set(false);});
  return function(){disposed=true;};
 },[]);
 var skip=value===true&&!cyber;
 R.useEffect(function(){if(skip&&!done.current){done.current=true;var confirm=kind==='full-access'?props.onConfirm:props.onContinueWithFullAccess;confirm();props.onClose();}},[skip,props.onConfirm,props.onContinueWithFullAccess,props.onClose]);
 return value===null||skip?null:R.createElement(Original,props);
}
