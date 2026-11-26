/* SPDX-License-Identifier: GPL-2.0-only */
#include "kaihen_ro.h"
#include "profile_manager.h"
#include "sd_scanner.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <switch.h>

static void print_header(const VesperKaihenCtx* kh, const VesperCatalog* cat, size_t host_idx) {
    consoleClear();
    printf(CONSOLE_CYAN "================================================================================\n");
    printf("  VESPER (Switch 2 / kaiHEN Edition)  -  Multi-Profile ExeFS & RomFS Manager\n");
    printf("================================================================================\n" CONSOLE_RESET);

    printf("  kaiHEN: ");
    if (kh->open && kh->has_fs_helpers) {
        printf(CONSOLE_GREEN "Active (FS helpers detected, FS PID %llu)" CONSOLE_RESET "\n",
               (unsigned long long)kh->fs_pid);
    } else if (kh->open) {
        printf(CONSOLE_YELLOW "Active (Stock kaiHEN — SD Profile Switcher mode)" CONSOLE_RESET "\n");
    } else {
        printf(CONSOLE_RED "Not detected (SD Profile Switcher mode)" CONSOLE_RESET "\n");
    }

    if (cat->host_count > 0) {
        const VesperHost* h = &cat->hosts[host_idx];
        char active[VESPER_MAX_NAME];
        bool has_active = vesper_get_active_profile(h, active, sizeof(active));
        printf("  Host [%zu/%zu]: " CONSOLE_WHITE "%s" CONSOLE_RESET "  |  Active: ",
               host_idx + 1, cat->host_count, h->title_id_str);
        if (has_active) {
            printf(CONSOLE_GREEN "%s" CONSOLE_RESET "\n", active);
        } else {
            printf(CONSOLE_YELLOW "(none)" CONSOLE_RESET "\n");
        }
    } else {
        printf("  Host: " CONSOLE_YELLOW "None found under sdmc:/ns2jb-modloader/contents/" CONSOLE_RESET "\n");
    }
    printf("--------------------------------------------------------------------------------\n");
}

static void render_ui(const VesperKaihenCtx* kh, const VesperCatalog* cat,
                      size_t host_idx, size_t prof_idx, const char* status_msg, bool is_error) {
    print_header(kh, cat, host_idx);

    if (cat->host_count == 0) {
        printf("\n  No profiles found on microSD.\n");
        printf("  Place profiles in:\n");
        printf("    sdmc:/ns2jb-modloader/contents/<HOST_TITLE_ID>/games/<profile>/\n");
        printf("      - exefs.nsp\n");
        printf("      - romfs.bin\n");
        printf("      - exefs_patches/<BUILD_ID>.ips32 (optional)\n\n");
    } else {
        const VesperHost* h = &cat->hosts[host_idx];
        char active[VESPER_MAX_NAME];
        bool has_active = vesper_get_active_profile(h, active, sizeof(active));

        const size_t max_visible = 16;
        size_t start = 0;
        if (prof_idx >= max_visible) start = prof_idx - max_visible + 1;
        size_t end = start + max_visible;
        if (end > h->profile_count) end = h->profile_count;

        for (size_t i = start; i < end; i++) {
            const VesperProfile* p = &h->profiles[i];
            bool selected = (i == prof_idx);
            bool is_active = has_active && (strcmp(active, p->name) == 0);

            char exefs_str[24] = "none";
            char romfs_str[24] = "none";
            if (p->has_exefs_nsp) vesper_fmt_size(p->exefs_nsp_size, exefs_str, sizeof(exefs_str));
            if (p->has_romfs_bin) vesper_fmt_size(p->romfs_bin_size, romfs_str, sizeof(romfs_str));

            if (selected) printf(CONSOLE_CYAN " > " CONSOLE_RESET);
            else          printf("   ");

            if (is_active) printf(CONSOLE_GREEN "[ACTIVE] " CONSOLE_RESET);

            printf("%-26.26s  ExeFS: %-9s  RomFS: %-9s  IPS: %zu\n",
                   p->name, exefs_str, romfs_str, p->patch_count);
        }
    }

    printf("--------------------------------------------------------------------------------\n");
    if (status_msg && status_msg[0]) {
        printf("  %s%s" CONSOLE_RESET "\n", is_error ? CONSOLE_RED : CONSOLE_GREEN, status_msg);
    } else {
        printf("  Tip: Always launch your host title with an EMPTY secondary user profile!\n");
    }
    printf("--------------------------------------------------------------------------------\n");
    printf("  [Up/Down] Select   [L/R] Switch Host   [A] Activate Profile\n");
    printf("  [X] Deactivate     [Y] Rescan SD       [+] Exit to hbmenu\n");
    consoleUpdate(NULL);
}

int main(int argc, char** argv) {
    (void)argc;
    (void)argv;

    consoleInit(NULL);
    padConfigureInput(1, HidNpadStyleSet_NpadStandard);
    PadState pad;
    padInitializeDefault(&pad);

    VesperKaihenCtx kh;
    vesper_kaihen_open(&kh);

    VesperCatalog* cat = (VesperCatalog*)calloc(1, sizeof(VesperCatalog));
    if (!cat) {
        printf(CONSOLE_RED "Out of memory.\n" CONSOLE_RESET);
        consoleUpdate(NULL);
        consoleExit(NULL);
        return 1;
    }

    vesper_scan_sd(cat);

    size_t host_idx = 0;
    size_t prof_idx = 0;
    char status[256] = "Ready. Select a profile and press [A] to activate on SD.";
    bool is_error = false;

    render_ui(&kh, cat, host_idx, prof_idx, status, is_error);

    while (appletMainLoop()) {
        padUpdate(&pad);
        u64 kDown = padGetButtonsDown(&pad);

        if (kDown & HidNpadButton_Plus) break;

        bool dirty = false;

        if ((kDown & HidNpadButton_Down) && cat->host_count > 0) {
            const VesperHost* h = &cat->hosts[host_idx];
            if (h->profile_count > 0) {
                prof_idx = (prof_idx + 1) % h->profile_count;
                dirty = true;
            }
        } else if ((kDown & HidNpadButton_Up) && cat->host_count > 0) {
            const VesperHost* h = &cat->hosts[host_idx];
            if (h->profile_count > 0) {
                prof_idx = (prof_idx == 0) ? (h->profile_count - 1) : (prof_idx - 1);
                dirty = true;
            }
        } else if ((kDown & HidNpadButton_R) && cat->host_count > 1) {
            host_idx = (host_idx + 1) % cat->host_count;
            prof_idx = 0;
            dirty = true;
        } else if ((kDown & HidNpadButton_L) && cat->host_count > 1) {
            host_idx = (host_idx == 0) ? (cat->host_count - 1) : (host_idx - 1);
            prof_idx = 0;
            dirty = true;
        } else if (kDown & HidNpadButton_Y) {
            vesper_scan_sd(cat);
            if (host_idx >= cat->host_count) host_idx = 0;
            prof_idx = 0;
            snprintf(status, sizeof(status), "SD rescanned: %zu host(s) found.", cat->host_count);
            is_error = false;
            dirty = true;
        } else if ((kDown & HidNpadButton_A) && cat->host_count > 0) {
            const VesperHost* h = &cat->hosts[host_idx];
            if (h->profile_count > 0) {
                const VesperProfile* p = &h->profiles[prof_idx];
                char err[200] = {0};
                int rc = vesper_activate_profile(h, p, err, sizeof(err));
                if (rc == 0) {
                    snprintf(status, sizeof(status),
                             "Activated '%s'! Press [+] to exit and launch host on an empty profile.",
                             p->name);
                    is_error = false;
                    vesper_scan_sd(cat);
                    if (host_idx >= cat->host_count) host_idx = 0;
                    if (cat->host_count > 0 && prof_idx >= cat->hosts[host_idx].profile_count) prof_idx = 0;
                } else {
                    snprintf(status, sizeof(status), "Activation failed: %s", err);
                    is_error = true;
                }
                dirty = true;
            }
        } else if ((kDown & HidNpadButton_X) && cat->host_count > 0) {
            const VesperHost* h = &cat->hosts[host_idx];
            char err[200] = {0};
            int rc = vesper_deactivate_profile(h, err, sizeof(err));
            if (rc == 0) {
                snprintf(status, sizeof(status), "Deactivated active profile for %s.", h->title_id_str);
                is_error = false;
                vesper_scan_sd(cat);
                if (host_idx >= cat->host_count) host_idx = 0;
                prof_idx = 0;
            } else {
                snprintf(status, sizeof(status), "Deactivate failed: %s", err);
                is_error = true;
            }
            dirty = true;
        }

        if (dirty) {
            render_ui(&kh, cat, host_idx, prof_idx, status, is_error);
        }
    }

    free(cat);
    vesper_kaihen_close(&kh);
    consoleExit(NULL);
    return 0;
}
