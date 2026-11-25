"""A brand-new organization starts without podcasts, communities and playgrounds."""

import json

from src.db.organization_config import (
    DEFAULT_DISABLED_FEATURES,
    OrganizationConfigV2Base,
    apply_new_org_feature_defaults,
)


def _fresh_config() -> dict:
    return json.loads(OrganizationConfigV2Base(config_version="2.0", plan="free").model_dump_json())


class TestNewOrgFeatureDefaults:
    def test_default_install_disables_the_optional_sections(self):
        config = apply_new_org_feature_defaults(_fresh_config())

        toggles = config["admin_toggles"]
        for feature in DEFAULT_DISABLED_FEATURES:
            assert toggles[feature]["org_disabled"] is True, feature

        # The core learning surface stays on.
        for feature in ("folders", "boards", "paths"):
            assert toggles[feature]["org_disabled"] is False, feature

    def test_explicit_config_can_keep_a_section_enabled(self):
        config = _fresh_config()
        # Simulate a caller that only spoke about communities, leaving the other
        # features unset rather than explicitly disabled.
        config["admin_toggles"].pop("podcasts", None)
        config["admin_toggles"].pop("playgrounds", None)
        config["admin_toggles"]["communities"]["org_disabled"] = False

        config = apply_new_org_feature_defaults(config, force=False)

        assert config["admin_toggles"]["communities"]["org_disabled"] is False
        # The other defaults still apply to keys the caller did not set.
        assert config["admin_toggles"]["podcasts"]["org_disabled"] is True
        assert config["admin_toggles"]["playgrounds"]["org_disabled"] is True
