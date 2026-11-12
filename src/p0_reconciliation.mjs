// Read-only interpretation of remote observations. Remote absence is never
// evidence that an attempted create did not happen: the original lost ACK
// requires independent reconciliation regardless of list contents.
export function describeP0Reconciliation(known,agents,serverId){
  if(!known||!Array.isArray(agents)||typeof serverId!=='string'||!serverId)
    throw new Error('invalid P0 original dispatch/reconciliation observation');
  const ack=typeof known.agent_id==='string'&&known.agent_id.length>0;
  const match=ack&&agents.length===1&&
    known.agent_id===serverId+':'+agents[0].id;
  return {
    consistent:match,
    outcome:!ack?(agents.length===0?'UNKNOWN_ACK':'UNACKNOWLEDGED_REMOTE_MATCH'):
      agents.length===0?'UNKNOWN_REMOTE_ABSENCE':
        match?'IDENTIFIED_NOT_RECOVERED':'IDENTITY_CONFLICT',
    manualReconciliationRequired:true
  };
}
