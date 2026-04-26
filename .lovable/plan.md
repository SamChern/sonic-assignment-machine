## Problem

The user ran `curl -O` against `raw.githubusercontent.com/SamChern/sonic-assignment-machine/main/deploy/librosa-mcp/...` URLs. Those returned **404** (the GitHub repo path doesn't exist or is private), and `curl -O` saved each 404 HTML page to disk under the expected filename. So `~/sam-api/librosa-mcp/install.sh` is now a 1-line file containing literally `404: Not Found`, which is why bash errored with `./install.sh: 1: 404:: not found`.

The real `install.sh` (and the other 5 files: `server_extended.py`, `librosa-mcp.service`, `nginx-librosa-mcp.conf`, `smoke-test.sh`, `README.md`) live in **this Lovable workspace** at `deploy/librosa-mcp/`, not in any public GitHub repo.

Also: the user typed `EMAIL=sam.chernoff@github` — invalid email, Let's Encrypt will reject it. They need `sam.chernoff@gmail.com` (or any real address).

## Plan

### 1. Verify the corrupted files on EC2 (user runs locally)
Ask the user to confirm with `head -3 install.sh` that the file is the 404 HTML, so we know we're solving the right problem before nuking anything.

### 2. Switch to default mode and produce a single bootstrap script
Create a new file `deploy/librosa-mcp/bootstrap-from-lovable.sh` in this workspace. This script, when run on the EC2 box, will:
- `rm -rf ~/sam-api/librosa-mcp/*` to clear the corrupted files
- `cat <<'EOF' > install.sh ... EOF` — inline the **full real contents** of all 6 files using heredocs (the files are small: install.sh ~120 lines, server_extended.py ~300 lines, the others <50 lines each)
- `chmod +x install.sh smoke-test.sh`
- Print clear next-step instructions ending with the corrected `sudo HOSTNAME=... EMAIL=... ./install.sh` command

This avoids any dependency on GitHub auth, public hosting, or `scp` from the user's laptop. The user will paste **one** command on EC2 and have a working deploy kit.

### 3. Deliver the bootstrap script to the user
The single command for the user will be a `cat <<'BOOTSTRAP' > /tmp/bootstrap.sh ... BOOTSTRAP` block they paste into their EC2 SSH session, followed by `bash /tmp/bootstrap.sh`. Or — even simpler — I'll write the bootstrap script's contents directly into the chat message wrapped in one heredoc block they paste verbatim.

### 4. Provide the corrected installer command
After bootstrap succeeds, user runs:
```bash
cd ~/sam-api/librosa-mcp
sudo HOSTNAME=samc-librosa.duckdns.org EMAIL=sam.chernoff@gmail.com ./install.sh
```
(Note the corrected `gmail.com` instead of `@github`.)

### 5. Pre-flight DNS check
Before step 4, remind the user to verify `dig +short samc-librosa.duckdns.org` returns `35.94.20.4` from their laptop — otherwise certbot will fail at the TLS step.

## Files to be created
- `deploy/librosa-mcp/bootstrap-from-lovable.sh` — self-contained bootstrap that writes all 6 real files into place on EC2, no network downloads needed.

## Files to be read first (to inline their contents into the bootstrap)
- `deploy/librosa-mcp/install.sh` (already partially visible in context)
- `deploy/librosa-mcp/server_extended.py`
- `deploy/librosa-mcp/librosa-mcp.service`
- `deploy/librosa-mcp/nginx-librosa-mcp.conf`
- `deploy/librosa-mcp/smoke-test.sh`
- `deploy/librosa-mcp/README.md`

## No app code changes
This plan only adds one shell script under `deploy/librosa-mcp/`. No changes to the React app, edge functions, or database. The `/admin/integrations` UI is already in place and ready to receive the MCP URL + token once the install completes.

## Outcome
User pastes one block into their EC2 SSH session → real files appear → re-runs `install.sh` with the corrected email → gets the success banner with MCP URL + Bearer token → pastes into `/admin/integrations` → green "Connection OK" check.