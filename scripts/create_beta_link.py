#!/usr/bin/env python3
"""Grant beta access and write a private, one-use sign-in link. Sends no email.

Run with server-only SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
The output file is a credential. Keep it private and send it only to the intended tester.
"""
import argparse
import html
import json
import os
from pathlib import Path
from urllib.parse import urlencode
import urllib.request


ORIGINS = ("https://davapprove.com", "https://davapprove-preview.delicacybydesign.workers.dev")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email")
    parser.add_argument("--redirect", default=ORIGINS[0], type=lambda value: value.rstrip("/"), choices=ORIGINS)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("The output file already exists. Choose a new private filename.")
    args.output.parent.mkdir(parents=True, exist_ok=True)

    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}

    def auth_request(path, method, data):
        request = urllib.request.Request(
            url + "/auth/v1/admin" + path, headers=headers, method=method, data=json.dumps(data).encode()
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    redirect = args.redirect + "/"
    payload = auth_request("/generate_link?" + urlencode({"redirect_to": redirect}), "POST", {
        "type": "magiclink", "email": args.email.strip(), "redirect_to": redirect,
    })
    user = payload.get("user") or payload
    link = payload.get("action_link") or payload.get("properties", {}).get("action_link")
    if not link or not user.get("id"):
        raise SystemExit("Supabase did not return an account and sign-in link.")
    metadata = {**(user.get("app_metadata") or {}), "davapprove_beta": True}
    account = auth_request("/users/" + user["id"], "PUT", {"app_metadata": metadata})
    if account.get("app_metadata", {}).get("davapprove_beta") is not True:
        raise SystemExit("Could not confirm that beta access was granted.")

    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
        output.write(
            '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer">'
            '<title>Davapprove beta invitation</title>'
            '<main style="font:18px system-ui;max-width:560px;margin:80px auto;line-height:1.6">'
            '<h1>Your Davapprove beta access</h1><p>This private link signs in as '
            + html.escape(args.email) + '. It expires and can be used once. Keep it private.</p>'
            '<p><a href="' + html.escape(link, quote=True) + '">Open Davapprove</a></p></main>'
        )
    print("Private one-time access file written:", args.output)


if __name__ == "__main__":
    main()
