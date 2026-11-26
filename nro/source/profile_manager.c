/* SPDX-License-Identifier: GPL-2.0-only */
#include "profile_manager.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define SD_CONTENTS_ROOT "sdmc:/ns2jb-modloader/contents"

static bool path_exists(const char* p) {
    struct stat st;
    return stat(p, &st) == 0;
}

static int move_if_exists(const char* src_dir, const char* dst_dir, const char* item, char* err_buf, size_t err_len) {
    char src[VESPER_MAX_PATH];
    char dst[VESPER_MAX_PATH];
    snprintf(src, sizeof(src), "%s/%s", src_dir, item);
    snprintf(dst, sizeof(dst), "%s/%s", dst_dir, item);

    if (!path_exists(src)) return 0;
    if (path_exists(dst)) {
        snprintf(err_buf, err_len, "Target already exists: %s", dst);
        return -EEXIST;
    }
    if (rename(src, dst) != 0) {
        int e = errno;
        snprintf(err_buf, err_len, "rename(%s -> %s) failed: %s", item, dst_dir, strerror(e));
        return -e;
    }
    return 0;
}

static int move_profile_items(const char* src_dir, const char* dst_dir, char* err_buf, size_t err_len) {
    static const char* ITEMS[] = {"exefs.nsp", "romfs.bin", "exefs_patches", "exefs", "romfs"};
    for (size_t i = 0; i < sizeof(ITEMS) / sizeof(ITEMS[0]); i++) {
        int rc = move_if_exists(src_dir, dst_dir, ITEMS[i], err_buf, err_len);
        if (rc != 0) return rc;
    }
    return 0;
}

bool vesper_get_active_profile(const VesperHost* host, char* out_name, size_t out_len) {
    if (!host || !out_name || out_len == 0) return false;
    out_name[0] = '\0';

    char marker[VESPER_MAX_PATH];
    snprintf(marker, sizeof(marker), "%s/%s/.vesper_active", SD_CONTENTS_ROOT, host->title_id_str);
    FILE* f = fopen(marker, "r");
    if (!f) return false;

    if (fgets(out_name, (int)out_len, f)) {
        size_t n = strlen(out_name);
        while (n > 0 && (out_name[n - 1] == '\n' || out_name[n - 1] == '\r' || out_name[n - 1] == ' ')) {
            out_name[--n] = '\0';
        }
    }
    fclose(f);
    return out_name[0] != '\0';
}

int vesper_deactivate_profile(const VesperHost* host, char* err_buf, size_t err_len) {
    char active_name[VESPER_MAX_NAME];
    if (!vesper_get_active_profile(host, active_name, sizeof(active_name))) {
        return 0; /* nothing active */
    }

    char host_dir[VESPER_MAX_PATH];
    char games_dir[VESPER_MAX_PATH];
    char target_dir[VESPER_MAX_PATH];
    char marker[VESPER_MAX_PATH];

    snprintf(host_dir, sizeof(host_dir), "%s/%s", SD_CONTENTS_ROOT, host->title_id_str);
    snprintf(games_dir, sizeof(games_dir), "%s/games", host_dir);
    snprintf(target_dir, sizeof(target_dir), "%s/%s", games_dir, active_name);
    snprintf(marker, sizeof(marker), "%s/.vesper_active", host_dir);

    mkdir(games_dir, 0777);
    mkdir(target_dir, 0777);

    int rc = move_profile_items(host_dir, target_dir, err_buf, err_len);
    if (rc != 0) return rc;

    unlink(marker);
    return 0;
}

int vesper_activate_profile(const VesperHost* host, const VesperProfile* prof, char* err_buf, size_t err_len) {
    if (!host || !prof) {
        snprintf(err_buf, err_len, "Invalid host or profile.");
        return -EINVAL;
    }

    if (strcmp(prof->name, "(direct)") == 0) {
        snprintf(err_buf, err_len, "Direct root files are already active at contents/%s/.", host->title_id_str);
        return 0;
    }

    char current[VESPER_MAX_NAME];
    if (vesper_get_active_profile(host, current, sizeof(current))) {
        if (strcmp(current, prof->name) == 0) {
            snprintf(err_buf, err_len, "Profile '%s' is already active.", prof->name);
            return 0;
        }
        int drc = vesper_deactivate_profile(host, err_buf, err_len);
        if (drc != 0) return drc;
    }

    char host_dir[VESPER_MAX_PATH];
    char prof_dir[VESPER_MAX_PATH];
    char marker[VESPER_MAX_PATH];

    snprintf(host_dir, sizeof(host_dir), "%s/%s", SD_CONTENTS_ROOT, host->title_id_str);
    snprintf(prof_dir, sizeof(prof_dir), "%s/games/%s", host_dir, prof->name);
    snprintf(marker, sizeof(marker), "%s/.vesper_active", host_dir);

    int rc = move_profile_items(prof_dir, host_dir, err_buf, err_len);
    if (rc != 0) return rc;

    FILE* f = fopen(marker, "w");
    if (!f) {
        snprintf(err_buf, err_len, "Moved files, but could not write .vesper_active marker.");
        return -EIO;
    }
    fprintf(f, "%s\n", prof->name);
    fclose(f);
    return 0;
}
