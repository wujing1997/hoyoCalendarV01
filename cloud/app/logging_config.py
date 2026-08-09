"""Logging setup with redaction so secrets and bodies never reach logs."""

import logging
import sys

from .security import redact


class RedactingFormatter(logging.Formatter):
    """Apply redaction to the fully formatted line."""

    def format(self, record):
        message = super().format(record)
        return redact(message)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    if not root.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(RedactingFormatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s"
        ))
        root.addHandler(handler)
    else:
        for handler in root.handlers:
            if not isinstance(handler.formatter, RedactingFormatter):
                handler.setFormatter(RedactingFormatter(
                    "%(asctime)s %(levelname)s %(name)s %(message)s"
                ))
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.setLevel(getattr(logging, level.upper(), logging.INFO))
        logger.propagate = True
