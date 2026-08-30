#!/usr/bin/env python3
"""Encrypt or decrypt the private img directory.

The archive is intentionally deterministic: unchanged source files produce the
same ZIP bytes, and AESSIV deterministically produces the same ciphertext for
the same ZIP and password.
"""

import getpass
import hashlib
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESSIV


TMP_ZIP = Path("/tmp/vbot_img.zip")
TMP_UNPACKED = Path("/tmp/vbot_img_unpacked")
BACKUP_DIR = Path("/tmp/vbot-img-backups")
FIXED_ZIP_TIME = (1980, 1, 1, 0, 0, 0)


def key_from_password() -> bytes:
    password = getpass.getpass("Password: ")
    return hashlib.sha512(password.encode()).digest()


def archive_entries(root: Path):
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        if path.is_symlink():
            raise RuntimeError(f"Refusing to archive symlink: {path}")
        yield path


def make_deterministic_zip(src: Path, dst: Path) -> None:
    if not src.is_dir():
        raise RuntimeError(f"Source directory does not exist: {src}")

    dst.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(
        dst, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for path in archive_entries(src):
            relative = path.relative_to(src).as_posix()
            if path.is_dir():
                if any(path.iterdir()):
                    continue
                info = zipfile.ZipInfo(f"{relative}/", FIXED_ZIP_TIME)
                info.compress_type = zipfile.ZIP_STORED
                info.create_system = 3
                info.external_attr = (0o40755 << 16) | 0x10
                archive.writestr(info, b"")
                continue

            info = zipfile.ZipInfo(relative, FIXED_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(
                info,
                path.read_bytes(),
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def validate_zip_paths(archive: zipfile.ZipFile) -> None:
    root = TMP_UNPACKED.resolve()
    for info in archive.infolist():
        destination = (TMP_UNPACKED / info.filename).resolve()
        try:
            destination.relative_to(root)
        except ValueError as error:
            raise RuntimeError(f"Unsafe archive path: {info.filename}") from error

        mode = (info.external_attr >> 16) & 0o170000
        if mode == 0o120000:
            raise RuntimeError(f"Refusing to extract symlink: {info.filename}")


def current_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "nogit"


def backup_existing(dst: Path) -> Path | None:
    if not dst.is_dir():
        return None

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = BACKUP_DIR / f"{timestamp}_{current_commit()}.zip"
    suffix = 1
    while backup.exists():
        backup = BACKUP_DIR / f"{timestamp}_{current_commit()}_{suffix}.zip"
        suffix += 1
    make_deterministic_zip(dst, backup)
    return backup


def encrypt(src: Path, dst: Path) -> None:
    make_deterministic_zip(src, TMP_ZIP)
    plaintext = TMP_ZIP.read_bytes()
    ciphertext = AESSIV(key_from_password()).encrypt(plaintext, [])
    atomic_write(dst, ciphertext)
    TMP_ZIP.unlink()
    print(f"Encrypted {src} -> {dst}")


def decrypt(src: Path, dst: Path) -> None:
    if not src.is_file():
        raise RuntimeError(f"Encrypted archive does not exist: {src}")

    ciphertext = src.read_bytes()
    try:
        plaintext = AESSIV(key_from_password()).decrypt(ciphertext, [])
    except InvalidTag as error:
        raise RuntimeError("Wrong password or damaged encrypted archive") from error

    TMP_ZIP.write_bytes(plaintext)
    if TMP_UNPACKED.exists():
        shutil.rmtree(TMP_UNPACKED)
    TMP_UNPACKED.mkdir(parents=True)

    with zipfile.ZipFile(TMP_ZIP, "r") as archive:
        validate_zip_paths(archive)
        damaged = archive.testzip()
        if damaged is not None:
            raise RuntimeError(f"Damaged ZIP entry: {damaged}")
        archive.extractall(TMP_UNPACKED)

    backup = backup_existing(dst)
    if dst.exists():
        if not dst.is_dir():
            raise RuntimeError(f"Destination exists and is not a directory: {dst}")
        shutil.rmtree(dst)
    shutil.copytree(TMP_UNPACKED, dst)

    TMP_ZIP.unlink()
    shutil.rmtree(TMP_UNPACKED)
    if backup is not None:
        print(f"Backup: {backup}")
    print(f"Decrypted {src} -> {dst}")


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[1] not in {"encrypt", "decrypt"}:
        print(
            f"Usage: {sys.argv[0]} encrypt SRC_DIR DST_FILE\n"
            f"       {sys.argv[0]} decrypt SRC_FILE DST_DIR",
            file=sys.stderr,
        )
        return 2

    mode, src_arg, dst_arg = sys.argv[1:]
    try:
        if mode == "encrypt":
            encrypt(Path(src_arg), Path(dst_arg))
        else:
            decrypt(Path(src_arg), Path(dst_arg))
    except (OSError, RuntimeError, zipfile.BadZipFile) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
