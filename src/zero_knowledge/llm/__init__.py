"""ZEROK-1: HTTP-клиент DeepSeek и обработка структурированного JSON."""

from .deepseek import ChatResult, DeepSeekClient, DeepSeekJsonError

__all__ = ["ChatResult", "DeepSeekClient", "DeepSeekJsonError"]
