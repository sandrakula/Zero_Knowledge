"""HTTP integration layer for the ZEROK-7 browser PoC."""

from .api import ApiApplication, ApiError, ApiResponse
from .service import DiagnosticService

__all__ = ["ApiApplication", "ApiError", "ApiResponse", "DiagnosticService"]
