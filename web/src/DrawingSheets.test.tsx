import { render,screen,fireEvent,cleanup } from '@testing-library/react';
import { test,expect,afterEach,vi } from 'vitest';
import DrawingSheets from './DrawingSheets';
vi.mock('./api',()=>({loadSheetImage:vi.fn().mockResolvedValue('blob:sheet')}));
afterEach(cleanup);
const features=[{id:'a',label:'Boundary',discipline:'survey',sheet_geometry:{type:'Polygon',coordinates:[[[.1,.1],[.8,.1],[.8,.6],[.1,.1]]]}},{id:'b',label:'Drainfield',discipline:'septic',sheet_geometry:{type:'Point',coordinates:[.3,.4]}}];
const sheets=[{id:'doc:1',document_id:'doc',page:1,title:'Site plan',features},{id:'doc:2',document_id:'doc',page:2,title:'Details',features:[features[1]]}];
test('all outlines appear immediately, grouped by page with feature inspection',()=>{
 const {container}=render(<DrawingSheets sheets={sheets} sample/>);
 expect(container.querySelectorAll('[data-feature-id]')).toHaveLength(2);
 fireEvent.change(screen.getByLabelText('Inspect drawing feature'),{target:{value:'b'}});
 expect(screen.getByText(/confirm orientation, scale and a site anchor/)).toBeInTheDocument();
 fireEvent.click(screen.getByLabelText('septic outlines'));
 expect(container.querySelectorAll('[data-feature-id]')).toHaveLength(1);
 fireEvent.change(screen.getByLabelText('Source drawing'),{target:{value:'doc:2'}});
 expect(container.querySelectorAll('[data-feature-id]')).toHaveLength(1);
 expect(screen.getByText(/0 of 1 features have a site placement/)).toBeInTheDocument();
});
test('page aspect controls the y-up overlay without stretching sheet coordinates',async()=>{
 const revoke=vi.fn();vi.stubGlobal('URL',{revokeObjectURL:revoke});
 const {container,unmount}=render(<DrawingSheets sheets={sheets} sample={false} projectId="p"/>);
 await screen.findByText(/3 extracted features/);
 const img=container.querySelector('img')!;
 Object.defineProperties(img,{naturalWidth:{value:1000},naturalHeight:{value:600}});
 fireEvent.load(img);
 expect(screen.getByRole('img',{name:'Extracted geometry on source sheet'})).toHaveAttribute('viewBox','0 0 1000 600');
 expect(container.querySelector('g')).toHaveAttribute('transform','translate(0 600) scale(1000 -1000)');
 unmount();expect(revoke).toHaveBeenCalledWith('blob:sheet');vi.unstubAllGlobals();
});
