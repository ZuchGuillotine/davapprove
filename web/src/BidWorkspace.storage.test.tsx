import {afterEach, expect, it, vi} from 'vitest';
import {act, cleanup, render, screen} from '@testing-library/react';
import BidWorkspace from './BidWorkspace';
const {request}=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('./bidStorage',()=>({bidRequest:request}));
afterEach(()=>{cleanup();request.mockReset();});
function event(source:any,origin=location.origin){return new MessageEvent('message',{origin,source,data:{channel:'davapprove-bids',requestId:'request-1',operation:'list'}});}
it('accepts messages only from its own same-origin frame',async()=>{
 render(<BidWorkspace accountKey="alice@example.test" />);
 const target={postMessage:vi.fn()};
 Object.defineProperty(screen.getByTitle('Early bid assessment workspace'),'contentWindow',{value:target});
 request.mockResolvedValue([]);
 await act(async()=>{window.dispatchEvent(event(target,'https://evil.example'));window.dispatchEvent(event({postMessage:vi.fn()}));});
 expect(request).not.toHaveBeenCalled();
 await act(async()=>{window.dispatchEvent(event(target));});
 expect(request).toHaveBeenCalledWith('list',{},expect.any(Map),'alice@example.test');
 expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({result:[]}),location.origin);
});
it('never delivers a response after the account changes',async()=>{
 let resolve!:(x:any)=>void;
 request.mockReturnValue(new Promise(r=>{resolve=r;}));
 const {rerender}=render(<BidWorkspace accountKey="alice@example.test" />);
 const target={postMessage:vi.fn()};
 Object.defineProperty(screen.getByTitle('Early bid assessment workspace'),'contentWindow',{value:target});
 await act(async()=>{window.dispatchEvent(event(target));});
 rerender(<BidWorkspace accountKey="bob@example.test" />);
 await act(async()=>{resolve([{title:'Alice private bid'}]);});
 expect(target.postMessage).not.toHaveBeenCalled();
});
it('sample mode cannot save to a signed-in account',async()=>{
 render(<BidWorkspace accountKey="alice@example.test" enabled={false} />);
 const target={postMessage:vi.fn()};
 Object.defineProperty(screen.getByTitle('Early bid assessment workspace'),'contentWindow',{value:target});
 await act(async()=>{window.dispatchEvent(event(target));});
 expect(request).not.toHaveBeenCalled();
 expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({error:expect.stringContaining('Sign in')}),location.origin);
});
