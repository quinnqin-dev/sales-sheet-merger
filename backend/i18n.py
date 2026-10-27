"""Stable message codes shared by API responses, jobs and localized exports."""
from contextvars import ContextVar
import json
from pathlib import Path

from fastapi import HTTPException

LOCALE = ContextVar('sales_merger_locale', default='en')

# English is the source language. User-authored values never pass through this catalog.
_CATALOG_DIR = Path(__file__).resolve().parents[1] / 'shared/locales'
_EN = json.loads((_CATALOG_DIR / 'en.json').read_text(encoding='utf-8'))
_ZH = json.loads((_CATALOG_DIR / 'zh-CN.json').read_text(encoding='utf-8'))
MESSAGES = {code: (value, _ZH[code]) for code, value in _EN.items()}


def resolve_locale(value):
    # Respect the explicit preference and q weights; never infer from the OS.
    candidates = []
    for index, part in enumerate((value or '').split(',')):
        pieces = part.strip().split(';')
        tag, weight = pieces[0].lower(), 1.0
        for parameter in pieces[1:]:
            if parameter.strip().startswith('q='):
                try:
                    weight = float(parameter.strip()[2:])
                except ValueError:
                    weight = 0
        if 0 < weight <= 1:
            candidates.append((-weight, index, tag))
    for _, _, tag in sorted(candidates):
        if tag in ('zh', 'zh-cn', 'zh-hans'):
            return 'zh-CN'
        if tag == 'en' or tag.startswith('en-'):
            return 'en'
    return 'en'


def text(code, params=None, locale=None):
    pair = MESSAGES[code]
    return pair[1 if (locale or LOCALE.get()) == 'zh-CN' else 0].format(**(params or {}))


class DomainError(ValueError):
    def __init__(self, code, **params):
        self.code, self.params = code, params
        super().__init__(text(code, params))


class Problem(HTTPException):
    def __init__(self, status, code, **params):
        self.code, self.params = code, params
        super().__init__(status, text(code, params))


def descriptor(exc):
    if isinstance(exc, DomainError):
        return exc.code, exc.params
    if isinstance(exc, UnicodeError):
        return 'encoding_error', {}
    return 'file_unreadable', {}


def error_fields(code=None, params=None):
    return {'error': text(code, params) if code else None,
            'error_code': code, 'error_params': params or {}}


def localize_reason(reason):
    return {**reason, 'reason': text(reason['code'], reason.get('params'))} if reason.get('code') else reason
