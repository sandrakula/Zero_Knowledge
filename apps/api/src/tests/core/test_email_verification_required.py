"""Tests for email_verification_required().

The flag decouples email verification from SaaS mode: email+password signups are
unverified by default, and the opt-out (LEARNHOUSE_REQUIRE_EMAIL_VERIFICATION=false)
is a local-dev convenience that is ignored in production.
"""
from types import SimpleNamespace
from unittest.mock import patch

from src.core.deployment_mode import email_verification_required


def _config(development_mode: bool, require_email_verification: bool):
    return SimpleNamespace(
        general_config=SimpleNamespace(
            development_mode=development_mode,
            require_email_verification=require_email_verification,
        )
    )


def test_required_in_production_even_when_flag_false():
    # Production (development_mode=False) always requires verification; the
    # opt-out flag must not become a silent production bypass.
    with patch(
        "src.core.deployment_mode.get_learnhouse_config",
        return_value=_config(False, False),
    ):
        assert email_verification_required() is True


def test_required_in_production_when_flag_true():
    with patch(
        "src.core.deployment_mode.get_learnhouse_config",
        return_value=_config(False, True),
    ):
        assert email_verification_required() is True


def test_optional_in_dev_when_flag_false():
    # Local dev may explicitly opt out.
    with patch(
        "src.core.deployment_mode.get_learnhouse_config",
        return_value=_config(True, False),
    ):
        assert email_verification_required() is False


def test_required_in_dev_when_flag_true():
    # The default stays production-safe even in development mode.
    with patch(
        "src.core.deployment_mode.get_learnhouse_config",
        return_value=_config(True, True),
    ):
        assert email_verification_required() is True
