import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { expect, test, afterEach } from 'vitest';
import ParcelMap from './ParcelMap';
afterEach(cleanup);
const geometry = {type:'Polygon', coordinates:[[[-122,47],[-121.99,47],[-121.99,47.01],[-122,47]]]};
test('discipline visibility preserves conflicts and source inspection', () => {
 render(<ParcelMap parcel={{geometry}} sample={false} envelope={{layers:[{id:'s', label:'Septic reserve', discipline:'septic', geometry, review_status:'accepted', sheet:'S2', design_revision:'B'}], conflicts:['Civil layout overlaps septic reserve.']}} />);
 fireEvent.click(screen.getByRole('checkbox', {name:'septic'}));
 expect(screen.getByText('Civil layout overlaps septic reserve.')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', {name:'Septic reserve · accepted'}));
 expect(screen.getByText(/Source revision: B/)).toHaveTextContent('Sheet/page: S2');
 fireEvent.click(screen.getByRole('button', {name:'Zoom in'}));
 fireEvent.click(screen.getByRole('button', {name:'Fit parcel'}));
 expect(screen.getByRole('img', {name:'Interactive site envelope'})).toBeInTheDocument();
});
test('unlocated drawing remains a sheet preview with calibration issues', () => {
 render(<ParcelMap parcel={{geometry}} sample={false} envelope={{drawing_previews:[{id:'d',label:'Drainfield',page:2,document_id:'doc',calibration:'sheet_scaled',sheet_geometry:geometry,issues:['Missing geographic controls']} ]}} />);
 expect(screen.getByText('Missing geographic controls')).toBeInTheDocument();
 expect(screen.getByText(/Drawing calibration: sheet scaled/)).toBeInTheDocument();
});
test('revision selection retains uncertainty and conflicts', () => {
 const sheet={id:'civil-b',document_id:'doc',page:1,discipline:'civil',design_revision:'B',status:'proposed',transform:{},sheet_height:1,image_corners:[[-122,47.01],[-121.99,47.01],[-122,47]],fit_rms_ft:0.2,check_max_ft:1.2,accuracy_ft:null,issues:['Absolute accuracy unknown']};
 const {container}=render(<ParcelMap parcel={{geometry}} sample={false} envelope={{alignment:{registrations:[sheet]},layers:[{id:'a',label:'Earlier civil',discipline:'civil',design_revision:'A',geometry,review_status:'proposed'}],conflicts:['Review alternate revisions.']}}/>);
 expect(container.querySelectorAll('svg title')).toHaveLength(2);
 fireEvent.change(screen.getByLabelText('Drawing revision'),{target:{value:'B'}});
 expect(container.querySelectorAll('svg title')).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'civil · B · Page 1 · proposed'}));
 expect(screen.getByText(/Independent check 1.20 ft/)).toHaveTextContent('Reference accuracy unknown');
 expect(screen.getByText('Absolute accuracy unknown')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('checkbox',{name:'civil'}));
 expect(container.querySelectorAll('svg title')).toHaveLength(0);
 expect(screen.getByText('Review alternate revisions.')).toBeInTheDocument();
});
