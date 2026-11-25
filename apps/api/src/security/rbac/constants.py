"""
RBAC Role Constants

This module defines role ID constants used throughout the RBAC system.
Using constants instead of magic numbers improves code maintainability and clarity.

Role Hierarchy:
    ADMIN (1) - Full access to all resources and organization management
    INSTRUCTOR (3) - Can manage their own content
    USER (4) - Read-only learner

    MAINTAINER (2) is retired. The constant is kept only so old data and
    third-party imports do not crash; the role row is removed by migration and
    it no longer grants elevated access anywhere.
"""

# Core role IDs - these match the database seed data
ADMIN_ROLE_ID = 1
MAINTAINER_ROLE_ID = 2  # retired; no longer an elevated role

# Role ID sets for common checks. The legacy name is kept as an alias so the
# existing call sites keep working, but it now contains only the admin role.
ADMIN_ROLE_IDS = frozenset([ADMIN_ROLE_ID])
ADMIN_OR_MAINTAINER_ROLE_IDS = ADMIN_ROLE_IDS


def is_admin(role_id: int) -> bool:
    """Check if the role ID is an admin role."""
    return role_id == ADMIN_ROLE_ID


def is_admin_or_maintainer(role_id: int) -> bool:
    """Legacy name: true only for the admin role (Maintainer is retired)."""
    return role_id in ADMIN_OR_MAINTAINER_ROLE_IDS


def has_elevated_privileges(role_id: int) -> bool:
    """True only for the admin role; Maintainer no longer exists."""
    return role_id in ADMIN_OR_MAINTAINER_ROLE_IDS
