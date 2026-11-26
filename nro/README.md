# Vesper NRO (Switch 2 / kaiHEN hbmenu App) *(Beta)*

Native Switch 2 homebrew application (`vesper.nro`) for **hbmenu** under **kaiHEN**.

## Features
- Scans `sdmc:/ns2jb-modloader/contents/<HOST_TITLE_ID>/games/<profile>/` directly on your Switch 2.
- Displays ExeFS (`exefs.nsp`), RomFS (`romfs.bin`), and `.ips`/`.ips32` patch counts for every profile.
- **Instant SD Profile Switcher:** press **A** to atomically activate a profile (using zero-copy FAT32/exFAT `rename()`, instantaneous even for 15+ GB `romfs.bin` images) and **X** to deactivate it.
- Detects whether **kaiHEN** is running (and whether patched `ro:dmnt` FS helpers are available).

## Controls
- **D-Pad Up / Down:** Select profile
- **L / R:** Switch Host Title ID
- **A:** Activate selected profile on microSD
- **X:** Deactivate active profile (moves files back into `games/<profile>/`)
- **Y:** Rescan microSD
- **+:** Exit back to hbmenu

## Building (`vesper.nro`)
Requires Docker with the [`ounce-devkit`](https://github.com/ouncebrew/ounce-devkit) image:

```bash
cd nro
chmod +x build.sh
./build.sh
```

Copy the resulting `nro/vesper.nro` to `SD:/switch/vesper.nro` on your microSD card.
