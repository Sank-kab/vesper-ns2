/* SPDX-License-Identifier: GPL-2.0-only */
#include "kaihen_ro.h"

#include <kaihen.h>
#include <stdlib.h>
#include <string.h>

typedef struct { uint64_t v[4]; } In32;
typedef struct { uint64_t v[13]; } QueryOut;
typedef struct { uint64_t v[8]; } Out64;
typedef struct { uint64_t v[10]; } Out80;

static Result sm_get_service_raw(Handle sm, const char* name, Handle* out_handle) {
    char name8[8] = {0};
    strncpy(name8, name, sizeof(name8));
    Service sm_srv = {0};
    serviceCreate(&sm_srv, sm);
    Result rc = serviceDispatchIn(&sm_srv, 1, name8,
        .out_handle_attrs = {SfOutHandleAttr_HipcMove},
        .out_handles = out_handle);
    return rc;
}

Result vesper_kaihen_open(VesperKaihenCtx* ctx) {
    memset(ctx, 0, sizeof(*ctx));
    ctx->fs_proc = INVALID_HANDLE;
    ctx->fs_root = INVALID_HANDLE;

    Service ro = {0};
    Result rc = kaihenGetRoSession(&ro);
    if (R_FAILED(rc)) return rc;

    rc = kaihenOpenHomebrewSession(&ro, &ctx->hen);
    serviceClose(&ro);
    if (R_FAILED(rc)) return rc;

    rc = serviceDispatch(&ctx->hen, VESPER_HEN_GET_FS_PROCESS,
        .out_handle_attrs = {SfOutHandleAttr_HipcCopy},
        .out_handles = &ctx->fs_proc);
    if (R_FAILED(rc)) {
        /* kaiHEN is running, but does not have the switch2-modbridge FS helper patches */
        ctx->open = true;
        ctx->has_fs_helpers = false;
        return rc;
    }

    rc = henGetFilesystemRoot(&ctx->hen, &ctx->fs_root);
    if (R_FAILED(rc)) {
        vesper_kaihen_close(ctx);
        return rc;
    }

    Handle sm_handle = INVALID_HANDLE;
    rc = henGetServiceManager(&ctx->hen, &sm_handle);
    if (R_FAILED(rc)) {
        vesper_kaihen_close(ctx);
        return rc;
    }

    Handle dmnt_handle = INVALID_HANDLE;
    rc = sm_get_service_raw(sm_handle, "ro:dmnt", &dmnt_handle);
    svcCloseHandle(sm_handle);
    if (R_FAILED(rc)) {
        vesper_kaihen_close(ctx);
        return rc;
    }

    serviceCreate(&ctx->dmnt, dmnt_handle);

    /* Query FS PID via svcGetProcessId */
    rc = svcGetProcessId(&ctx->fs_pid, ctx->fs_proc);
    if (R_FAILED(rc)) {
        vesper_kaihen_close(ctx);
        return rc;
    }

    /* Probe HELPER_QUERY at 0 to verify patched ro:dmnt responds */
    VesperMemInfo probe = {0};
    rc = vesper_fs_query(ctx, 0, &probe);
    if (R_FAILED(rc)) {
        vesper_kaihen_close(ctx);
        return rc;
    }

    ctx->open = true;
    ctx->has_fs_helpers = true;
    return 0;
}

void vesper_kaihen_close(VesperKaihenCtx* ctx) {
    if (!ctx) return;
    if (serviceIsActive(&ctx->dmnt)) serviceClose(&ctx->dmnt);
    if (ctx->fs_root != INVALID_HANDLE) { svcCloseHandle(ctx->fs_root); ctx->fs_root = INVALID_HANDLE; }
    if (ctx->fs_proc != INVALID_HANDLE) { svcCloseHandle(ctx->fs_proc); ctx->fs_proc = INVALID_HANDLE; }
    if (serviceIsActive(&ctx->hen)) serviceClose(&ctx->hen);
    ctx->open = false;
    ctx->has_fs_helpers = false;
}

Result vesper_fs_query(VesperKaihenCtx* ctx, uint64_t addr, VesperMemInfo* out) {
    In32 in = {{0, addr, 0, 0}};
    QueryOut q = {0};
    Result rc = serviceDispatchInOut(&ctx->dmnt, VESPER_RO_QUERY, in, q,
        .in_num_handles = 1, .in_handles = {ctx->fs_proc});
    if (R_FAILED(rc)) return rc;
    if (out) {
        out->address = q.v[4];
        out->size    = q.v[5];
        out->type    = (uint32_t)(q.v[6] & 0xFFFFFFFFu);
        out->attr    = (uint32_t)(q.v[6] >> 32);
        out->perm    = (uint32_t)(q.v[7] & 0xFFFFFFFFu);
        out->pad     = 0;
    }
    return 0;
}

Result vesper_fs_read(VesperKaihenCtx* ctx, uint64_t addr, void* buf, size_t len) {
    uint8_t* dst = (uint8_t*)buf;
    while (len > 0) {
        VesperMemInfo q = {0};
        Result rc = vesper_fs_query(ctx, addr, &q);
        if (R_FAILED(rc)) return rc;
        uint64_t end = q.address + q.size;
        if (end <= addr) return MAKERESULT(Module_Libnx, LibnxError_BadInput);
        uint64_t n = (end - addr < len) ? (end - addr) : len;
        if (n > 0x400000u) n = 0x400000u;

        Out64 r = {0};
        In32 in = {{ctx->fs_pid, addr, n, 0}};
        rc = serviceDispatchInOut(&ctx->dmnt, VESPER_RO_READ, in, r,
            .buffer_attrs = {SfBufferAttr_HipcMapAlias | SfBufferAttr_Out},
            .buffers = {{dst, (size_t)n}},
            .in_num_handles = 1, .in_handles = {ctx->fs_proc});
        if (R_FAILED(rc)) return rc;
        addr += n;
        dst += n;
        len -= (size_t)n;
    }
    return 0;
}

Result vesper_fs_write(VesperKaihenCtx* ctx, uint64_t addr, const void* expected, const void* replacement, size_t len) {
    static uint8_t pair[0x20000];
    const uint8_t* exp = (const uint8_t*)expected;
    const uint8_t* rep = (const uint8_t*)replacement;
    while (len > 0) {
        VesperMemInfo q = {0};
        Result rc = vesper_fs_query(ctx, addr, &q);
        if (R_FAILED(rc)) return rc;
        uint64_t end = q.address + q.size;
        if (end <= addr) return MAKERESULT(Module_Libnx, LibnxError_BadInput);
        uint64_t n = (end - addr < len) ? (end - addr) : len;
        if (n > 0x10000u) n = 0x10000u;

        memcpy(pair, exp, (size_t)n);
        memcpy(pair + n, rep, (size_t)n);

        Out80 r = {0};
        In32 in = {{ctx->fs_pid, addr, n, 0}};
        rc = serviceDispatchInOut(&ctx->dmnt, VESPER_RO_WRITE, in, r,
            .buffer_attrs = {SfBufferAttr_HipcMapAlias | SfBufferAttr_In},
            .buffers = {{pair, (size_t)(2 * n)}},
            .in_num_handles = 1, .in_handles = {ctx->fs_proc});
        if (R_FAILED(rc)) return rc;
        addr += n;
        exp += n;
        rep += n;
        len -= (size_t)n;
    }
    return 0;
}

Result vesper_fs_patch(VesperKaihenCtx* ctx, uint64_t addr, const void* expected, const void* replacement, size_t len) {
    if (len != 16) return MAKERESULT(Module_Libnx, LibnxError_BadInput);
    struct {
        uint64_t pid;
        uint64_t addr;
        uint8_t expected[16];
        uint8_t replacement[16];
    } in;
    in.pid = ctx->fs_pid;
    in.addr = addr;
    memcpy(in.expected, expected, 16);
    memcpy(in.replacement, replacement, 16);
    Out80 r = {0};
    return serviceDispatchInOut(&ctx->dmnt, VESPER_RO_PATCH, in, r,
        .in_num_handles = 1, .in_handles = {ctx->fs_proc});
}

Result vesper_fs_protect(VesperKaihenCtx* ctx, uint64_t addr, size_t len, uint32_t perm) {
    In32 in = {{ctx->fs_pid, addr, len, perm}};
    Out64 r = {0};
    return serviceDispatchInOut(&ctx->dmnt, VESPER_RO_PROTECT, in, r,
        .in_num_handles = 1, .in_handles = {ctx->fs_proc});
}

Result vesper_fs_map_code(VesperKaihenCtx* ctx, const void* code_page_aligned, size_t len, uint64_t* out_fs_addr) {
    if ((len & 0xFFFu) != 0) return MAKERESULT(Module_Libnx, LibnxError_BadInput);
    In32 in = {{ctx->fs_pid, (uint64_t)(uintptr_t)code_page_aligned, len, 0}};
    Out64 r = {0};
    Result rc = serviceDispatchInOut(&ctx->dmnt, VESPER_RO_MAP_CODE, in, r,
        .in_num_handles = 1, .in_handles = {ctx->fs_proc});
    if (R_SUCCEEDED(rc) && out_fs_addr) {
        *out_fs_addr = r.v[0];
    }
    return rc;
}
