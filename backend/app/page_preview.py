"""Private, bounded page rendering. Authentication and project checks happen first."""
import asyncio
import subprocess
import tempfile
from pathlib import Path
import httpx
from fastapi import HTTPException

RENDER_LOCK=asyncio.Semaphore(1)

async def page_image(settings, document, token, page):
    if not 1 <= page <= min(document.get('page_count',0),500):raise HTTPException(422,'Page is outside the imported document.')
    digest=document.get('sha256','')
    if len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest):raise HTTPException(409,'Document processing must finish before alignment.')
    cache=settings.data_dir/'page-previews'/f'{digest}-{page}-1600-v1.png'
    async with RENDER_LOCK:
        if cache.exists():return cache
        key=document['storage_path']
        if key != f"{document['project_id']}/{document['id']}.pdf":raise HTTPException(404,'Document unavailable.')
        if settings.mode=='demo':
            data=(settings.data_dir/'files'/key).read_bytes()
        else:
            async with httpx.AsyncClient(timeout=45) as client:
                chunks=[];size=0
                async with client.stream('GET',settings.supabase_url+'/storage/v1/object/authenticated/'+settings.bucket+'/'+key,
                    headers={'apikey':settings.publishable_key,'Authorization':'Bearer '+token}) as r:
                    if r.status_code!=200:raise HTTPException(502,'Document unavailable.')
                    async for chunk in r.aiter_bytes():
                        size+=len(chunk)
                        if size>settings.max_pdf_bytes:raise HTTPException(413,'Document exceeds preview limit.')
                        chunks.append(chunk)
                data=b''.join(chunks)
        if len(data)>settings.max_pdf_bytes or not data.startswith(b'%PDF-'):raise HTTPException(422,'Invalid preview document.')
        def render():
            with tempfile.TemporaryDirectory(prefix='davapprove-preview-') as temp:
                src=Path(temp)/'source.pdf';src.write_bytes(data)
                out=Path(temp)/'page'
                subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-singlefile','-scale-to','1600','-png',str(src),str(out)],
                    check=True,timeout=25,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                cache.parent.mkdir(parents=True,exist_ok=True)
                temp_output=cache.with_suffix('.tmp');temp_output.write_bytes(out.with_suffix('.png').read_bytes());temp_output.replace(cache)
        try:await asyncio.to_thread(render)
        except (OSError,subprocess.SubprocessError):raise HTTPException(422,'Page rendering failed; check the source PDF.')
    return cache
