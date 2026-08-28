# Step 2 walkthrough — install the semantic service on your EC2 box

Plain-language version of `README.md`. No prior CLI experience assumed. Every
block below is meant to be copy-pasted exactly, one block at a time, and you read
what comes back before moving on.

Two rules that make this safe:

1. **Nothing here touches the app.** You are adding a *second* service next to
   the librosa one, with its own folder, its own Python environment and its own
   port. If it fails, the existing pipeline keeps working.
2. **If a command's output looks wrong, stop and paste it into the chat.** Don't
   run the next block hoping it fixes itself.

Set aside about 45 minutes. Most of it is waiting on downloads.

---

## What you're installing, in one paragraph

Today the app describes audio using metadata and text. Step 2 adds a model
(**CLAP**) that listens to sound itself and turns it into a 512-number
"fingerprint", plus a small translator ("the bridge") that converts those 512
numbers into the 1536-number format the rest of your database already uses. The
service sits on your EC2 box behind the web server you already have, protected by
a password-like token.

---

## 0. Before you start — collect two things

* **Your EC2 host name** — the address you already use for librosa, e.g.
  `ec2-54-1-2-3.us-west-2.compute.amazonaws.com` or your own domain.
* **Your SSH key file** — the `.pem` file you use to log into the box.

Throughout, replace `<host>` with the address and `<key.pem>` with the key path.

---

## 1. Copy the installer up to the box

Run this **on your own computer**, from the project folder:

```bash
scp -i <key.pem> -r deploy/semantic-svc ubuntu@<host>:/tmp/
```

What it does: copies the eight files in `deploy/semantic-svc/` into the box's
temporary folder. You should see a list of file names with `100%` next to each.

---

## 2. Log into the box

```bash
ssh -i <key.pem> ubuntu@<host>
```

Your prompt changes to something like `ubuntu@ip-10-0-1-23:~$`. Every command
from here until step 7 runs **on the box**.

---

## 3. Run the installer

```bash
sudo bash /tmp/semantic-svc/install.sh
```

This is the long one — **10 to 20 minutes**, sometimes more. It is normal for it
to look frozen while the model downloads (about 2 GB). It prints a running
commentary:

| Line you'll see | What's happening |
| --- | --- |
| `==> apt deps` | installing audio libraries |
| `==> venv` | building an isolated Python environment |
| (long pause) | downloading PyTorch, ~200 MB |
| `==> auth token` | generating the service password |
| `==> warm the CLAP checkpoint` | downloading the model, ~2 GB — the longest wait |
| `==> systemd` | registering the service so it restarts on reboot |
| `==> waiting for :8769` then `up` | **success** |

At the end it prints a JSON health line and a "NEXT STEPS" box. If you see `up`
and JSON, step 3 worked.

**If it fails:** re-running the same command is safe — it picks up where it left
off. If it fails twice, copy the last 20 lines into the chat.

---

## 4. Copy your token somewhere safe

```bash
sudo cat /etc/semantic-svc.token
```

This prints a 64-character string. That is the password for this service. Copy it
into your password manager now — you need it twice below.

Treat it like a key: don't paste it into a public place, don't email it.

---

## 5. Open the service to the outside (web server config)

The service currently only answers requests from inside the box. This step lets
the app reach it at `https://<host>/semantic/...`.

**5a. Find the config file that already handles librosa:**

```bash
sudo grep -rl "librosa-rest" /etc/nginx/sites-available/
```

It prints one file path — call it `<conf>`. (Usually
`/etc/nginx/sites-available/default` or `.../librosa-rest`.)

**5b. Make a backup, because you're about to edit it:**

```bash
sudo cp <conf> <conf>.bak-$(date +%F)
```

**5c. Open it in a simple editor:**

```bash
sudo nano <conf>
```

`nano` is a plain text editor. Arrow keys move around; there is no mouse.
`Ctrl+O` then `Enter` saves. `Ctrl+X` exits.

**5d. Paste two pieces in, in the right places.**

First piece — goes at the **very top of the file**, above everything else. Paste
this, then replace `TOKEN_GOES_HERE` with the token from step 4:

```nginx
map $http_authorization $semantic_auth_ok {
    default                  0;
    "Bearer TOKEN_GOES_HERE" 1;
}
limit_req_zone $binary_remote_addr zone=semantic_svc:10m rate=5r/s;
upstream semantic_svc_upstream {
    server 127.0.0.1:8769 max_fails=3 fail_timeout=15s;
    keepalive 8;
}
```

Second piece — goes **inside** the block that starts with `server {` and contains
`listen 443 ssl`. Scroll until you find the existing `location /librosa-rest/ {`
… `}` section, and paste this immediately after its closing `}`:

```nginx
    location /semantic/ {
        if ($semantic_auth_ok = 0) {
            return 401 '{"error":"missing or invalid Bearer token"}';
        }
        limit_req zone=semantic_svc burst=10 nodelay;
        rewrite ^/semantic/(.*)$ /$1 break;
        proxy_pass         http://semantic_svc_upstream;
        proxy_http_version 1.1;
        proxy_set_header   Connection        "";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 3m;
        proxy_send_timeout 3m;
        client_max_body_size 16m;
    }
```

Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`.

**5e. Check your work before applying it:**

```bash
sudo nginx -t
```

You want: `syntax is ok` and `test is successful`. If you get an error, it names
a line number — reopen the file and check that piece. Worst case, restore the
backup: `sudo cp <conf>.bak-$(date +%F) <conf>`.

**5f. Apply it:**

```bash
sudo systemctl reload nginx
```

Silence means success.

---

## 6. Prove it works

```bash
bash /tmp/semantic-svc/smoke-test.sh https://<host>/semantic "$(sudo cat /etc/semantic-svc.token)"
```

This runs four checks and prints a pass/fail line for each:

1. the service answers,
2. text turns into 512 numbers,
3. the bridge turns 512 into 1536,
4. similarity survives the bridge — the check that proves the maths is right.

All four must pass. `401` on any of them means the token in the nginx file
doesn't match `/etc/semantic-svc.token`; `502` means the service isn't running
(see step 8).

---

## 7. Point the app at it

Back in SonicSIM, in your browser:

**Admin → APIs & MCPs → Needs setup → Semantic service**

Fill in:

* **Base URL:** `https://<host>/semantic`
* **Token:** the token from step 4

Save, then press **Test**. A green result means the app and the box are talking.
Nothing else in the app needs changing — the edge functions read this URL and
token from the credentials manager.

---

## 8. Day-to-day operations

Run these on the box whenever you're curious or something looks off:

```bash
systemctl status semantic-svc        # is it running?
journalctl -u semantic-svc -f        # live logs; Ctrl+C to stop watching
sudo systemctl restart semantic-svc  # restart it
```

Two things worth knowing:

* The **first request after a restart is slow** (30–60 seconds) because the model
  loads into memory. That is expected, not a fault.
* Your box has **2 CPUs, 7 GB of RAM and no GPU**. The config deliberately keeps
  this service to one worker and 3 GB so it can't starve librosa or nginx.
  Realistic throughput: roughly 10–20 text embeddings per second when batched,
  1–3 audio embeddings per second. If audio embedding becomes your bottleneck,
  that is the moment to move **this one service** to a GPU instance — not to add
  more workers here.

---

## 9. About the bridge (why you can ship this today)

The bridge currently uses an "identity stub": it repeats the 512 numbers three
times and re-normalizes them. That sounds like a cheat, but it has an exact
mathematical property — the similarity between two fingerprints is unchanged by
the operation. So your nearest-neighbour rankings are already correct; a trained
bridge (Step 8) will make them *sharper*, not different in kind. You do not have
to wait for training to start using sound-grounded embeddings.

When Step 8 trains real weights, they get uploaded and switched on with a
database row (`public.embedding_bridges` → `is_active`). No redeploy, no code
change, no downtime on this box.

---

## Quick reference

| Thing | Value |
| --- | --- |
| Port (internal only) | `8769` |
| Public path | `https://<host>/semantic/` |
| Install folder | `/opt/semantic-svc` |
| Token file | `/etc/semantic-svc.token` |
| Service name | `semantic-svc` |
| Re-run installer | `sudo bash /tmp/semantic-svc/install.sh` (safe, idempotent) |
