"""Encrypt/decrypt the Informatics password.

The JWT secret is the only key material already present in every deployment.
Fernet (AES-128-CBC + HMAC) keeps the password unreadable at rest without
adding another required environment variable. The derived key never leaves this
module and the plaintext is only used inside an operation, never persisted.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from config.config import get_learnhouse_config


def _fernet() -> Fernet:
    secret = get_learnhouse_config().security_config.auth_jwt_secret_key or ""
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(value: str) -> str:
    if not value:
        return ""
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return ""
