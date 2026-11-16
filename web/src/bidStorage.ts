import { getAuth } from './api';
export async function bidRequest(operation: string, payload: any, versions: Map<string, number>, expectedEmail?: string) {
  const client = getAuth();
  if (!client) throw Error('Sign in to save and open bids.');
  const { data: sessionData } = await client.auth.getSession();
  const user = sessionData.session?.user;
  if (expectedEmail && user?.email !== expectedEmail) throw Error('Account changed. Reopen the workspace.');
  if (!user) throw Error('Sign in to save and open bids.');
  if (operation === 'list') {
    const { data, error } = await client.from('bids').select('id,data,version').order('updated_at', { ascending: false });
    if (error) throw error;
    // Listing does not advance the loaded revision of an already-open bid.
    for (const row of data || []) if (!versions.has(row.id)) versions.set(row.id, row.version);
    return (data || []).map(row => row.data);
  }
  if (operation === 'get') {
    const { data, error } = await client.from('bids').select('id,data,version').eq('id', payload.id).single();
    if (error) throw error;
    versions.set(data.id, data.version);
    return data.data;
  }
  if (operation === 'save') {
    const { data, error } = await client.rpc('save_bid', { payload: payload.draft, expected_version: versions.get(payload.draft.id) || 0 });
    if (error) throw error;
    versions.set(data.id, data.version);
    return data.data;
  }
  if (operation === 'share') {
    const { error } = await client.rpc('share_workspace', { workspace_kind: 'bid', target: payload.id, collaborator_email: payload.email, access_role: payload.role });
    if (error) throw error;
    return true;
  }
  throw Error('Unsupported bid action');
}
