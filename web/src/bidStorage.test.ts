import { beforeEach, expect, it, vi } from 'vitest';
import { bidRequest } from './bidStorage';
const {client} = vi.hoisted(()=>({client:{auth:{getSession:vi.fn()},rpc:vi.fn(),from:vi.fn()}}));
vi.mock('./api',()=>({getAuth:()=>client}));
beforeEach(()=>{vi.clearAllMocks();client.auth.getSession.mockResolvedValue({data:{session:{user:{id:'alice',email:'alice@example.test'}}}});});
it('rejects anonymous saving without contacting storage',async()=>{
 client.auth.getSession.mockResolvedValue({data:{session:null}});
 await expect(bidRequest('save',{draft:{id:'bid'}},new Map())).rejects.toThrow('Sign in');
 expect(client.rpc).not.toHaveBeenCalled();
});
it('rejects writes queued across account changes',async()=>{
 await expect(bidRequest('save',{draft:{id:'bid'}},new Map(),'bob@example.test')).rejects.toThrow('Account changed');
 expect(client.rpc).not.toHaveBeenCalled();
});
it('uses loaded version and retains it after a conflict',async()=>{
 const versions=new Map([['bid',3]]);
 client.rpc.mockResolvedValueOnce({error:{message:'This bid changed elsewhere'}});
 await expect(bidRequest('save',{draft:{id:'bid'}},versions)).rejects.toEqual({message:'This bid changed elsewhere'});
 expect(versions.get('bid')).toBe(3);
 expect(client.rpc).toHaveBeenCalledWith('save_bid',{payload:{id:'bid'},expected_version:3});
 client.rpc.mockResolvedValueOnce({data:{id:'bid',version:4,data:{id:'bid'}}});
 await bidRequest('save',{draft:{id:'bid'}},versions);
 expect(versions.get('bid')).toBe(4);
});
it('listing never replaces the revision of an open bid',async()=>{
 const versions=new Map([['bid',2]]);
 client.from.mockReturnValue({select:()=>({order:async()=>({data:[{id:'bid',version:4,data:{id:'bid'}}]})})});
 await bidRequest('list',{},versions);
 expect(versions.get('bid')).toBe(2);
});
it('sharing always goes through the owner-checked RPC',async()=>{
 client.rpc.mockResolvedValue({error:null});
 await bidRequest('share',{id:'bid',email:'collaborator@example.test',role:'reviewer'},new Map());
 expect(client.rpc).toHaveBeenCalledWith('share_workspace',{workspace_kind:'bid',target:'bid',collaborator_email:'collaborator@example.test',access_role:'reviewer'});
});
