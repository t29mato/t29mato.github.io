---
layout: post
title: "\"I Can't Get to x.com\": The Outage That Took Exactly Half the Internet"
date: 2026-09-08
description: "x.com stopped loading and everything about it said x.com's fault — until github.com turned out to be dead too and google.com was quietly connecting over IPv6. A from-scratch walk through dual stack, AAAA records, and a v6プラス router that reported Connected while its MAP-E tunnel forwarded nothing."
tags: [networking, ipv6, homelab, ai]
---

The bug report, in its entirety: "For some reason I can't get to x.com anymore. Look into it."

That is what I told the Claude Code session, and it is genuinely all I knew. What followed took maybe twenty minutes and ended with me pulling a power plug, but the diagnosis passed through DNS records, two flavors of IP address I could not have told apart beforehand, and a tunneling scheme that Japanese fibre lines use which I had been relying on for years without knowing it existed. Like the [fuse post](/2026/09/08/blown-fuse-afterg3.html), this write-up is deliberately the version that explains everything, because I could not have explained any of it myself. If you already know what MAP-E is, skim; I didn't.

## Ruling out the boring causes

When one specific site stops working, the usual suspects are local and dull, so the session checked those first. `/etc/hosts` — the file that can silently redirect a hostname to nowhere, beloved of old "block distracting websites" scripts — was clean. `scutil --proxy` showed no proxy configured. And DNS worked fine:

```
$ dscacheutil -q host -a name x.com
ip_address: 172.66.0.227
```

So my Mac knew where x.com was. It just couldn't get there:

```
$ curl https://x.com
curl: (28) Connection timed out after 15006 milliseconds
```

Same for twitter.com and api.x.com. Name resolution fine, connection dead. At this point the plausible stories were "x.com is having an outage" or "x.com is blocking me somehow," and I half believed both.

## The test that broke the theory

Then the session did the thing that actually cracked it: instead of poking at x.com harder, it tested a spread of unrelated sites side by side.

```
x.com          curl: (28) Connection timed out after 10004 milliseconds
twitter.com    curl: (28) Connection timed out after 10004 milliseconds
api.x.com      curl: (28) Connection timed out after 10005 milliseconds
google.com     code=301 ip=2404:6800:400b:c00c::71 t=0.120533
github.com     curl: (28) Connection timed out after 10001 milliseconds
```

Two things in that table. First, **github.com was dead too**, which instantly kills every theory involving x.com specifically — GitHub and X share no infrastructure worth speaking of. Second, look at the address google.com connected to: `2404:6800:400b:c00c::71`. That is not a normal-looking `172.66.0.227`-style address. It is an **IPv6** address.

Some vocabulary, because this is where I needed it. The internet runs on two parallel addressing systems. **IPv4** is the old one — addresses like `172.66.0.227`, four numbers, about 4.3 billion possible combinations, which ran out years ago. **IPv6** is the replacement — addresses like `2404:6800:400b:c00c::71`, effectively inexhaustible. A modern machine on a modern connection is **dual stack**: it holds one address of each kind and, for any given site, uses whichever kind the site offers. The two systems are separate roads to the same places. And that separateness has a nasty consequence: if one road is severed, the failure isn't total — it's *partial*, and partial in a pattern that looks like individual sites failing rather than your connection failing.

Forcing curl onto one road at a time proved it:

```
$ curl -4 https://google.com    # IPv4 only
curl: (28) Connection timed out after 8003 milliseconds

$ curl -6 https://google.com    # IPv6 only
code=301 ip=2404:6800:400b:c00c::71
```

Same site, same moment. Over IPv6, instant. Over IPv4, nothing. **My IPv4 was dead and my IPv6 was perfectly healthy.**

## Why it looked like an x.com problem

This is the part I most wanted explained, and it comes down to one kind of DNS record. When your browser asks DNS about a site, it can get back an **A record** (the site's IPv4 address) and/or an **AAAA record** (the site's IPv6 address — the name is a joke of sorts: four times wider than A). No AAAA record means the site lives on the IPv4 road only, and there is no way to reach it from the IPv6 side at all.

```
x.com        AAAA: (none)
github.com   AAAA: (none)
google.com   AAAA: 2404:6800:400b:c005::64  2404:6800:400b:c005::8a  ...
```

x.com and github.com publish no AAAA record. In 2026 that is a completely ordinary thing for even a huge site to do — IPv6 adoption on the server side is still patchy. So on a machine where IPv4 is broken and IPv6 works, **exactly the IPv4-only sites vanish and everything else feels normal**. Google, YouTube, most CDN-fronted sites kept working over IPv6, so the internet as a whole seemed fine — and the outage presented as "x.com is broken," because x.com happened to be the IPv4-only site I noticed first. The symptom names the wrong culprit by construction.

## Finding the break

So where along the IPv4 road was the cut? The Mac itself was healthy — it held a normal private IPv4 address (`192.168.0.82`) and a global IPv6 address (`240b:11:c4a2:f00:...`). The router answered instantly. Everything past the router did not:

```
$ ping 192.168.0.1        # the router
3 packets transmitted, 3 packets received, 0.0% packet loss
round-trip avg 3.583 ms

$ ping 1.1.1.1            # Cloudflare's DNS, out on the real internet
3 packets transmitted, 0 packets received, 100.0% packet loss

$ traceroute -n 1.1.1.1
 1  192.168.0.1  3.814 ms  3.313 ms  3.066 ms
 2  * * *
 3  * * *
 ...
 8  * * *
```

`traceroute` shows each router a packet passes through on the way to its destination. Hop 1 — my own router — answered. Hop 2 onward, silence. IPv4 packets were reaching the router and going no further.

## The router that said Connected

I pulled up the router's status page (a TP-Link) and pasted it into the session:

```
Internet status:        接続しました (Connected)
Connection type:        v6プラス
IP address:             106.73.196.162
Subnet mask:            255.255.255.255
Default gateway:        0.0.0.0
Primary DNS:            0.0.0.0
Uptime:                 2 hours 23 minutes
```

Connected. It had an IP address. The `255.255.255.255` subnet mask and `0.0.0.0` gateway look alarming, but it turns out they are not evidence of anything — which is part of why this page is so unhelpful — and to see why, you need to know what **v6プラス** actually is.

v6プラス is a service built on a scheme called **MAP-E**, and the reason it exists is twofold. First, the traditional way home connections in Japan reach the internet (PPPoE) funnels through equipment that gets badly congested at peak hours; the IPv6-native path (IPoE) doesn't, so ISPs want your traffic on IPv6 as much as possible. Second, IPv4 addresses ran out, so nobody wants to hand every subscriber a whole one anymore. MAP-E solves both at once: your line is natively IPv6 only, and your IPv4 traffic gets **wrapped inside IPv6 packets** — a tunnel — carried across the ISP's IPv6 network to a box called a **BR (Border Relay)**, run by JPNE, which unwraps it onto the real IPv4 internet. Your "IPv4 address" is a global address *shared* with other subscribers, with your household assigned a slice of its port numbers. That is what the `255.255.255.255` mask is hinting at: it's not really your address, it's not really a network, there's no conventional IPv4 gateway. Under MAP-E, those fields are normal.

Which also explains why "Connected" was a lie — or rather, an answer to a different question. The status page reports the IPv6 session (fine) and the address assignment (done). Nothing on it tests whether an IPv4 packet, wrapped and sent into the tunnel, actually comes out the other side. The router was truthfully reporting the health of everything except the thing that was broken.

## Proving it was the tunnel

The confirming test: ping the BR itself, over IPv6, from inside my network. If the tunnel's far end is unreachable, the problem could be JPNE's. It wasn't:

```
$ ping6 2404:9200:225:100::64
2 packets transmitted, 2 packets received, 0.0% packet loss
round-trip min/avg/max = 15.968/17.371/18.775 ms
```

The far end of the tunnel was alive and 17 ms away. Yet not one IPv4 packet was making it through:

```
$ curl -4 -m 5 -o /dev/null -w "%{http_code}\n" https://1.1.1.1
000
$ curl -4 -m 5 -o /dev/null -w "%{http_code}\n" https://8.8.8.8
000
```

So: the BR reachable, the shared IPv4 address assigned, and still nothing crossing. The remaining suspect is the stage in between — the router's own encapsulation and forwarding, which had quietly stopped doing its one job while continuing to report itself as connected. How exactly a router's firmware gets into that state, I can't tell you; the evidence doesn't reach that far. Consumer router MAP-E implementations have a known-ish reputation for this class of flakiness, and that is as much as I'm entitled to claim.

## The fix

Pull the router's power plug, count to thirty, plug it back in. Everything came back — x.com included. The physical power-cycle is deliberate: the admin UI's Reboot button is a soft restart, and tunnel state has a way of surviving those. Cutting power guarantees the MAP-E configuration is rebuilt from zero.

One suggestive detail from that status page: uptime read **2 hours 23 minutes**. Something had re-established the connection about that long before I noticed anything — and the MAP-E state evidently did not come back correctly with it. I'd bet the outage began at exactly that moment; I just didn't hit an IPv4-only site until later.

## Takeaway

The reusable lesson is a five-second test. The next time a site "goes down" for you while everything else works, check whether your IPv4 works at all before believing the site is at fault:

```
$ curl -4 -m 5 -o /dev/null -w "%{http_code}\n" https://1.1.1.1
```

If that prints `000`, your IPv4 path is gone, and every site without an AAAA record has vanished with it — however healthy the rest of your internet feels, and whatever your router's status page swears.

The other lesson is quieter. Dual stack is a redundancy scheme, and like a lot of redundancy it fails by *masking*: the working half kept enough of the internet alive that the broken half looked like one site's problem. The single move that cut through it wasn't deep knowledge — it was testing unrelated sites side by side and reading the failure's *shape* instead of its first symptom. That, and knowing that a status page reports what it measures, not what you mean by "connected."
