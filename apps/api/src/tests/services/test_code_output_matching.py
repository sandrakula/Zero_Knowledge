from src.services.courses.activities.assignments import _code_outputs_match


class TestCodeOutputsMatch:
    def test_exact_text_matches(self):
        assert _code_outputs_match("5", "5")
        assert _code_outputs_match("hello\nworld", "hello\nworld")

    def test_numeric_formatting_matches_when_enabled(self):
        assert _code_outputs_match("5", "5.0", allow_numeric=True)
        assert _code_outputs_match("5.0000001", "5.0", allow_numeric=True)
        assert _code_outputs_match("1\n2.5", "1.0\n2.50", allow_numeric=True)

    def test_numeric_mismatch_fails(self):
        assert not _code_outputs_match("5.1", "5.0", allow_numeric=True)
        assert not _code_outputs_match("5\n6", "5", allow_numeric=True)

    def test_numeric_tolerance_is_opt_in(self):
        assert not _code_outputs_match("5", "5.0")

    def test_non_numeric_text_is_not_coerced(self):
        assert not _code_outputs_match("abc", "abc ", allow_numeric=True)
