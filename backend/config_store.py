import json
import os
import threading
from copy import deepcopy


PROVIDER_DEFAULTS = {
    'doubao': {
        'baseUrl': 'https://ark.cn-beijing.volces.com/api/v3',
        'model': '',
        'apiKey': '',
    },
    'ollama': {
        'baseUrl': 'http://localhost:11434',
        'model': 'llama3.2',
        'apiKey': '',
    },
    'openai': {
        'baseUrl': 'https://api.openai.com/v1',
        'model': '',
        'apiKey': '',
    },
}


def deep_merge(base: dict, updates: dict) -> dict:
    result = deepcopy(base)
    for key, value in (updates or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


class ConfigStore:
    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.config_file = os.path.join(data_dir, 'config.json')
        self.lock = threading.RLock()
        os.makedirs(data_dir, exist_ok=True)

    def defaults(self) -> dict:
        return {
            'ai': {
                'provider': 'doubao',
                **deepcopy(PROVIDER_DEFAULTS),
            }
        }

    def load(self) -> dict:
        with self.lock:
            stored = {}
            try:
                if os.path.exists(self.config_file):
                    with open(self.config_file, 'r', encoding='utf-8') as handle:
                        parsed = json.load(handle)
                        if isinstance(parsed, dict):
                            stored = parsed
            except (OSError, ValueError):
                stored = {}
            return deep_merge(self.defaults(), stored)

    def save(self, updates: dict) -> dict:
        with self.lock:
            merged = deep_merge(self.load(), updates if isinstance(updates, dict) else {})
            temp_file = f'{self.config_file}.{os.getpid()}.tmp'
            with open(temp_file, 'w', encoding='utf-8') as handle:
                json.dump(merged, handle, ensure_ascii=False, indent=2)
            os.replace(temp_file, self.config_file)
            return merged

    def ai_settings(self) -> dict:
        config = self.load()
        ai = config.get('ai', {})
        provider = ai.get('provider', 'doubao')
        if provider not in PROVIDER_DEFAULTS:
            provider = 'doubao'
        provider_config = deep_merge(PROVIDER_DEFAULTS[provider], ai.get(provider, {}))
        base_url = str(provider_config.get('baseUrl') or '').rstrip('/')
        if provider == 'ollama' and not base_url.endswith('/v1'):
            base_url = f'{base_url}/v1'
        api_key = provider_config.get('apiKey') or ('ollama' if provider == 'ollama' else '')
        return {
            'provider': provider,
            'base_url': base_url,
            'api_key': api_key,
            'model': str(provider_config.get('model') or '').strip(),
        }

    def is_ai_configured(self) -> bool:
        settings = self.ai_settings()
        if not settings['model']:
            return False
        return settings['provider'] == 'ollama' or bool(settings['api_key'])
