/* SPDX-License-Identifier: GPL-2.0-only */
#include "sd_scanner.h"

#include <ctype.h>
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#define SD_ROOT_MOUNT "sdmc:/ns2jb-modloader"
#define SD_ROOT_REL   "/ns2jb-modloader"

static bool is_title_id(const char* s) {
    if (!s || strlen(s) != 16) return false;
    if (s[0] != '0' || (s[1] != '1' && s[1] != '4')) return false;
    for (int i = 0; i < 16; i++) {
        if (!isxdigit((unsigned char)s[i])) return false;
    }
    return true;
}

static bool ends_with_ci(const char* str, const char* suffix) {
    size_t sl = strlen(str), fl = strlen(suffix);
    if (fl > sl) return false;
    for (size_t i = 0; i < fl; i++) {
        if (tolower((unsigned char)str[sl - fl + i]) != tolower((unsigned char)suffix[i])) return false;
    }
    return true;
}

static bool is_ignored(const char* name) {
    return !name || name[0] == '.' ||
           strcmp(name, ".gitkeep") == 0 ||
           strcmp(name, ".DS_Store") == 0 ||
           strcmp(name, "Thumbs.db") == 0;
}

static int cmp_profiles(const void* a, const void* b) {
    const VesperProfile* pa = (const VesperProfile*)a;
    const VesperProfile* pb = (const VesperProfile*)b;
    return strcmp(pa->name, pb->name);
}

static int cmp_hosts(const void* a, const void* b) {
    const VesperHost* ha = (const VesperHost*)a;
    const VesperHost* hb = (const VesperHost*)b;
    return strcmp(ha->title_id_str, hb->title_id_str);
}

static void scan_patches_dir(VesperProfile* prof, const char* mount_dir, const char* rel_dir, const char* prefix) {
    DIR* d = opendir(mount_dir);
    if (!d) return;
    struct dirent* ent;
    while ((ent = readdir(d)) != NULL && prof->patch_count < VESPER_MAX_PATCHES) {
        if (is_ignored(ent->d_name)) continue;
        char full[VESPER_MAX_PATH];
        snprintf(full, sizeof(full), "%s/%s", mount_dir, ent->d_name);
        struct stat st;
        if (stat(full, &st) != 0) continue;
        if (S_ISDIR(st.st_mode)) {
            char sub_rel[VESPER_MAX_PATH];
            char sub_pre[VESPER_MAX_NAME];
            snprintf(sub_rel, sizeof(sub_rel), "%s/%s", rel_dir, ent->d_name);
            snprintf(sub_pre, sizeof(sub_pre), "%s/%s", prefix, ent->d_name);
            scan_patches_dir(prof, full, sub_rel, sub_pre);
        } else if (S_ISREG(st.st_mode) && (ends_with_ci(ent->d_name, ".ips") || ends_with_ci(ent->d_name, ".ips32"))) {
            VesperPatchFile* pf = &prof->patches[prof->patch_count++];
            snprintf(pf->name, sizeof(pf->name), "%s/%s", prefix, ent->d_name);
            snprintf(pf->sd_path, sizeof(pf->sd_path), "%s/%s", rel_dir, ent->d_name);
            pf->size = (uint64_t)st.st_size;
        }
    }
    closedir(d);
}

static bool scan_profile_dir(VesperProfile* prof, const char* name, const char* mount_dir, const char* rel_dir) {
    memset(prof, 0, sizeof(*prof));
    snprintf(prof->name, sizeof(prof->name), "%s", name);
    snprintf(prof->dir_path, sizeof(prof->dir_path), "%s", rel_dir);

    char p[VESPER_MAX_PATH];
    struct stat st;

    snprintf(p, sizeof(p), "%s/exefs.nsp", mount_dir);
    if (stat(p, &st) == 0 && S_ISREG(st.st_mode) && st.st_size > 0) {
        prof->has_exefs_nsp = true;
        prof->exefs_nsp_size = (uint64_t)st.st_size;
        snprintf(prof->exefs_nsp_path, sizeof(prof->exefs_nsp_path), "%s/exefs.nsp", rel_dir);
    }

    snprintf(p, sizeof(p), "%s/romfs.bin", mount_dir);
    if (stat(p, &st) == 0 && S_ISREG(st.st_mode) && st.st_size > 0) {
        prof->has_romfs_bin = true;
        prof->romfs_bin_size = (uint64_t)st.st_size;
        snprintf(prof->romfs_bin_path, sizeof(prof->romfs_bin_path), "%s/romfs.bin", rel_dir);
    }

    char patch_mount[VESPER_MAX_PATH], patch_rel[VESPER_MAX_PATH];
    snprintf(patch_mount, sizeof(patch_mount), "%s/exefs_patches", mount_dir);
    snprintf(patch_rel, sizeof(patch_rel), "%s/exefs_patches", rel_dir);
    scan_patches_dir(prof, patch_mount, patch_rel, "exefs_patches");

    prof->ok = prof->has_exefs_nsp || prof->has_romfs_bin || prof->patch_count > 0;
    return prof->ok;
}

int vesper_scan_sd(VesperCatalog* out) {
    memset(out, 0, sizeof(*out));
    char contents_dir[VESPER_MAX_PATH];
    snprintf(contents_dir, sizeof(contents_dir), "%s/contents", SD_ROOT_MOUNT);

    DIR* cd = opendir(contents_dir);
    if (!cd) return -1;

    struct dirent* ent;
    while ((ent = readdir(cd)) != NULL && out->host_count < VESPER_MAX_HOSTS) {
        if (!is_title_id(ent->d_name)) continue;

        char host_mount[VESPER_MAX_PATH], host_rel[VESPER_MAX_PATH];
        snprintf(host_mount, sizeof(host_mount), "%s/%s", contents_dir, ent->d_name);
        snprintf(host_rel, sizeof(host_rel), "%s/contents/%s", SD_ROOT_REL, ent->d_name);

        struct stat st;
        if (stat(host_mount, &st) != 0 || !S_ISDIR(st.st_mode)) continue;

        VesperHost* host = &out->hosts[out->host_count];
        memset(host, 0, sizeof(*host));
        for (int i = 0; i < 16; i++) host->title_id_str[i] = (char)tolower((unsigned char)ent->d_name[i]);
        host->title_id_str[16] = '\0';
        host->title_id = strtoull(host->title_id_str, NULL, 16);

        /* Scan games/<profile>/ folders */
        char games_mount[VESPER_MAX_PATH], games_rel[VESPER_MAX_PATH];
        snprintf(games_mount, sizeof(games_mount), "%s/games", host_mount);
        snprintf(games_rel, sizeof(games_rel), "%s/games", host_rel);
        DIR* gd = opendir(games_mount);
        if (gd) {
            struct dirent* gent;
            while ((gent = readdir(gd)) != NULL && host->profile_count < VESPER_MAX_PROFILES) {
                if (is_ignored(gent->d_name)) continue;
                char pm[VESPER_MAX_PATH], pr[VESPER_MAX_PATH];
                snprintf(pm, sizeof(pm), "%s/%s", games_mount, gent->d_name);
                snprintf(pr, sizeof(pr), "%s/%s", games_rel, gent->d_name);
                struct stat pst;
                if (stat(pm, &pst) != 0 || !S_ISDIR(pst.st_mode)) continue;
                if (scan_profile_dir(&host->profiles[host->profile_count], gent->d_name, pm, pr)) {
                    host->profile_count++;
                }
            }
            closedir(gd);
        }

        /* Also check direct files at contents/<TID>/ */
        if (host->profile_count < VESPER_MAX_PROFILES) {
            VesperProfile direct;
            if (scan_profile_dir(&direct, "(direct)", host_mount, host_rel)) {
                host->profiles[host->profile_count++] = direct;
            }
        }

        if (host->profile_count > 0) {
            qsort(host->profiles, host->profile_count, sizeof(VesperProfile), cmp_profiles);
            out->host_count++;
        }
    }
    closedir(cd);

    if (out->host_count > 1) {
        qsort(out->hosts, out->host_count, sizeof(VesperHost), cmp_hosts);
    }
    return 0;
}

void vesper_fmt_size(uint64_t bytes, char* buf, size_t buf_len) {
    if (bytes >= (1024ULL * 1024ULL * 1024ULL)) {
        snprintf(buf, buf_len, "%.2f GB", (double)bytes / (1024.0 * 1024.0 * 1024.0));
    } else if (bytes >= (1024ULL * 1024ULL)) {
        snprintf(buf, buf_len, "%.1f MB", (double)bytes / (1024.0 * 1024.0));
    } else if (bytes >= 1024ULL) {
        snprintf(buf, buf_len, "%.1f KB", (double)bytes / 1024.0);
    } else {
        snprintf(buf, buf_len, "%llu B", (unsigned long long)bytes);
    }
}
