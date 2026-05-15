## Goal
Bypass the missing AWS port-443 rule by serving the librosa API over plain HTTP on port 80 (which we confirmed is open). No source-code changes needed — the EC2 base URL is stored as a credential (`LIBROSA_REST_URL`), so we just point it at `http://` instead of `https://`.

## Why this works
- Port 80 → reaches nginx (confirmed: returns the 301 redirect).
- Port 443 → blocked by AWS Security Group.
- Currently nginx on port 80 does `return 301 https://...`, which is why everything redirects into the dead port 443.
- We change the port-80 server block to actually proxy `/health`, `/analyze`, `/analyze_full` to the upstream service, then update the credential.

## Tradeoff
Backend-to-backend traffic (Lovable edge function → EC2) will be unencrypted. The payload is audio-analysis JSON — no PII, no user credentials — but the bearer token (`LIBROSA_REST_TOKEN`) is sent in the `Authorization` header in cleartext. Anyone on the network path between Supabase and AWS could capture it. Acceptable as a temporary unblock; revert to HTTPS as soon as port 443 is opened.

## Steps

### 1. On the EC2 box: edit nginx to serve API over HTTP on :80

Find the current config:
```bash
sudo nginx -T 2>/dev/null | grep -nE "server_name|listen|proxy_pass|return 301" | head -40
```

Edit `/etc/nginx/sites-available/<your-site>` (whatever file holds the `samc-librosa.duckdns.org` server block). Replace the **port-80 server block** that currently does the HTTPS redirect with one that proxies to the upstream service.

A clean version:
```nginx
# HTTP — serves the API directly (temporary, until SG port 443 is opened)
server {
    listen 80;
    server_name samc-librosa.duckdns.org;

    # Keep ACME challenge working so certs auto-renew
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass         http://127.0.0.1:<UPSTREAM_PORT>;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        client_max_body_size 200M;
    }
}

# Leave the existing :443 server block as-is — we'll re-enable it when SG is fixed
```

Replace `<UPSTREAM_PORT>` with whatever port the librosa Python service listens on locally (find it with `sudo ss -tlnp | grep python` or check the systemd/PM2 config). The current `:443` block already has the right `proxy_pass`, so copy it from there.

Reload:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

Test from your Mac:
```bash
curl -v http://samc-librosa.duckdns.org/healthz
```
Expect: `200 ok` (no redirect).

### 2. Update the LIBROSA_REST_URL credential

In the app, go to `/admin/integrations`, find the **librosa** provider, and change `LIBROSA_REST_URL` from:
```
https://samc-librosa.duckdns.org
```
to:
```
http://samc-librosa.duckdns.org
```
Save.

### 3. Verify end-to-end

Trigger a librosa analysis from the app (or call the `librosa-rest-test` edge function). It should now succeed. Edge-function logs will show the `http://...` request hitting the EC2 box and returning a 200.

### 4. When you're ready to revert (after port 443 is opened)

- In `/admin/integrations`, change `LIBROSA_REST_URL` back to `https://samc-librosa.duckdns.org`.
- Restore the original nginx port-80 block (the `return 301 https://...` redirect) so HTTP traffic upgrades to HTTPS.
- `sudo systemctl reload nginx`.

## Files / systems touched
- **No source-code changes** in this repo.
- EC2: `/etc/nginx/sites-available/<site>` (or `sites-enabled/`).
- App: `LIBROSA_REST_URL` credential in `/admin/integrations`.
