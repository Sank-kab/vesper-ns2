/* SPDX-License-Identifier: GPL-2.0-only */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define VESPER_MAX_HOSTS     16
#define VESPER_MAX_PROFILES  64
#define VESPER_MAX_PATCHES   32
#define VESPER_MAX_PATH      512
#define VESPER_MAX_NAME      128

typedef struct {
    char name[VESPER_MAX_NAME];       /* e.g. exefs_patches/<BUILD_ID>.ips32 */
    char sd_path[VESPER_MAX_PATH];    /* e.g. /ns2jb-modloader/contents/<TID>/games/<P>/exefs_patches/<ID>.ips32 */
    uint64_t size;
} VesperPatchFile;

typedef struct {
    char name[VESPER_MAX_NAME];       /* profile folder name or "(direct)" */
    char dir_path[VESPER_MAX_PATH];   /* /ns2jb-modloader/contents/<TID>/games/<P> */
    bool has_exefs_nsp;
    char exefs_nsp_path[VESPER_MAX_PATH];
    uint64_t exefs_nsp_size;
    bool has_romfs_bin;
    char romfs_bin_path[VESPER_MAX_PATH];
    uint64_t romfs_bin_size;
    VesperPatchFile patches[VESPER_MAX_PATCHES];
    size_t patch_count;
    bool ok;
} VesperProfile;

typedef struct {
    char title_id_str[17];            /* 16-hex lowercase */
    uint64_t title_id;
    VesperProfile profiles[VESPER_MAX_PROFILES];
    size_t profile_count;
} VesperHost;

typedef struct {
    VesperHost hosts[VESPER_MAX_HOSTS];
    size_t host_count;
} VesperCatalog;

/* Scans sdmc:/ns2jb-modloader/contents/<HOST_TITLE_ID>/games/<PROFILE>/ */
int vesper_scan_sd(VesperCatalog* out);

/* Formats a byte count into a human-readable string like "15.6 GB" or "4.2 MB". */
void vesper_fmt_size(uint64_t bytes, char* buf, size_t buf_len);
