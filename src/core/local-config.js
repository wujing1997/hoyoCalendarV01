'use strict';

const fs = require('fs');
const path = require('path');

const PROVIDER_DEFAULTS = {
  doubao: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: '',
    apiKey: '',
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
    apiKey: '',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    apiKey: '',
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, updates) {
  const result = clone(base);
  for (const [key, value] of Object.entries(updates || {})) {
    if (
      value && typeof value === 'object' && !Array.isArray(value)
      && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function defaultConfig() {
  return {
    ai: {
      provider: 'doubao',
      ...clone(PROVIDER_DEFAULTS),
    },
  };
}

class LocalConfig {
  constructor(filePath) {
    this.filePath = filePath;
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return defaultConfig();
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return deepMerge(defaultConfig(), parsed);
      }
      return defaultConfig();
    } catch (_) {
      return defaultConfig();
    }
  }

  save(updates) {
    const merged = deepMerge(this.load(), updates && typeof updates === 'object' ? updates : {});
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempFile = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(merged, null, 2), 'utf8');
    fs.renameSync(tempFile, this.filePath);
    return merged;
  }
}

module.exports = { LocalConfig, deepMerge, defaultConfig, PROVIDER_DEFAULTS };
