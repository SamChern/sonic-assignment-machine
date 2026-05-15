## Diagnosis so far

- `https://127.0.0.1/healthz` from the box → **200 OK** (TLS + nginx are healthy).
- `https://samc-librosa.duckdns.org/healthz` from your Mac → TCP connects to `35.94.20.4:443`, then TLS handshake **hangs** until timeout (`SSL_ERROR_SYSCALL`).
- DNS is correct, cert files exist, nginx config is valid, port 443 is listening.

When TCP completes but the TLS `ServerHello` never arrives, the usual cause is **packet drops mid-handshake** — almost always one of:

1. **MTU / MSS mismatch** on the EC2 ENI (the ServerHello + cert chain is ~4 KB and gets fragmented; if PMTUD is broken, those packets are dropped silently).
2. **AWS Network ACL** allowing inbound 443 SYN but blocking the ephemeral return port range (Security Groups are stateful, NACLs are not — a custom NACL is the classic cause).
3. **fail2ban / ufw / iptables** on the box dropping outbound large packets to your Mac's IP after the SYN-ACK.
4. A second `:443` server block (the IP-based one in your `nginx -T` output) being picked as the default for SNI-less or unexpected requests — less likely since curl sends SNI, but worth ruling out.

## Plan

### Step 1 — Run these on the EC2 box to localize the failure

```bash
# 1a. Curl the public hostname FROM the box itself (bypasses your Mac's network entirely)
curl -vk --resolve samc-librosa.duckdns.org:443:35.94.20.4 \
  https://samc-librosa.duckdns.org/healthz 2>&1 | tail -20

# 1b. Check MTU on the primary interface
ip link show | grep -E "mtu|state UP"

# 1c. Check for firewall rules that might drop large packets
sudo iptables -L -n -v | head -40
sudo ufw status 2>/dev/null || echo "ufw not active"
sudo systemctl status fail2ban --no-pager 2>/dev/null | head -5 || echo "no fail2ban"

# 1d. Watch nginx access + error logs while your Mac retries
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log
# (in another window on your Mac, run the failing curl, then Ctrl-C the tail)
```

### Step 2 — Check AWS console

In the AWS console for instance `i-xxxx` (35.94.20.4):

- **Security Group → Inbound**: confirm `TCP 443` is allowed from `0.0.0.0/0` (you said this is set — re-confirm).
- **Subnet → Network ACL → Inbound + Outbound**: confirm both directions allow `TCP 443` and the **ephemeral port range `1024-65535`**. If you're using the AWS default NACL it's wide open; if it's custom, this is very likely your problem.

### Step 3 — Apply the fix based on what Step 1 + 2 reveal

| Finding | Fix |
|---|---|
| 1a works (box → its own public name OK) | Problem is between AWS and your Mac's ISP — try from a phone hotspot to confirm; if hotspot works, it's your local network/VPN. |
| 1a also hangs | Problem is on the box itself (firewall/MTU). Lower MTU: `sudo ip link set dev ens5 mtu 1400` and retest. If that fixes it, persist via netplan. |
| iptables shows DROP rules | Flush the offending chain or add an explicit ACCEPT for established 443. |
| Custom NACL is missing ephemeral outbound | Add allow rule for `TCP 1024-65535` outbound to `0.0.0.0/0`. |
| Access log shows the handshake never reached nginx | Confirms it's network-layer (NACL/MTU), not nginx. |

### Step 4 — After the fix

Re-run from your Mac:
```bash
curl -v https://samc-librosa.duckdns.org/healthz
```
Expect a `200 ok`. Then retry the `/librosa-rest/health` call with the bearer token.

## What I need from you

Paste the output of **Step 1 (a–d)** and confirm what your **NACL** looks like (or screenshot it). With those I can tell you the exact one-line fix.