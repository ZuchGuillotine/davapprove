"""Kitsap public permit attachment metadata; never fetch PDFs during discovery."""
import re
from html.parser import HTMLParser
from urllib.parse import urljoin

BASE = 'https://co-kitsap-wa.smartgovcommunity.com'
SOURCE = 'Kitsap county permit attachments'
UUID = r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}'

class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.links=[]; self.current=None; self.context=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a':self.current={'attrs':dict(attrs),'text':'','context':' '.join(self.context[-20:])}
    def handle_data(self,data):
        value=data.strip()
        if value:self.context.append(value)
        if self.current:self.current['text']+=data
    def handle_endtag(self,tag):
        if tag=='a' and self.current:
            self.links.append(self.current);self.current=None

def parcel_ids(html):
    parser=Links();parser.feed(html)
    ids=[]
    for a in parser.links:
        match=re.search(r"Detail/("+UUID+r")",a['attrs'].get('onclick',''))
        if match and match[1] not in ids:ids.append(match[1])
    return ids

def attachments(html, parcel_number, detail_url):
    parser=Links();parser.feed(html);found=[];case=None
    for link in parser.links:
        title=link['text'].strip()
        if title.startswith('View case '):case=title.removeprefix('View case ')
        href=link['attrs'].get('href','')
        match=re.fullmatch(r'/Blob/('+UUID+r')',href,re.I)
        if not match or not title.lower().endswith('.pdf'):continue
        category='ecology' if re.search('wetland|environmental|sepa',title,re.I) else 'survey' if re.search('plat|survey|closure',title,re.I) else 'septic' if re.search('septic|health',title,re.I) else 'civil'
        found.append({'id':'county-'+match[1],'external_id':match[1], 'title':title,
            'source':SOURCE,'url':detail_url,'document_url':urljoin(BASE,href),
            'parcel_number':parcel_number,'permit_number':case,'category':category,
            'status':'Source attachment; applicability and revision not reviewed',
            'submission_context':link['context'][-1500:],
            'match_reason':'Exact formatted tax parcel search; public parcel attachment',
            'retrieval_method':'county_blob','access':'automated','size_bytes':None,
            'access_method':'selected PDF download'})
    return found
