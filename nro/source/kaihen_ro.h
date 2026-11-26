/* SPDX-License-Identifier: GPL-2.0-only */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <switch.h>

/* Patched kaiHEN RO helper commands (ABI compatible with switch2-modbridge) */
#define VESPER_HEN_GET_FS_PROCESS 64
#define VESPER_RO_QUERY           0x524f0010u
#define VESPER_RO_MAP_CODE        0x524f0012u
#define VESPER_RO_UNMAP_CODE      0x524f0013u
#define VESPER_RO_PATCH           0x524f0014u
#define VESPER_RO_PROTECT         0x524f0015u
#define VESPER_RO_READ            0x524f0026u
#define VESPER_RO_WRITE           0x524f0028u

typedef struct {
    uint64_t address;
    uint64_t size;
    uint32_t type;
    uint32_t attr;
    uint32_t perm;
    uint32_t pad;
} VesperMemInfo;

typedef struct {
    bool open;
    bool has_fs_helpers;
    Service hen;
    Service dmnt;
    Handle fs_proc;
    Handle fs_root;
    uint64_t fs_pid;
    uint64_t ro_pid;
} VesperKaihenCtx;

/* Opens kaiHEN homebrew session, FS process handle, FS root, and patched ro:dmnt. */
Result vesper_kaihen_open(VesperKaihenCtx* ctx);
void vesper_kaihen_close(VesperKaihenCtx* ctx);

/* Patched ro:dmnt FS memory primitives */
Result vesper_fs_query(VesperKaihenCtx* ctx, uint64_t addr, VesperMemInfo* out);
Result vesper_fs_read(VesperKaihenCtx* ctx, uint64_t addr, void* buf, size_t len);
Result vesper_fs_write(VesperKaihenCtx* ctx, uint64_t addr, const void* expected, const void* replacement, size_t len);
Result vesper_fs_patch(VesperKaihenCtx* ctx, uint64_t addr, const void* expected, const void* replacement, size_t len);
Result vesper_fs_protect(VesperKaihenCtx* ctx, uint64_t addr, size_t len, uint32_t perm);
Result vesper_fs_map_code(VesperKaihenCtx* ctx, const void* code_page_aligned, size_t len, uint64_t* out_fs_addr);
