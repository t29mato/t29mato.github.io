---
layout: post
title: "A Blown Fuse, Two Mac Minis, and the Bit That Decides Who Wakes Up"
date: 2026-09-08
description: "A breaker tripped and neither Mac mini in the homelab turned back on by itself. The macOS setting for this lives in a chip Linux cannot write, Internet Recovery would not put a picture on the screen, and the fix turned out to be one bit in one PCI register — proved with a deliberate second power cut, one machine configured and one left alone."
tags: [homelab, linux, mac-mini, firmware, ai]
---

A little after seven this evening a breaker in the apartment tripped. The [homelab](/homelab/) is two provisioned Mac minis on a shelf — mini-1, a Mid 2011 running Ubuntu, and mini-2, a Late 2012 running the same — and when the power came back, both of them just sat there, dark. I pressed both power buttons by hand, about three seconds apart, and everything booted.

That is the whole incident. The rest of this post is about what it took to make sure it never needs a finger again — which I expected to be one settings command and which instead went through two confidently wrong conclusions, a two-year-old service nobody remembered installing, a firmware dead end, and finally a single bit flipped in a chipset register. I have been leaning on Claude Code hard enough lately that I could not have explained most of these steps myself, so this write-up is deliberately the version that explains everything. If you already know what ACPI G3 means, skim; I didn't.

## Wrong answer #1: "one machine restarted itself"

The Claude Code session driving the lab checked on both machines right after the outage. mini-2 answered ping; mini-1 didn't (yet). Then it compared boot records: `last -x reboot` said mini-2 booted at **10:07** and mini-1 at **19:07**. Conclusion, delivered with confidence: mini-2 had restarted itself when the power returned, mini-1 had not, and only mini-1 needed fixing.

This was wrong, and the way it was wrong is the most instructive part of the evening. mini-1's clock runs on Japan time (`Asia/Tokyo`); mini-2's runs on UTC. 19:07 JST *is* 10:07 UTC — the two records describe the same instant. The machines behaved identically; only their clocks disagreed about what to call the moment. mini-1 simply took about a minute and a half longer to show up on the network, which is what a 2011 machine on a 5400 rpm spinning disk does.

The bitter footnote: the same session had *flagged* the timezone mismatch between the two machines earlier that same evening, as a thing worth cleaning up someday. It then walked straight into the exact trap it had described.

What caught the error wasn't a log. It was me saying: **"I pressed the button on both."** That fact existed nowhere in any file on any machine — it existed in my thumb. Once it was on the table, the session went looking for timezone-proof evidence and found it in `/proc/stat`, whose `btime` field records the boot moment in epoch seconds — a raw count of seconds since 1970, the same number no matter what timezone the machine dresses it in:

```
mini-1  btime 1788862069
mini-2  btime 1788862066
```

Three seconds apart. The interval between two button presses. Epoch seconds don't care what city your clock thinks it lives in.

So: neither machine restarts itself after a power cut, both needed fixing, and `last` — which patches its own records after a crash and speaks whatever local time it feels like — is a witness, not evidence.

## The stranger that came back with the power

While poking around mini-1's process list, the session found `ollama` running — a local LLM server. I have never installed ollama. Except I have: the trail showed it was installed on **2024-07-20 at 15:33** by the official install script, served **17 API requests** that same afternoon — the last one a `POST /api/chat` that took twenty minutes and thirteen seconds to answer, which on a 2011 Mac mini is about right — and then was never spoken to again. For over two years it sat there `enabled` with `Restart=always`, holding roughly **half a gigabyte** of resident memory on an 8 GB machine, with a 4.4 GB `llama3` model on disk. Tonight's outage didn't just restart my machines; it faithfully resurrected a service I'd forgotten existed.

Two things about this are worth keeping. First: the [inventory page](/homelab/) of this very site *does* list ollama, with a note explaining it's written down precisely because it holds half a gigabyte. The repository remembered what I did not. Records cut both ways tonight — `last` misled us, the inventory told the truth, and I was the only witness for the button presses.

Second, a small permissions lesson from the removal. `sudo ollama rm llama3:latest` failed with *permission denied*, which looks absurd — what can't sudo do? But `ollama rm` is a **client**: it sends a request to the ollama **server**, and it's the server — running as its own low-privilege `ollama` user — that actually deletes the files. The model directory happened to be owned by my user, so the server had no write permission to it. `sudo` had elevated the messenger, not the worker. ollama is gone from mini-1 as of 20:38 this evening (binary, service, system user, and model all verified absent), removed the ordinary way once the ownership was straightened out.

## Where the real setting lives, and why Linux can't reach it

Apple documents exactly the feature I wanted: `pmset -a autorestart 1`, "restart automatically after a power failure". The catch is where that setting is stored. It lives in the **SMC** — the System Management Controller, a small always-on computer inside every Intel Mac that runs *underneath* the operating system and manages power, fans, and the power button itself. This is what "firmware" means in this post: software that belongs to the machine rather than to whatever OS you installed, running before and below it. The SMC only takes instructions from Apple's tools, and Apple's tools only run on macOS.

Both minis had macOS wiped when Ubuntu went on. Not just the OS — the disks don't even have an Apple recovery partition anymore (`lsblk` on either machine shows a plain EFI partition plus Linux, nothing else). And from the Linux side there is genuinely no path in: the `applesmc` driver exposes the SMC's fans and temperature sensors but no power-policy knobs, and the EFI variable store holds only boot-device entries. The setting is real, documented, and unreachable.

Two workarounds were tried before the real one:

**Internet Recovery.** Intel Macs can boot a minimal macOS over the network by holding ⌘⌥R at power-on — on the Windows keyboard plugged into the lab, that's **Win + Alt + R**. Held keys, powered on, and the monitor reported *no signal*. The same monitor shows the boot sequence fine when the machine boots normally into Linux. The keyboard was working — holding the keys visibly changed the machine's behavior — so the diagnosis is the firmware's video path. At power-on, the Mac's EFI asks the monitor what it can display (a self-description called EDID), picks a single video mode, and never renegotiates. If that one handshake fails, firmware screens stay black forever. Linux's display driver succeeds on the same cable because it keeps retrying and renegotiating — one of those places where the OS is simply more stubborn than the firmware beneath it. Dead end.

**Wake-on-LAN.** Suggested by the session, then retracted by the session, and the retraction reasoning is worth recording: WoL works by leaving the network card powered and listening when the machine shuts down. After a breaker trip there *was* no shutdown — the mains vanished mid-sentence — so when power returns the card was never armed and nothing is listening. WoL can revive a machine that was turned off properly, which is precisely not the situation.

## One bit, in a register that survives everything

The fix that worked came from outside the session entirely — a tip I carried back from another conversation: skip the SMC. The thing PC motherboards call **"Restore on AC Power Loss"** in their BIOS menus exists in Intel's chipset itself, and Linux can write it directly.

Some vocabulary, because this is the part I wanted explained to me. Every PCI device in a computer — and the chipset's internal functions count as PCI devices — carries a small table of numbered settings called its **configuration space**: 256 bytes you can read and write by address, like labeled pigeonholes. A **register** is a named slot in that table. On mini-2's chipset (Intel HM77 — the "ISA bridge" at PCI address `00:1f.0`), the register at offset `0xA4` is called **GEN_PMCON_3**, and its lowest **bit** — a single binary digit, the smallest setting a computer has — is named **AFTERG3_EN**.

The name decodes like this. ACPI, the power-management standard, names the power states: **S0** is running, **S5** is "soft off" — off, but plugged in, with standby power alive (what your desktop is overnight) — and **G3** is *mechanical* off: the plug pulled, the breaker tripped, no electrons at all. AFTERG3_EN answers one question: **when power returns after G3, where does the machine go?** And the values run backwards from intuition: **1 means S5** — stay off and wait for the button — while **0 means S0**: boot. The "EN" enables *staying off*. So to make the machine self-starting you *clear* the bit to zero. Crucially, this register sits in the chipset's **RTC well** — the tiny corner of the chip kept alive by the clock battery, the same one that remembers the time — so the value survives reboots and power cuts alike.

The command, run on mini-2:

```
$ sudo setpci -v -s 00:1f.0 0xa4.b=0:1
0000:00:1f.0 @a4 09->(00:01)->08
```

The `=0:1` form matters more than it looks. It means "write 0, but only through mask 1" — touch bit 0, leave the other seven bits of the byte alone. The widely copied one-liner uses plain `=0`, which zeroes the *whole byte* — and bit 1 of this same register is `PWR_FLR`, a "power failure occurred" status flag with write-1-to-clear semantics, sitting next to other state you have no reason to disturb. The output above shows the masked write doing exactly one thing: the byte read `09` (binary `1001`), and became `08` (binary `1000`). One bit changed. The one.

A register write doesn't survive being re-imaged, though, so it's re-asserted at every boot by a five-line systemd unit — a `oneshot` service that runs the `setpci` line once during startup and exits. (The version of the unit that arrived with the tip had both `After=multi-user.target` and `WantedBy=multi-user.target` — "start me as part of X, after X finishes", a small contradiction — so the `After=` was dropped.) It's fair to ask how a service that runs *at boot* helps during a power cut, when the machine goes down without running anything. It helps because of the RTC well: the bit was cleared minutes after boot and *stays* cleared through the outage, precisely because a mains loss gives nothing the chance to change it back.

## The experiment

The original tip came with a warning that the SMC might overwrite the bit. There was also my own track record for the evening: one confident conclusion had already died on contact with a fact. So rather than trust the reasoning, we ran the experiment — A/B, one variable: **mini-2 configured, mini-1 deliberately left untouched.** Both machines unplugged, both plugged back in. Nobody touched a power button; I confirmed that out loud this time, since that testimony had turned out to be the load-bearing kind.

A watcher on the laptop pinged both machines through the whole thing (times UTC, straight from its log):

| | mini-2 (bit cleared) | mini-1 (untouched) |
|---|---|---|
| lost power | 12:08:06 | 12:09:13 |
| power restored | together | together |
| booted | **12:10:45** (`btime`) | — |
| answering ping | 12:11:06 | — |

mini-2 came back **on its own**. mini-1 — same outage, same power strip, same everything — stayed dark until I eventually pressed its button a few minutes later. The only difference between the two machines was one bit, so one bit is the answer. And on mini-2's fresh self-started boot, the systemd unit had already re-run: exit timestamp 12:11:02, `Result=success`, bit re-armed for next time. The SMC-overwrite worry didn't materialize, at least on this machine on this evening.

## Still open

Honesty section — none of this is finished:

- **mini-1 is half done.** Its register got the same write later that night, and the fix ported: the HM65 is a generation older than mini-2's HM77, but the byte at `0xA4` read `09` and became `08`, exactly as on the newer chipset. What it doesn't have yet is the systemd unit to re-assert the bit at boot, and it hasn't earned the only proof that counts — its own power cut.
- **The timezone mismatch that caused wrong answer #1 is still there** — mini-1 on `Asia/Tokyo`, mini-2 on `Etc/UTC`. Tonight made the case for UTC on both about as vividly as it can be made.
- **mini-2's clock isn't actually syncing.** `timedatectl` shows `NTPSynchronized=no`; it's pointed at a time server that has answered zero packets, ever. The machine that runs on UTC is also the one guessing what time it is.
- **mini-1 runs hot.** It was uncomfortably hot to the touch after the outage. Minutes after a fresh idle boot tonight the CPU package already read 64 °C with the fan sitting at its 1,800 rpm floor — Linux gets none of macOS's thermal management, so the SMC's conservative default fan curve is all there is. The `applesmc` driver does expose the fan's speed and a manual-control switch, so this is fixable. Not yet measured properly, not yet fixed.

## Takeaway

The technical lesson is small and useful: on an Intel Mac running Linux, "restart after power failure" is `setpci -s 00:1f.0 0xa4.b=0:1` re-applied at boot, and you verify it by pulling the plug — with a control machine, because that's what turned "we think" into "we know".

The other lesson is the one I keep turning over. The AI session produced a wrong answer that had everything going for it — two timestamps, a plausible mechanism, internal consistency — and it produced the correction too, `btime`, three seconds, case closed. What it could not produce was the reason to go looking: *I pressed both buttons.* That fact lived in nobody's logs. The machines remembered what I forgot (a two-year-old ollama install, written in my own inventory), and I remembered what the machines never knew. Neither of us was a sufficient witness alone, which is either a warning about leaning on the tools or a decent working definition of collaboration. Tonight it was both.
