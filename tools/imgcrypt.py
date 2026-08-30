#!/usr/bin/env python3
import getpass, hashlib, io, shutil, sys, tempfile, zipfile
from datetime import datetime
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESSIV

TIME = (1980, 1, 1, 0, 0, 0)

def key():
  return hashlib.sha512(getpass.getpass("Password: ").encode()).digest()

def pack(root):
  b = io.BytesIO()
  with zipfile.ZipFile(b, "w", zipfile.ZIP_STORED) as z:
    for p in sorted(root.rglob("*")):
      if p.is_file():
        i = zipfile.ZipInfo(p.relative_to(root).as_posix(), TIME)
        i.create_system = 3
        i.external_attr = 0o100644 << 16
        z.writestr(i, p.read_bytes())
  return b.getvalue()

def backup(dst):
  backup_dir = dst.parent / ".backup"
  backup_dir.mkdir(exist_ok=True)
  timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
  backup_path = backup_dir / f"{dst.name}-{timestamp}"
  shutil.move(dst, backup_path)
  return backup_path

def unpack(data, dst):
  with tempfile.TemporaryDirectory() as tmp:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
      z.extractall(tmp)
    if dst.exists():
      print(f"Backup: {backup(dst)}")
    shutil.copytree(tmp, dst)

mode, src, dst = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
aes = AESSIV(key())

if mode == "encrypt":
  dst.write_bytes(aes.encrypt(pack(src), []))
else:
  unpack(aes.decrypt(src.read_bytes(), []), dst)
