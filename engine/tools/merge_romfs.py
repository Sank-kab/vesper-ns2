#!/usr/bin/env python3
"""Build and verify a Switch RomFS from an update tree plus base-only files.

Requires Python 3.9+. Never modifies either input tree or an existing output.
"""
import argparse
import hashlib
import os
import shutil
import struct
from pathlib import Path

EMPTY = 0xFFFFFFFF


def align(n, a):
    return (n + a - 1) & -a


def bucket_count(n):
    if n < 3:
        return 3
    if n < 19:
        return n | 1
    while any(n % p == 0 for p in (2, 3, 5, 7, 11, 13, 17)):
        n += 1
    return n


def name_hash(parent_offset, name):
    h = parent_offset ^ 123456789
    for b in name.encode("utf-8"):
        h = ((h >> 5) | (h << 27)) & 0xFFFFFFFF
        h ^= b
    return h


def scan(root):
    if not root.is_dir():
        raise ValueError(f"Input directory absent: {root}")
    dirs = {""}
    files = {}
    for current, children, names in os.walk(root, followlinks=False):
        rel_dir = Path(current).relative_to(root).as_posix()
        if rel_dir == ".":
            rel_dir = ""
        for name in children:
            p = Path(current) / name
            if p.is_symlink():
                raise ValueError(f"Symlink directory: {p}")
            dirs.add(f"{rel_dir}/{name}".lstrip("/"))
        for name in names:
            p = Path(current) / name
            if not p.is_file() or p.is_symlink():
                raise ValueError(f"Unsupported file: {p}")
            files[f"{rel_dir}/{name}".lstrip("/")] = p
    return dirs, files


def make_plan(update, base):
    ud, uf = scan(update)
    bd, bf = scan(base)
    overlap = uf.keys() & bf.keys()
    if overlap:
        raise ValueError(f"Base-only tree overlaps update: {len(overlap)} paths")
    dirs = sorted(ud | bd)
    files = dict(sorted((uf | bf).items()))
    if any(len(p.encode("utf-8")) > 4096 for p in files):
        raise ValueError("Path exceeds 4096 bytes")
    return dirs, files


def parent_and_name(path):
    a, _, b = path.rpartition("/")
    return a, b


def tables(dirs, files, sizes, offsets):
    dir_offsets, file_offsets = {}, {}
    dsize = fsize = 0
    for path in dirs:
        name = "" if not path else parent_and_name(path)[1]
        dir_offsets[path] = dsize
        dsize += 24 + align(len(name.encode("utf-8")), 4)
    for path in files:
        file_offsets[path] = fsize
        fsize += 32 + align(
            len(parent_and_name(path)[1].encode("utf-8")), 4
        )
    if dsize >= 2**32 or fsize >= 2**32:
        raise ValueError("RomFS metadata table exceeds 32-bit offset range")

    children, members = {}, {}
    for path in dirs[1:]:
        parent, _ = parent_and_name(path)
        children.setdefault(parent, []).append(path)
    for path in files:
        parent, _ = parent_and_name(path)
        members.setdefault(parent, []).append(path)
    dsib = {
        p: group[i + 1] if i + 1 < len(group) else None
        for group in children.values()
        for i, p in enumerate(group)
    }
    fsib = {
        p: group[i + 1] if i + 1 < len(group) else None
        for group in members.values()
        for i, p in enumerate(group)
    }

    dh = [EMPTY] * bucket_count(len(dirs))
    fh = [EMPTY] * bucket_count(len(files))
    dt = bytearray(dsize)
    ft = bytearray(fsize)
    for path in dirs:
        parent, name = ("", "") if not path else parent_and_name(path)
        po = dir_offsets[parent]
        off = dir_offsets[path]
        b = name.encode("utf-8")
        slot = name_hash(po, name) % len(dh)
        struct.pack_into(
            "<6I", dt, off,
            po,
            dir_offsets[dsib[path]] if dsib.get(path) else EMPTY,
            dir_offsets[children[path][0]] if children.get(path) else EMPTY,
            file_offsets[members[path][0]] if members.get(path) else EMPTY,
            dh[slot],
            len(b),
        )
        dt[off + 24:off + 24 + len(b)] = b
        dh[slot] = off
    for path in files:
        parent, name = parent_and_name(path)
        po = dir_offsets[parent]
        off = file_offsets[path]
        b = name.encode("utf-8")
        slot = name_hash(po, name) % len(fh)
        struct.pack_into(
            "<IIQQII", ft, off,
            po,
            file_offsets[fsib[path]] if fsib.get(path) else EMPTY,
            offsets[path],
            sizes[path],
            fh[slot],
            len(b),
        )
        ft[off + 32:off + 32 + len(b)] = b
        fh[slot] = off
    return (
        struct.pack(f"<{len(dh)}I", *dh),
        dt,
        struct.pack(f"<{len(fh)}I", *fh),
        ft,
    )


def build(update, base, output, expect_files):
    dirs, files = make_plan(update, base)
    if expect_files is not None and len(files) != expect_files:
        raise ValueError(f"Expected {expect_files} files, found {len(files)}")
    sizes = {p: src.stat().st_size for p, src in files.items()}
    offsets = {}
    end = 0
    for path in files:
        end = align(end, 16)
        offsets[path] = end
        end += sizes[path]
    parts = tables(dirs, files, sizes, offsets)
    meta = align(0x200 + end, 4)
    dh, dt, fh, ft = parts
    header = struct.pack(
        "<10Q",
        0x50,
        meta,
        len(dh),
        meta + len(dh),
        len(dt),
        meta + len(dh) + len(dt),
        len(fh),
        meta + len(dh) + len(dt) + len(fh),
        len(ft),
        0x200,
    )
    print(
        f"Planned: {len(dirs)} dirs, {len(files)} files, "
        f"{meta + sum(map(len, parts))} image bytes",
        flush=True,
    )
    with output.open("xb") as dst:
        dst.write(header)
        dst.write(bytes(0x200 - len(header)))
        for i, (path, src) in enumerate(files.items(), 1):
            target = 0x200 + offsets[path]
            dst.write(bytes(target - dst.tell()))
            with src.open("rb") as inp:
                shutil.copyfileobj(inp, dst, 4 * 1024 * 1024)
            if dst.tell() != target + sizes[path]:
                raise ValueError(f"Input file changed while reading: {src}")
            if i % 10000 == 0:
                print(f"Wrote {i}/{len(files)} files", flush=True)
        dst.write(bytes(meta - dst.tell()))
        for part in parts:
            dst.write(part)
    print(f"Built: {output} ({output.stat().st_size} bytes)", flush=True)


def image_files(image):
    with image.open("rb") as f:
        h = struct.unpack("<10Q", f.read(80))
        if h[0] != 80 or h[9] < 80:
            raise ValueError("Invalid RomFS header")
        total = image.stat().st_size
        for start, size in (
            (h[1], h[2]), (h[3], h[4]),
            (h[5], h[6]), (h[7], h[8]),
        ):
            if start + size > total:
                raise ValueError("RomFS table out of image bounds")
        f.seek(h[3])
        dt = f.read(h[4])
        f.seek(h[7])
        ft = f.read(h[8])

    found = {}
    seen_d, seen_f = set(), set()
    stack = [("", 0)]
    while stack:
        parent_path, d = stack.pop()
        if d in seen_d or d + 24 > len(dt):
            raise ValueError("Bad or cyclic directory table")
        seen_d.add(d)
        _, _, child, first_file, _, _ = struct.unpack_from("<6I", dt, d)
        child_list = []
        while child != EMPTY:
            if child + 24 > len(dt):
                raise ValueError("Bad child directory offset")
            _, sibling, _, _, _, n = struct.unpack_from("<6I", dt, child)
            name = dt[child + 24:child + 24 + n].decode("utf-8")
            child_list.append((f"{parent_path}/{name}".lstrip("/"), child))
            child = sibling
            if len(child_list) > len(dt) // 24:
                raise ValueError("Cyclic directory siblings")
        stack.extend(child_list)
        item = first_file
        while item != EMPTY:
            if item in seen_f or item + 32 > len(ft):
                raise ValueError("Bad or cyclic file table")
            seen_f.add(item)
            _, sibling, off, size, _, n = struct.unpack_from(
                "<IIQQII", ft, item
            )
            name = ft[item + 32:item + 32 + n].decode("utf-8")
            path = f"{parent_path}/{name}".lstrip("/")
            if h[9] + off + size > total:
                raise ValueError(f"File out of image bounds: {path}")
            found[path] = (h[9] + off, size)
            item = sibling
    return found


def sha_range(f, size):
    h = hashlib.sha256()
    while size:
        chunk = f.read(min(size, 4 * 1024 * 1024))
        if not chunk:
            raise ValueError("Unexpected end of file")
        h.update(chunk)
        size -= len(chunk)
    return h.digest()


def verify(update, base, image):
    _, source = make_plan(update, base)
    entries = image_files(image)
    if source.keys() != entries.keys():
        raise ValueError(
            f"Path mismatch: missing={len(source.keys() - entries.keys())}, "
            f"extra={len(entries.keys() - source.keys())}"
        )
    with image.open("rb") as inp:
        for i, (path, src) in enumerate(source.items(), 1):
            off, size = entries[path]
            if src.stat().st_size != size:
                raise ValueError(f"Size mismatch: {path}")
            inp.seek(off)
            a = sha_range(inp, size)
            with src.open("rb") as sf:
                b = sha_range(sf, size)
            if a != b:
                raise ValueError(f"Content mismatch: {path}")
            if i % 10000 == 0:
                print(f"Verified {i}/{len(source)} files", flush=True)
    print(
        f"PASS: {len(source)} paths and all file bytes match",
        flush=True,
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("action", choices=("build", "verify"))
    ap.add_argument("--update", type=Path, required=True)
    ap.add_argument("--base-only", type=Path, required=True)
    ap.add_argument("--image", type=Path, required=True)
    ap.add_argument("--expect-files", type=int)
    a = ap.parse_args()
    update = a.update.expanduser()
    if (update / "romfs").is_dir():
        update /= "romfs"
    base = a.base_only.expanduser()
    image = a.image.expanduser()
    if a.action == "build":
        build(update, base, image, a.expect_files)
    else:
        verify(update, base, image)


if __name__ == "__main__":
    main()
