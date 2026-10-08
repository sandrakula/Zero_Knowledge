"""ZEROK-4: generation and validation of Python diagnostic tasks."""

from .errors import (
    AttemptsExhaustedError,
    GeneratedBlockInvalidError,
    IsolatedExecutionUnavailableError,
    ProviderUnavailableError,
    ReferenceNotExecutedError,
    ReferenceSolutionFailedError,
    Zerok4Error,
)
from .orchestrator import GeneratedTaskBlock, TaskBlockService
from .ports import IsolatedExecutionRunner, TaskGenerationProvider
from .stubs import UnavailableExecutionRunner, UnavailableTaskGenerationProvider
from .validation import parse_and_validate_block

__all__ = [
    "AttemptsExhaustedError",
    "GeneratedBlockInvalidError",
    "GeneratedTaskBlock",
    "IsolatedExecutionRunner",
    "IsolatedExecutionUnavailableError",
    "ProviderUnavailableError",
    "ReferenceNotExecutedError",
    "ReferenceSolutionFailedError",
    "TaskBlockService",
    "TaskGenerationProvider",
    "UnavailableExecutionRunner",
    "UnavailableTaskGenerationProvider",
    "Zerok4Error",
    "parse_and_validate_block",
]
