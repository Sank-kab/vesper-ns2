# Vesper *(Beta)*

> **LEGAL & ANTI-PIRACY NOTICE:** This project is an open-source desktop frontend for managing ExeFS/RomFS profiles intended strictly for research, user-created content, and legally owned software dumped from your own hardware. **No copyrighted files, games, keys, firmware, or signed console metadata (`.npdm`) are included, hosted, or linked in this repository.** Piracy is not supported or condoned.
>
> **BETA & NO-WARRANTY DISCLAIMER:** This software is an **early BETA** tool that interfaces with system-level Switch 2 filesystem (`fs`) hooks via `ns2jb-modloader`. It has received only limited testing and **may cause crashes, save-data corruption, account/console bans, or unintended system damage**. Use it **strictly at your own risk**. The author and contributors assume **no responsibility or liability** for any damage, data loss, or console issues resulting from its use.

---

**Vesper** is a beginner-friendly Windows desktop GUI (powered by WSL under the hood) for organizing, validating, and switching between multiple ExeFS/RomFS profiles on Nintendo Switch 2 through `ns2jb-modloader` and an FS RPC host (`ns2jb`).

No manual terminal commands needed for daily use — everything runs from one interface in **6 languages** (English, Italiano, Español, Français, Deutsch, 日本語).

---

## Tested vs. Untested Status

Transparency matters in beta software. Here is what has been verified on real Switch 2 hardware vs. what is currently **untested**:

| Feature / Component | Status | Notes |
|---|---|---|
| **SmileBASIC 4 (4.4.9)** via `ns2jb` (`run.cjs --rpc`) on FW `23.0.1` | **Tested & Working** | Verified end-to-end activation + clean `SIGINT` handoff |
| **Multi-profile selector** (`games/<profile>/` with `exefs.nsp` + `romfs.bin` + `.ips32`) | **Tested & Working** | Verified switching between multiple full ExeFS/RomFS profiles on the same microSD |
| **Large merged RomFS (`romfs.bin`) + ExeFS replacement + `.ips32` patching** | **Tested & Working** | Verified on a single target Title ID with multiple distinct profiles (both with and without the optional `MountTemporaryStorage` patch) |
| **Empty secondary user profile** (no existing save data on target title) | **Tested & Working** | **Strongly recommended** (see Save Data section below) |
| **Civilization VII (`civ7-fs`)** FS exploit vector | **UNTESTED** | Experimental option included in the UI (`HerXayah/civ7-fs`, `node engine/run.cjs <CONSOLE-IP>`) exposing an `ns2jb`-compatible FS 4/4 RPC session |
| **Multiple target Title IDs simultaneously** | **UNTESTED on hardware** | Multi-target selection is implemented and unit-tested offline, but only one target Title ID has been tested on real hardware so far |
| **User profiles that ALREADY have save data on the target title** | **UNTESTED / NOT RECOMMENDED** | High risk of save conflicts or overwriting existing save data |
| **Extended / late-game runtime stability** | **UNTESTED** | Only initial boot, menus, and early runtime have been verified |

---

## Important Technical Notes & Known Caveats

### 1. Save Data Safety — Always Use an Empty Secondary Profile
- So far, this tool has **only been tested with a user profile that has NO existing save data** for the target title.
- On Switch 2, save storage is bound to the `(Title ID, User Profile)` pair. Activating a full ExeFS/RomFS replacement profile under your main user profile can conflict with — or overwrite — your existing save data.
- **Strong recommendation:** Always use a dedicated **empty secondary profile** on your Switch 2 (ideally one per mod profile) and keep your main profile untouched.

### 2. The Optional `MountTemporaryStorage` Compatibility Patch (`2002-1002`)
- Some ExeFS replacements call `nn::fs::MountTemporaryStorage` during startup. When the target title's installed control metadata does **not** allocate a `TemporaryStorage` partition, the OS returns **`2002-1002` (`nn::fs::ResultTargetNotFound`)**, causing an immediate abort 2–5 seconds after launch.
- When building a profile from a `.nup` package, Vesper can optionally check whether `main` imports `_ZN2nn2fs21MountTemporaryStorageEPKc` and generate a minimal **23-byte `.ips32` patch** for `sdk` (`mov w0, #0; ret`) so the mount check returns `ResultSuccess`.
- **Possible consequences & limitations:** Because `TemporaryStorage` is **not actually mounted**, any later runtime code that tries to create, read, or write files under `tmp:/` (such as temporary caches, replays, screenshots, or specific transitions) may fail with `ResultNotMounted` (`2002-6002`), misbehave, or crash later. You can disable this auto-patch at any time in the UI or via `--no-auto-patch`.

### 3. Civilization VII (`civ7-fs`) Vector — Experimental / Untested
- Alongside **SmileBASIC 4 (`ns2jb`)**, the UI includes an experimental vector option and a **1-Click Install civ7-fs** section in **Setup Guide** (clones [`HerXayah/civ7-fs`](https://github.com/HerXayah/civ7-fs) into `~/civ7-fs`, no `npm install` needed).
- **This vector has NOT been tested by the author.** It runs `node engine/run.cjs <CONSOLE-IP>` against a Switch 2 running Gezine's CivSwitch Remote JS Loader (`:9026`) and exposes the same FS 4/4 RPC session layout (`result.json`, `connection.json`, `switch2/pipeline.cjs`). Its WSL directory and command can be configured in **Settings**.

---

## Prerequisites

1. **Windows 10 / 11** with **WSL** already set up and working.
2. **Node.js 22+ on Windows** — download from [nodejs.org](https://nodejs.org/).
3. **Node.js 22+, Git, and Python 3 inside WSL** — run inside your WSL terminal:
   ```bash
   sudo apt update && sudo apt install -y git curl python3 python3-venv
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   source ~/.bashrc
   nvm install 22
   ```
4. **Nintendo Switch 2** (FW `23.0.1`) on the same local network as your PC, with **SmileBASIC 4.4.9** (full or demo, ≥ 20 MiB free save space) and a FAT32/exFAT microSD card.

---

## Step-by-Step First-Time Setup

### 1. Download & Launch Vesper
Clone or download this repository on Windows and double-click:
- **`Launch Vesper.vbs`** (silent desktop app window)  
  *(or `launch-gui.bat` to view console output)*

### 2. Install `ns2jb` (or Point to Your Existing Copy)
Open the **Setup Guide** tab inside the app and click **Check Environment**:
- **Starting from scratch?** Click **1-Click Download ns2jb** (clones `https://gitlab.com/kurumuz/ns2jb.git` into `~/ns2jb` in WSL).
- **Already have `ns2jb`?** Open **Settings**, enter your `ns2jb` folder path in WSL, and click **Save Settings**.
- The **multi-profile backend engine** is already bundled inside `engine/` — leaving *Backend folder* blank uses it automatically!

### 3. Optional: Install `nup` Package Tool
If you already have `exefs.nsp` and `romfs.bin` (or loose `romfs/` / `exefs/` mods), skip this step and place them directly in `SD:\ns2jb-modloader\contents\<TITLE_ID>\games\<profile>\`.  
If you want to prepare profiles from `.nup` archives directly in the app, click **1-Click Install nup** in **Setup Guide** (or run `python3 -m venv ~/.ns2-game-loader/nup-venv && ~/.ns2-game-loader/nup-venv/bin/pip install nup` in WSL).

### 4. One-Time SmileBASIC Setup on Switch 2
Follow the one-time SmileBASIC setup instructions in `~/ns2jb/README.md` (`bootstrap.bas`), then open SmileBASIC on Switch 2 and enter **Direct Mode**.

### 5. Register Your Target Title Policy (for ExeFS Packaging)
1. Open the **MicroSD & Hosts** tab.
2. Under **Register a New Host**, select the `main.npdm` (or `.nup`) from your own legally dumped target title, enter a friendly label, and click **Register**.

### 6. Prepare Profiles & Launch
1. Open **Prepare Package (.nup)** to build and copy a profile directly onto your microSD (`D:`).
2. Put the microSD into your Switch 2.
3. Open **Launch**:
   - **Step 1:** Choose your exploit vector (**SmileBASIC 4** recommended), click **Start Exploit RPC**, and run the SmileBASIC command shown until status turns **FS 4/4 Ready**.
   - **Step 2:** Pick your profile card (or click **Detect Live from Switch 2**) and click **Install Selected**.
   - **Step 3:** When the green **READY** banner appears, click **Stop RPC (Safe Cleanup)**, close SmileBASIC without rebooting, and launch your target title on Switch 2 using an **empty secondary profile**.

---

## MicroSD Folder Layout

```text
SD:/ns2jb-modloader/contents/<TARGET_TITLE_ID>/
└── games/
    ├── profile-one/
    │   ├── exefs.nsp
    │   ├── romfs.bin
    │   └── exefs_patches/
    │       └── <SDK_BUILD_ID>.ips32   (optional, auto-generated if needed)
    └── profile-two/
        ├── exefs.nsp
        └── romfs.bin
```

---

## Running Automated Tests

```powershell
node tests/smoke-test.cjs
```

---

## FAQ

### Why doesn't this use kaiHEN (or run as an `.nro` inside hbmenu)?
Honestly, we tried to go that route and couldn't get it working reliably. Full ExeFS + multi-gigabyte RomFS redirection requires hooking directly inside the system `fs` process, which kaiHEN does not currently provide as a standalone `.nro` modloader. Using the `ns2jb` + `ns2jb-modloader` backend was the path that actually worked consistently on real hardware. **Maybe** in the future we will revisit kaiHEN integration.

### I have nothing installed on my PC yet (only Windows + WSL). Can I still use this?
Yes! The multi-profile backend is already bundled inside `engine/`. After installing Node.js 22+ on Windows and WSL, open the app, go to **Setup Guide**, and use the **1-Click Download ns2jb** and **1-Click Install nup** buttons (the latter is only needed if working with `.nup` packages).

### Can I use my main Switch 2 profile (which already has save data)?
**Strongly discouraged.** So far, this has only been tested with an **empty secondary profile** that has no save data for the target title. Using your main profile can cause save conflicts or overwrite existing save data.

### Why did a profile close 2–5 seconds after launch?
Two common causes:
1. The ExeFS calls `nn::fs::MountTemporaryStorage`, which fails with `2002-1002` (`TargetNotFound`) if the target title does not allocate `TemporaryStorage`. Make sure **Auto-patch `MountTemporaryStorage`** is enabled when preparing the package.
2. If the package includes an update, ensure `romfs.bin` merges both base-only files and update files (the built-in preparation tool handles this automatically).

### Can I use different target Title IDs?
Yes — you can register any legally owned target title's `main.npdm` in **MicroSD & Hosts**, and the backend automatically detects all Title ID folders under `SD:/ns2jb-modloader/contents/`. Note that only a single target Title ID has been tested on real hardware so far.

### Why does a Windows app still require WSL under the hood?
`ns2jb` and `ns2jb-modloader` depend on Linux/POSIX primitives (`/proc`, Unix sockets, and clean `SIGINT`/`SIGTERM` teardown signals). Running the backend untouched inside WSL behind a Windows GUI preserves 100% of upstream stability without modifying the exploit.

---

## Credits & Acknowledgements

- Huge thanks to **[SebaaMG](https://github.com/SebaaMG/ns2jb-modloader)** and the **`ns2jb-modloader`** project — the bundled multi-profile backend in `engine/` is built directly on top of `ns2jb-modloader` (GPL-2.0-only).
- Thanks to **[Kurumuz](https://gitlab.com/kurumuz/ns2jb)** and contributors for **`ns2jb`**.
- Thanks to **[HerXayah](https://github.com/HerXayah/civ7-fs)** and **[Gezine](https://github.com/Gezine)** for **`civ7-fs`** / **CivSwitch**.
- Thanks to the Switch 2 research & homebrew community (`libounce`, `libnx`, `zstd`, and all third-party licenses preserved under `engine/licenses/`).

## License

Licensed under **GNU General Public License v2.0 only (`GPL-2.0-only`)** — see [LICENSE](LICENSE).
