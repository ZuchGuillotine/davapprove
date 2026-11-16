import { useState, type FormEvent } from 'react';
import { getAuth } from './api';
export default function WorkspaceSharing({id}: {id: string}) {
  const [email,setEmail]=useState(''), [role,setRole]=useState('editor'), [notice,setNotice]=useState(''), [busy,setBusy]=useState(false);
  async function share(e: FormEvent) {
    e.preventDefault(); setBusy(true); setNotice('');
    try {
      const auth=getAuth(); if(!auth) throw Error('Sign in required');
      const {error}=await auth.rpc('share_workspace',{workspace_kind:'project',target:id,collaborator_email:email.trim(),access_role:role});
      if(error) throw error;
      setNotice(role==='remove'?'Access removed.':'Access granted. They can now open this project after signing in. No email was sent.');
    } catch(e:any) {setNotice(e.message || 'Could not update access.');} finally {setBusy(false);}
  }
  return <details className="panel"><summary>Project collaborators</summary><p>Only the creator can manage access. Collaborators must first create and confirm an account.</p><form onSubmit={share}><label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label><label>Access<select value={role} onChange={e=>setRole(e.target.value)}><option value="editor">Editor</option><option value="reviewer">Reviewer</option><option value="remove">Remove access</option></select></label><button disabled={busy}>Update access</button><p role="status">{notice}</p></form></details>;
}
