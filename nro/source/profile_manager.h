/* SPDX-License-Identifier: GPL-2.0-only */
#pragma once
#include "sd_scanner.h"
#include <stdbool.h>
#include <stddef.h>

/* Reads the currently active profile name for a host (if any) from .vesper_active.
 * Returns true if an active profile marker exists, false otherwise. */
bool vesper_get_active_profile(const VesperHost* host, char* out_name, size_t out_len);

/* Atomically switches the active profile for `host` on the microSD using instant
 * FAT32/exFAT rename() operations (0 ms even for multi-GB romfs.bin files):
 *  1. If another profile is currently active at contents/<TID>/, moves its files
 *     back into contents/<TID>/games/<prev_name>/.
 *  2. Moves the selected profile's exefs.nsp, romfs.bin, and exefs_patches/
 *     from contents/<TID>/games/<profile>/ to contents/<TID>/.
 *  3. Writes contents/<TID>/.vesper_active with the active profile name.
 *
 * Returns 0 on success, negative error code on failure (and writes a human-readable
 * explanation into err_buf). */
int vesper_activate_profile(const VesperHost* host, const VesperProfile* prof, char* err_buf, size_t err_len);

/* Deactivates the currently active profile for `host`, moving its files back into
 * contents/<TID>/games/<active_name>/ and removing .vesper_active. */
int vesper_deactivate_profile(const VesperHost* host, char* err_buf, size_t err_len);
