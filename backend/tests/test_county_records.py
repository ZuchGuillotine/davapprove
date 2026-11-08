import pytest
from app.county_records import parcel_ids,attachments
from app import sources
ID='bfce900e-23b5-4e31-8cac-a3fd01730d63'

def test_search_and_metadata_do_not_require_downloads():
 assert parcel_ids(f'<a onclick="FormSupport.submitAction( \'Detail/{ID}\' );">parcel</a>')==[ID]
 html=f'<a>View case 24-04415</a><p>Submitted first review</p><a href="/Blob/{ID}">Wetland Assessment.pdf</a><a href="https://evil.test/a.pdf">bad.pdf</a>'
 result=attachments(html,'04260110252000','https://example.test')
 assert len(result)==1 and result[0]['permit_number']=='24-04415'
 assert result[0]['category']=='ecology' and result[0]['retrieval_method']=='county_blob'
 assert 'first review' in result[0]['submission_context']

def test_county_query_uses_formatted_id(monkeypatch):
 import asyncio
 calls=[]
 async def request(client,method,url,**kwargs):
  calls.append(url)
  if 'ParcelSearch?' in url:return f'<a onclick="Detail/{ID}">parcel</a>'.encode(),'text/html'
  return f'042601-1-025-2000<a href="/Blob/{ID}">Survey.pdf</a>'.encode(),'text/html'
 monkeypatch.setattr(sources,'_request',request)
 candidates,coverage=asyncio.run(sources._discover_county({'parcel_number':'04260110252000'}))
 assert '042601-1-025-2000' in calls[0]
 assert len(calls)==2 and len(candidates)==1
 assert not any('/Blob/' in u for u in calls)
 assert coverage['status']=='partial'

def test_county_storage_redirect_cannot_cross_tenants():
 import asyncio
 with pytest.raises(sources.SourceError):
  asyncio.run(sources._validate_url('https://paladin-sg-prod-blobs.s3.amazonaws.com/jur-blobs/other/Note/'+ID))
