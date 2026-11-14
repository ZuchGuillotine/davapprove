#!/usr/bin/env python3
"""Generate an operator-shared, one-use beta sign-in link. Sends no email.

Run with server-only SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
The output file is a credential: keep it private and do not commit or log it.
"""
import argparse
import html
import json
import os
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('email')
parser.add_argument('--redirect', default='https://davapprove-preview.delicacybydesign.workers.dev')
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
url = os.environ['SUPABASE_URL'].rstrip('/')
key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
request = urllib.request.Request(url + '/auth/v1/admin/generate_link',
    headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
    data=json.dumps({'type': 'magiclink', 'email': args.email, 'redirect_to': args.redirect}).encode())
with urllib.request.urlopen(request, timeout=30) as response:
    payload = json.load(response)
link = payload.get('action_link') or payload.get('properties', {}).get('action_link')
if not link:
    raise SystemExit('Provider did not return a sign-in link; no output written.')
args.output.parent.mkdir(parents=True, exist_ok=True)
with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as output:
    output.write('<!doctype html><meta charset="utf-8"><title>Davapprove private beta access</title>'
        '<main style="font:18px system-ui;max-width:560px;margin:80px auto;line-height:1.6">'
        '<h1>Your Davapprove workspace</h1><p>This private link signs in as '
        + html.escape(args.email) + '. It expires and can be used once. Do not publish it.</p>'
        '<p><a href="' + html.escape(link, quote=True) + '">Open Davapprove securely</a></p></main>')
print('Private one-time access file written:', args.output)
