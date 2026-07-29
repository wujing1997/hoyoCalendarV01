"""
HoyoCalendar Python Backend
Flask 服务，提供日程 CRUD API 和基于豆包 Function Call 的对话式日程管理。
"""
import json
import os
import re
import sys
import time
import threading
import io
from datetime import datetime, date, timedelta

# 强制 stdout/stderr 使用 UTF-8 编码
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI

app = Flask(__name__)
CORS(app)

# ======== 配置 ========
# 各提供商的默认 Base URL（API Key 和 Model 由用户在设置中填写）
PROVIDER_DEFAULTS = {
    'doubao': {
        'base_url': 'https://ark.cn-beijing.volces.com/api/v3',
    },
    'ollama': {
        'base_url': 'http://localhost:11434/v1',
    },
    'openai': {
        'base_url': 'https://api.openai.com/v1',
    },
}

DATA_DIR = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'HoyoCalendar')
EVENTS_FILE = os.path.join(DATA_DIR, 'events.json')
CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')
os.makedirs(DATA_DIR, exist_ok=True)

# ======== 配置管理 ========
def load_config() -> dict:
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def get_ai_config() -> dict:
    """根据用户选择的 provider 返回对应的 AI 配置。"""
    config = load_config()
    ai = config.get('ai', {})
    provider = ai.get('provider', 'doubao')
    defaults = PROVIDER_DEFAULTS.get(provider, PROVIDER_DEFAULTS['doubao'])
    provider_cfg = ai.get(provider, {})
    base_url = provider_cfg.get('baseUrl') or provider_cfg.get('base_url') or defaults['base_url']
    # Ollama 用户通常填 http://localhost:11434，需要自动补 /v1 以兼容 OpenAI SDK
    if provider == 'ollama' and base_url and not base_url.rstrip('/').endswith('/v1'):
        base_url = base_url.rstrip('/') + '/v1'
    return {
        'api_key': provider_cfg.get('apiKey') or provider_cfg.get('api_key') or 'ollama',
        'base_url': base_url,
        'model': provider_cfg.get('model') or '',
    }


def make_client() -> OpenAI:
    cfg = get_ai_config()
    return OpenAI(base_url=cfg['base_url'], api_key=cfg['api_key'])


# ======== 事件存储 ========
_id_lock = threading.Lock()
_id_counter = 0


def generate_id() -> int:
    global _id_counter
    with _id_lock:
        _id_counter += 1
        return int(time.time() * 1000) * 1000 + _id_counter


def load_events() -> list:
    try:
        if os.path.exists(EVENTS_FILE):
            with open(EVENTS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return []


def save_events(events: list) -> None:
    with open(EVENTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(events, f, ensure_ascii=False, indent=2)


CHINESE_NUMBER_MAP = {
    '零': 0,
    '〇': 0,
    '一': 1,
    '二': 2,
    '两': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '七': 7,
    '八': 8,
    '九': 9,
}


def parse_chinese_number(text: str) -> float | None:
    if not text:
        return None
    if text == '十':
        return 10
    if text.startswith('十'):
        tail = CHINESE_NUMBER_MAP.get(text[1:], 0) if len(text) > 1 else 0
        return 10 + tail
    if '十' in text:
        head, tail = text.split('十', 1)
        head_num = CHINESE_NUMBER_MAP.get(head, 1)
        tail_num = CHINESE_NUMBER_MAP.get(tail, 0) if tail else 0
        return head_num * 10 + tail_num
    return CHINESE_NUMBER_MAP.get(text)


def parse_duration_minutes(text: str) -> int | None:
    """Extract a simple Chinese or numeric duration from task text."""
    if not text:
        return None
    half_hour_match = re.search(r'半\s*(?:个)?\s*小时', text)
    if half_hour_match:
        return 30

    number_pattern = r'(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十]+)'
    hour_match = re.search(number_pattern + r'\s*(?:个)?\s*(?:小时|钟头)', text)
    if hour_match:
        raw = hour_match.group(1)
        hours = float(raw) if re.match(r'\d', raw) else parse_chinese_number(raw)
        if hours and hours > 0:
            return int(round(hours * 60))

    minute_match = re.search(number_pattern + r'\s*(?:分钟|分)', text)
    if minute_match:
        raw = minute_match.group(1)
        minutes = float(raw) if re.match(r'\d', raw) else parse_chinese_number(raw)
        if minutes and minutes > 0:
            return int(round(minutes))

    return None


def clean_duration_from_event_title(title: str, is_recurring: bool = False) -> str:
    cleaned = re.sub(r'(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十半]+)\s*(?:个)?\s*(?:小时|钟头|分钟|分)', '', title or '')
    if is_recurring:
        cleaned = re.sub(r'^(每天|每日|每周|每月)\s*', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned or title


# ======== 循环日程工具 ========
def is_date_in_recurring_range(date_str: str, event: dict) -> bool:
    """判断指定日期是否在循环日程的有效范围内（包含重复类型检查）。"""
    try:
        d = datetime.strptime(date_str, '%Y-%m-%d').date()
        start = datetime.strptime(event.get('startDate', '2000-01-01'), '%Y-%m-%d').date()
        end = datetime.strptime(event.get('endDate', '2099-12-31'), '%Y-%m-%d').date()
        if d < start or d > end:
            return False
        recurring_type = event.get('recurringType', 'daily')
        if recurring_type == 'daily':
            return True
        elif recurring_type == 'weekly':
            # recurringDays 使用 JS getDay() 格式: 0=周日, 1=周一, ..., 6=周六
            days = event.get('recurringDays') or []
            js_day = (d.weekday() + 1) % 7
            return js_day in days
        elif recurring_type == 'monthly':
            return d.day == start.day
        return True
    except Exception:
        return False


def calculate_recurring_progress(event: dict, current_date_str: str) -> dict:
    """计算长期任务的进度信息。"""
    try:
        start = datetime.strptime(event.get('startDate', '2000-01-01'), '%Y-%m-%d').date()
        end = datetime.strptime(event.get('endDate', '2099-12-31'), '%Y-%m-%d').date()
        cur = datetime.strptime(current_date_str, '%Y-%m-%d').date()
        completed_dates = event.get('completedDates') or []
        recurring_type = event.get('recurringType', 'daily')

        total_days = 0
        passed_days = 0

        if recurring_type == 'daily':
            total_days = (end - start).days + 1
            passed_days = (cur - start).days + 1
        elif recurring_type == 'weekly':
            days = event.get('recurringDays') or []
            d = start
            while d <= end:
                js_day = (d.weekday() + 1) % 7
                if js_day in days:
                    total_days += 1
                    if d <= cur:
                        passed_days += 1
                d += timedelta(days=1)
        elif recurring_type == 'monthly':
            d = start
            while d <= end:
                if d.day == start.day:
                    total_days += 1
                    if d <= cur:
                        passed_days += 1
                d += timedelta(days=1)

        percentage = round(len(completed_dates) / total_days * 100) if total_days > 0 else 0
        return {
            'completed': len(completed_dates),
            'total': total_days,
            'passed': passed_days,
            'percentage': percentage,
        }
    except Exception:
        return {'completed': 0, 'total': 0, 'passed': 0, 'percentage': 0}


def calculate_days_remaining(current_date_str: str, deadline_date_str: str) -> int | None:
    try:
        current = datetime.strptime(current_date_str, '%Y-%m-%d').date()
        deadline = datetime.strptime(deadline_date_str, '%Y-%m-%d').date()
        return max(0, (deadline - current).days)
    except Exception:
        return None


def is_date_in_deadline_range(date_str: str, event: dict) -> bool:
    """判断 deadline 任务是否应在指定日期出现。"""
    if event.get('isDeadlineCompleted'):
        return False
    try:
        d = datetime.strptime(date_str, '%Y-%m-%d').date()
        start = datetime.strptime(event.get('startDate') or event.get('date'), '%Y-%m-%d').date()
        deadline = datetime.strptime(event.get('deadlineDate') or event.get('endDate'), '%Y-%m-%d').date()
        return start <= d <= deadline
    except Exception:
        return False


def extract_deadline_from_text(text: str) -> dict | None:
    """Deterministically parse common deadline phrases like "8月10号前写完论文"."""
    if not text:
        return None
    today = datetime.now().date()
    patterns = [
        r'(?P<month>\d{1,2})\s*月\s*(?P<day>\d{1,2})\s*(?:日|号)?\s*(?:前|之前|以前)\s*(?P<title>.+)',
        r'(?P<title>.+?)\s*(?:在|于)?\s*(?P<month>\d{1,2})\s*月\s*(?P<day>\d{1,2})\s*(?:日|号)?\s*(?:前|之前|以前|截止|截止前)',
        r'(?:截止|deadline|by|before)\s*(?:到)?\s*(?P<month>\d{1,2})\s*月\s*(?P<day>\d{1,2})\s*(?:日|号)?\s*(?P<title>.+)?',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        month = int(match.group('month'))
        day = int(match.group('day'))
        try:
            deadline = date(today.year, month, day)
            if deadline < today:
                deadline = date(today.year + 1, month, day)
        except ValueError:
            return None
        title = (match.groupdict().get('title') or text).strip()
        title = re.sub(r'^(前|之前|以前|截止|截止前|完成|做完)\s*', '', title)
        title = re.sub(r'\s*(前|之前|以前|截止|截止前)$', '', title)
        title = title.strip(' ，,。')
        return {
            'event': title or text,
            'date': today.strftime('%Y-%m-%d'),
            'startDate': today.strftime('%Y-%m-%d'),
            'deadlineDate': deadline.strftime('%Y-%m-%d'),
        }
    return None


# ======== Function Call 工具定义 ========
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_events",
            "description": "查询日程列表，可按日期或关键词过滤。如果用户问某天有什么日程，请调用此函数。",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "查询特定日期，格式 YYYY-MM-DD；不填则返回所有普通日程"
                    },
                    "keyword": {
                        "type": "string",
                        "description": "按关键词模糊搜索日程名称"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_event",
            "description": "创建一条新日程。支持一次性日程、长期循环任务、deadline 截止任务。",
            "parameters": {
                "type": "object",
                "properties": {
                    "event": {"type": "string", "description": "日程名称"},
                    "date": {"type": "string", "description": "日期，格式 YYYY-MM-DD。对于循环任务或 deadline 任务，这是开始日期。"},
                    "time": {"type": "string", "description": "时间，格式 HH:mm（24小时制），没有则不填"},
                    "location": {"type": "string", "description": "地点，没有则不填"},
                    "urgency": {
                        "type": "string",
                        "enum": ["normal", "high"],
                        "description": "紧急程度，默认 normal"
                    },
                    "targetDurationMinutes": {
                        "type": "number",
                        "description": "每日目标计时分钟数，例如两个小时为 120。没有目标时不填。"
                    },
                    "isRecurring": {
                        "type": "boolean",
                        "description": "是否为长期循环任务，默认 false"
                    },
                    "isDeadline": {
                        "type": "boolean",
                        "description": "是否为 deadline 截止任务。用户说“X月X日前/截止X月X日/by/before”时设为 true。"
                    },
                    "recurringType": {
                        "type": "string",
                        "enum": ["daily", "weekly", "monthly"],
                        "description": "循环类型：daily=每天, weekly=每周指定几天, monthly=每月。仅 isRecurring=true 时有效。"
                    },
                    "recurringDays": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "每周的哪几天重复，0=周日,1=周一,...,6=周六。仅 recurringType=weekly 时需要。"
                    },
                    "endDate": {
                        "type": "string",
                        "description": "循环任务结束日期，格式 YYYY-MM-DD。仅 isRecurring=true 时需要。不填则默认持续到一年后。"
                    },
                    "deadlineDate": {
                        "type": "string",
                        "description": "deadline 截止日期，格式 YYYY-MM-DD。仅 isDeadline=true 时需要。"
                    }
                },
                "required": ["event", "date"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_event",
            "description": "修改已有日程的信息。修改前请先调用 list_events 确认日程 ID。",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "number", "description": "日程的 ID（数字）"},
                    "event": {"type": "string", "description": "新的日程名称"},
                    "date": {"type": "string", "description": "新的日期，格式 YYYY-MM-DD"},
                    "time": {"type": "string", "description": "新的时间，格式 HH:mm"},
                    "location": {"type": "string", "description": "新的地点"},
                    "urgency": {"type": "string", "enum": ["normal", "high"]},
                    "startDate": {"type": "string", "description": "循环任务新的开始日期，格式 YYYY-MM-DD"},
                    "endDate": {"type": "string", "description": "循环任务新的结束日期，格式 YYYY-MM-DD"},
                    "deadlineDate": {"type": "string", "description": "deadline 任务新的截止日期，格式 YYYY-MM-DD"},
                    "isDeadlineCompleted": {"type": "boolean", "description": "deadline 任务是否已整体完成"},
                    "targetDurationMinutes": {
                        "type": "number",
                        "description": "每日目标计时分钟数，例如两个小时为 120。没有目标时不填。"
                    }
                },
                "required": ["id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_event",
            "description": "删除指定日程。删除前请先调用 list_events 确认日程 ID。",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "number", "description": "要删除的日程 ID（数字）"}
                },
                "required": ["id"]
            }
        }
    }
]


# ======== Function Call 执行 ========
def execute_function(name: str, args: dict) -> dict:
    if name == 'list_events':
        events = load_events()
        result = []
        date_filter = args.get('date')
        keyword = args.get('keyword')
        for e in events:
            if e.get('isDeadline'):
                if date_filter:
                    if is_date_in_deadline_range(date_filter, e):
                        instance = dict(e)
                        instance['date'] = date_filter
                        instance['isDeadlineInstance'] = True
                        instance['deadlineParentId'] = e['id']
                        instance['daysRemaining'] = calculate_days_remaining(date_filter, e.get('deadlineDate') or e.get('endDate'))
                        if keyword and keyword.lower() not in instance.get('event', '').lower():
                            continue
                        result.append(instance)
                else:
                    if keyword and keyword.lower() not in e.get('event', '').lower():
                        continue
                    result.append(e)
                continue
            if e.get('isRecurring'):
                if date_filter:
                    if is_date_in_recurring_range(date_filter, e):
                        instance = dict(e)
                        instance['date'] = date_filter
                        instance['isCompleted'] = date_filter in (e.get('completedDates') or [])
                        if keyword and keyword.lower() not in instance.get('event', '').lower():
                            continue
                        result.append(instance)
                else:
                    if keyword and keyword.lower() not in e.get('event', '').lower():
                        continue
                    result.append(e)
                continue
            if date_filter and e.get('date') != date_filter:
                continue
            if keyword and keyword.lower() not in e.get('event', '').lower():
                continue
            result.append(e)
        return {'success': True, 'events': result, 'count': len(result)}

    elif name == 'create_event':
        events = load_events()
        target_duration = args.get('targetDurationMinutes')
        if not isinstance(target_duration, (int, float)) or target_duration <= 0:
            target_duration = parse_duration_minutes(args.get('event', ''))
        event_title = args['event']
        if target_duration:
            event_title = clean_duration_from_event_title(event_title, bool(args.get('isRecurring')))
        new_event = {
            'id': generate_id(),
            'event': event_title,
            'date': args['date'],
            'time': args.get('time', ''),
            'location': args.get('location', ''),
            'urgency': args.get('urgency', 'normal'),
            'targetDurationMinutes': target_duration,
            'timerRecords': {},
            'createdAt': datetime.now().isoformat(),
        }
        target_minutes = new_event.get('targetDurationMinutes')
        if not isinstance(target_minutes, (int, float)) or target_minutes <= 0:
            new_event.pop('targetDurationMinutes', None)
        if args.get('isDeadline'):
            deadline_date = args.get('deadlineDate') or args.get('endDate') or args['date']
            new_event.update({
                'isDeadline': True,
                'date': args['date'],
                'startDate': args.get('startDate') or args['date'],
                'deadlineDate': deadline_date,
                'isDeadlineCompleted': False,
            })
            new_event.pop('isRecurring', None)
            new_event.pop('recurringType', None)
            new_event.pop('recurringDays', None)
            new_event.pop('completedDates', None)
        elif args.get('isRecurring'):
            default_end = (datetime.now() + timedelta(days=365)).strftime('%Y-%m-%d')
            new_event.update({
                'isRecurring': True,
                'recurringType': args.get('recurringType', 'daily'),
                'recurringDays': args.get('recurringDays'),
                'startDate': args['date'],
                'endDate': args.get('endDate', default_end),
                'completedDates': [],
            })
        events.append(new_event)
        save_events(events)
        desc = f'{new_event["event"]}（{new_event["date"]}）'
        if new_event.get('isDeadline'):
            desc += f'，每天出现，截止 {new_event["deadlineDate"]}'
        elif new_event.get('isRecurring'):
            rtype = {'daily': '每天', 'weekly': '每周', 'monthly': '每月'}.get(new_event['recurringType'], '')
            desc += f'，{rtype}循环，截止 {new_event["endDate"]}'
        return {
            'success': True,
            'event': new_event,
            'message': f'已创建日程：{desc}'
        }

    elif name == 'update_event':
        events = load_events()
        event_id = args.get('id')
        for e in events:
            if str(e.get('id')) == str(event_id):
                for field in ('event', 'date', 'time', 'location', 'urgency', 'startDate', 'endDate', 'deadlineDate', 'isDeadlineCompleted', 'targetDurationMinutes'):
                    if field in args:
                        if field == 'targetDurationMinutes':
                            target_minutes = args[field]
                            if isinstance(target_minutes, (int, float)) and target_minutes > 0:
                                e[field] = target_minutes
                            else:
                                e.pop(field, None)
                            continue
                        e[field] = args[field]
                if e.get('isDeadline'):
                    e['startDate'] = e.get('startDate') or e.get('date')
                    e['deadlineDate'] = e.get('deadlineDate') or e.get('endDate') or e.get('date')
                    e['date'] = e['startDate']
                    if e.get('isDeadlineCompleted') and not e.get('completedAt'):
                        e['completedAt'] = datetime.now().isoformat()
                e['updatedAt'] = datetime.now().isoformat()
                save_events(events)
                return {'success': True, 'event': e, 'message': f'已更新日程：{e["event"]}'}
        return {'success': False, 'message': f'未找到 ID 为 {event_id} 的日程'}

    elif name == 'delete_event':
        events = load_events()
        event_id = args.get('id')
        original_len = len(events)
        events = [e for e in events if str(e.get('id')) != str(event_id)]
        if len(events) < original_len:
            save_events(events)
            return {'success': True, 'message': '日程已删除'}
        return {'success': False, 'message': f'未找到 ID 为 {event_id} 的日程'}

    return {'success': False, 'message': f'未知函数：{name}'}


# ======== 对话会话 ========
conversations: dict = {}


def add_days_to_date(date_str: str, days: int) -> str:
    base = datetime.strptime(date_str, '%Y-%m-%d').date()
    return (base + timedelta(days=days)).strftime('%Y-%m-%d')


def find_recent_recurring_event_from_messages(messages: list) -> dict | None:
    for msg in reversed(messages):
        if msg.get('role') != 'tool':
            continue
        try:
            content = json.loads(msg.get('content') or '{}')
        except Exception:
            continue
        event = content.get('event')
        if content.get('success') and isinstance(event, dict) and event.get('isRecurring'):
            return event
    return None


def find_latest_recurring_event() -> dict | None:
    events = [e for e in load_events() if e.get('isRecurring')]
    if not events:
        return None
    return max(events, key=lambda e: e.get('updatedAt') or e.get('createdAt') or '')


def try_handle_quick_duration_update(session_id: str, user_message: str, history: list) -> dict | None:
    if not re.search(r'(只|仅|就)?.*(持续|保留|改成|改为)?.*(一个月|1\s*个月|30\s*天)', user_message):
        return None

    target_event = find_recent_recurring_event_from_messages(history)
    if not target_event:
        return {
            'message': '你想把哪条循环日程改成只持续一个月？可以告诉我日程名称，比如“学习 Java/agent”。',
            'events_changed': False,
            'created_count': 0,
            'deleted_count': 0,
        }

    start_date = target_event.get('startDate') or target_event.get('date')
    if not start_date:
        return None

    end_date = add_days_to_date(start_date, 30)
    result = execute_function('update_event', {
        'id': target_event.get('id'),
        'endDate': end_date,
    })
    message = result.get('message') if result.get('success') else '修改失败，请重试'
    if result.get('success'):
        message = f'已把「{result["event"]["event"]}」调整为只持续一个月，截止 {end_date}。'

    assistant_record = {'role': 'assistant', 'content': message}
    conversations[session_id] = history + [assistant_record]
    return {
        'message': message,
        'events_changed': bool(result.get('success')),
        'created_count': 0,
        'deleted_count': 0,
    }


def try_handle_quick_deadline_create(session_id: str, user_message: str, history: list) -> dict | None:
    parsed = extract_deadline_from_text(user_message)
    if not parsed:
        return None

    result = execute_function('create_event', {
        'event': parsed['event'],
        'date': parsed['date'],
        'startDate': parsed['startDate'],
        'deadlineDate': parsed['deadlineDate'],
        'isDeadline': True,
        'urgency': 'normal',
    })
    if not result.get('success'):
        return None

    message = f'已创建 deadline 任务：「{result["event"]["event"]}」，每天提醒，截止 {result["event"]["deadlineDate"]}。'
    conversations[session_id] = history + [{'role': 'assistant', 'content': message}]
    return {
        'message': message,
        'events_changed': True,
        'created_count': 1,
        'deleted_count': 0,
    }


def get_system_prompt() -> str:
    today = datetime.now()
    today_str = today.strftime('%Y-%m-%d')
    weekday_names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    weekday = weekday_names[today.weekday()]
    return (
        f'你是 HoyoCalendar 的智能日程助手。今天是 {today_str}（{weekday}）。'
        '你可以帮用户增删改查日程。需要操作日程时，请使用提供的工具函数。'
        '如果用户询问某天的日程，先调用 list_events 查询后再回复。'
        '你还支持创建长期循环任务（如每天背单词、每周三五健身等）。'
        '你还支持创建 deadline 截止任务：当用户说“X月X日前完成某事”“截止X月X日”“by/before 某日期”时，设置 isDeadline=true，date/startDate 使用今天，deadlineDate 使用截止日期；不要同时设置 isRecurring。'
        'deadline 任务标题只保留核心事项，例如“8月10号前写完论文”的事件名为“写完论文”。'
        '当用户提到"每天""每周""每月"或表达长期习惯/计划时，请设置 isRecurring=true 并选择合适的 recurringType。'
        '如果用户说"两个小时""30分钟""1.5小时"等持续时长，请将其作为每日目标计时分钟数 targetDurationMinutes。'
        '创建任务标题时尽量保留核心事项，例如"每天学习两个小时 Java"的事件名为"学习 Java"。'
        '如果用户没有指定开始日期，date 和 startDate 使用今天。'
        '对于"每周X"的任务，使用 recurringType="weekly" 并在 recurringDays 中指定（0=周日,1=周一,...,6=周六）。'
        '如果用户没有指定结束日期，可以不填 endDate，系统会默认一年。'
        '操作完成后，用简洁友好的中文回复用户操作结果。'
    )


# ======== API 路由 ========

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


@app.route('/api/events', methods=['GET'])
def get_events():
    date_filter = request.args.get('date')
    events = load_events()
    if not date_filter:
        return jsonify(events)

    result = []
    for e in events:
        if e.get('isDeadline'):
            if is_date_in_deadline_range(date_filter, e):
                instance = dict(e)
                instance['date'] = date_filter
                instance['isDeadlineInstance'] = True
                instance['deadlineParentId'] = e['id']
                instance['daysRemaining'] = calculate_days_remaining(date_filter, e.get('deadlineDate') or e.get('endDate'))
                result.append(instance)
        elif e.get('isRecurring'):
            if is_date_in_recurring_range(date_filter, e):
                instance = dict(e)
                instance['date'] = date_filter
                instance['isRecurringInstance'] = True
                instance['recurringParentId'] = e['id']
                instance['isCompleted'] = date_filter in (e.get('completedDates') or [])
                instance['progress'] = calculate_recurring_progress(e, date_filter)
                result.append(instance)
        elif e.get('date') == date_filter:
            result.append(e)
    return jsonify(result)


@app.route('/api/events', methods=['POST'])
def create_event_route():
    data = request.get_json()
    if not data or not data.get('event') or not data.get('date'):
        return jsonify({'error': '缺少必要字段 event 或 date'}), 400

    events = load_events()
    target_duration = data.get('targetDurationMinutes')
    if not isinstance(target_duration, (int, float)) or target_duration <= 0:
        target_duration = parse_duration_minutes(data.get('event', ''))
    event_title = data['event']
    if target_duration:
        event_title = clean_duration_from_event_title(event_title, bool(data.get('isRecurring')))
    new_event: dict = {
        'id': generate_id(),
        'event': event_title,
        'date': data['date'],
        'time': data.get('time', ''),
        'location': data.get('location', ''),
        'urgency': data.get('urgency', 'normal'),
        'targetDurationMinutes': target_duration,
        'timerRecords': data.get('timerRecords') or {},
        'createdAt': datetime.now().isoformat(),
    }
    target_minutes = new_event.get('targetDurationMinutes')
    if not isinstance(target_minutes, (int, float)) or target_minutes <= 0:
        new_event.pop('targetDurationMinutes', None)
    if data.get('isDeadline'):
        new_event.update({
            'isDeadline': True,
            'date': data.get('startDate', data['date']),
            'startDate': data.get('startDate', data['date']),
            'deadlineDate': data.get('deadlineDate') or data.get('endDate') or data['date'],
            'isDeadlineCompleted': bool(data.get('isDeadlineCompleted', False)),
        })
        if not new_event['isDeadlineCompleted']:
            new_event.pop('completedAt', None)
    elif data.get('isRecurring'):
        new_event.update({
            'isRecurring': True,
            'recurringType': data.get('recurringType', 'daily'),
            'recurringDays': data.get('recurringDays'),
            'startDate': data.get('startDate', data['date']),
            'endDate': data.get('endDate', data['date']),
            'completedDates': [],
        })
    events.append(new_event)
    save_events(events)
    return jsonify(new_event), 201


@app.route('/api/events/<event_id>', methods=['PUT'])
def update_event_route(event_id: str):
    data = request.get_json()
    events = load_events()
    for e in events:
        if str(e.get('id')) == str(event_id):
            for field in ('event', 'date', 'time', 'location', 'urgency', 'startDate', 'endDate', 'deadlineDate', 'isDeadlineCompleted', 'targetDurationMinutes'):
                if field in data:
                    if field == 'targetDurationMinutes':
                        target_minutes = data[field]
                        if isinstance(target_minutes, (int, float)) and target_minutes > 0:
                            e[field] = target_minutes
                        else:
                            e.pop(field, None)
                        continue
                    e[field] = data[field]
            if e.get('isDeadline'):
                e['startDate'] = e.get('startDate') or e.get('date')
                e['deadlineDate'] = e.get('deadlineDate') or e.get('endDate') or e.get('date')
                e['date'] = e['startDate']
                if e.get('isDeadlineCompleted') and not e.get('completedAt'):
                    e['completedAt'] = datetime.now().isoformat()
            e['updatedAt'] = datetime.now().isoformat()
            save_events(events)
            return jsonify(e)
    return jsonify({'error': '未找到该日程'}), 404


@app.route('/api/events/<event_id>', methods=['DELETE'])
def delete_event_route(event_id: str):
    events = load_events()
    new_events = [e for e in events if str(e.get('id')) != str(event_id)]
    if len(new_events) < len(events):
        save_events(new_events)
        return jsonify({'success': True})
    return jsonify({'error': '未找到该日程'}), 404


@app.route('/api/events/<event_id>/toggle-complete', methods=['POST'])
def toggle_complete(event_id: str):
    data = request.get_json() or {}
    date_str = data.get('date', '')
    events = load_events()
    for e in events:
        if str(e.get('id')) == str(event_id):
            completed: list = e.get('completedDates', [])
            if date_str in completed:
                completed.remove(date_str)
            else:
                completed.append(date_str)
            e['completedDates'] = completed
            save_events(events)
            return jsonify({'success': True, 'completedDates': completed})
    return jsonify({'error': '未找到该日程'}), 404


@app.route('/api/parse', methods=['POST'])
def parse_event():
    """用 AI 将自然语言解析为日程结构（快速添加用）。"""
    data = request.get_json()
    text = (data or {}).get('text', '').strip()
    if not text:
        return jsonify({'error': '未提供文本'}), 400

    cfg = get_ai_config()
    today = datetime.now()
    today_str = today.strftime('%Y-%m-%d')
    weekday_names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    weekday = weekday_names[today.weekday()]

    # 预计算常用相对日期
    def add_days(base: datetime, n: int) -> str:
        return (base + timedelta(days=n)).strftime('%Y-%m-%d')

    date_table = f"""
   - "今天" → {today_str}
   - "明天" → {add_days(today, 1)}
   - "后天" → {add_days(today, 2)}
   - "大后天" → {add_days(today, 3)}
   - "一周后" → {add_days(today, 7)}
   - "一个月后" → {add_days(today, 30)}"""

    prompt = (
        f'你是智能日程助手。今天是 {today_str}（{weekday}）。\n'
        f'请将以下文字解析为结构化日程 JSON，字段：event、date（YYYY-MM-DD）、'
        f'time（HH:mm，可选）、location（可选）、urgency（normal/high）、'
        f'targetDurationMinutes（每日目标计时分钟数，可选）、isDeadline（可选）、deadlineDate（YYYY-MM-DD，可选）。\n'
        f'如果用户说“X月X日前/之前/以前完成某事”“截止X月X日”“by/before 某日期”，返回 isDeadline=true，date 使用今天，deadlineDate 使用截止日期，event 只保留核心事项。\n'
        f'如果出现"两个小时""30分钟""1.5小时"等持续时长，将其转为 targetDurationMinutes。\n'
        f'日期参考：{date_table}\n'
        f'如果识别到多个日程，返回 JSON 数组。只返回 JSON，不加其他文字。\n'
        f'用户输入：{text}'
    )

    try:
        client = make_client()
        response = client.chat.completions.create(
            model=cfg['model'],
            messages=[{'role': 'user', 'content': prompt}],
            temperature=0.3,
        )
        content = response.choices[0].message.content or ''
        match = re.search(r'\[[\s\S]*\]|\{[\s\S]*\}', content)
        if match:
            return jsonify(json.loads(match.group()))
        return jsonify(json.loads(content))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/parse-image', methods=['POST'])
def parse_image():
    """用多模态 AI 识别图片中的日程信息。"""
    data = request.get_json()
    image_data = (data or {}).get('image', '')
    if not image_data:
        return jsonify({'error': '未提供图片'}), 400

    cfg = get_ai_config()
    today_str = datetime.now().strftime('%Y-%m-%d')

    prompt = (
        f'请识别图片中的日程/任务/待办信息，解析为 JSON。今天是 {today_str}。\n'
        '字段：event（名称）、date（YYYY-MM-DD）、time（HH:mm，可选）、'
        'location（可选）、urgency（normal/high）、targetDurationMinutes（每日目标计时分钟数，可选）、'
        'isDeadline（可选）、deadlineDate（YYYY-MM-DD，可选）。\n'
        '如果图片/文字表达“X月X日前/截止X月X日/by/before”，返回 isDeadline=true，date 使用今天，deadlineDate 使用截止日期。\n'
        '如果出现"两个小时""30分钟""1.5小时"等持续时长，将其转为 targetDurationMinutes。\n'
        '多个日程返回数组，没有识别到返回 null。只返回 JSON。'
    )

    try:
        client = make_client()
        response = client.chat.completions.create(
            model=cfg['model'],
            messages=[{
                'role': 'user',
                'content': [
                    {'type': 'image_url', 'image_url': {'url': image_data}},
                    {'type': 'text', 'text': prompt},
                ]
            }],
            temperature=0.3,
        )
        content = response.choices[0].message.content or ''
        if content.strip() == 'null':
            return jsonify(None)
        match = re.search(r'\[[\s\S]*\]|\{[\s\S]*\}', content)
        if match:
            return jsonify(json.loads(match.group()))
        return jsonify(json.loads(content))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/chat', methods=['POST'])
def chat():
    """对话接口：用户发送消息，AI 通过 Function Call 操作日程。"""
    data = request.get_json()
    session_id = (data or {}).get('session_id', 'default')
    user_message = (data or {}).get('message', '').strip()

    if not user_message:
        return jsonify({'error': '消息不能为空'}), 400

    if session_id not in conversations:
        conversations[session_id] = [
            {'role': 'system', 'content': get_system_prompt()}
        ]

    history = conversations[session_id]
    history.append({'role': 'user', 'content': user_message})

    quick_deadline_result = try_handle_quick_deadline_create(session_id, user_message, history)
    if quick_deadline_result:
        return jsonify(quick_deadline_result)

    quick_result = try_handle_quick_duration_update(session_id, user_message, history)
    if quick_result:
        return jsonify(quick_result)

    cfg = get_ai_config()
    if not cfg['model']:
        return jsonify({
            'error': '未配置模型',
            'message': '请先在设置中配置 AI 模型名称',
            'events_changed': False
        }), 400
    client = make_client()
    messages = [dict(m) for m in history]
    events_changed = False
    created_count = 0
    deleted_count = 0

    try:
        for _ in range(6):  # 最多 6 轮工具调用
            response = client.chat.completions.create(
                model=cfg['model'],
                messages=messages,
                tools=TOOLS,
                tool_choice='auto',
            )
            choice = response.choices[0]
            assistant_msg = choice.message

            # 构建消息字典（保持与 API 格式兼容）
            msg_dict: dict = {
                'role': 'assistant',
                'content': assistant_msg.content or '',
            }
            if assistant_msg.tool_calls:
                msg_dict['tool_calls'] = [
                    {
                        'id': tc.id,
                        'type': 'function',
                        'function': {
                            'name': tc.function.name,
                            'arguments': tc.function.arguments,
                        }
                    }
                    for tc in assistant_msg.tool_calls
                ]
            messages.append(msg_dict)

            if choice.finish_reason == 'tool_calls' and assistant_msg.tool_calls:
                last_action_result = None
                for tool_call in assistant_msg.tool_calls:
                    func_name = tool_call.function.name
                    try:
                        func_args = json.loads(tool_call.function.arguments)
                    except Exception:
                        func_args = {}
                    result = execute_function(func_name, func_args)
                    if result.get('success') and func_name in ('create_event', 'update_event', 'delete_event'):
                        events_changed = True
                    if result.get('success') and func_name == 'create_event':
                        created_count += 1
                    if result.get('success') and func_name == 'delete_event':
                        deleted_count += 1
                    if result.get('success') and func_name in ('create_event', 'update_event', 'delete_event'):
                        last_action_result = result
                    messages.append({
                        'role': 'tool',
                        'tool_call_id': tool_call.id,
                        'content': json.dumps(result, ensure_ascii=False),
                    })
                if last_action_result:
                    final_content = last_action_result.get('message') or '操作完成'
                    messages.append({'role': 'assistant', 'content': final_content})
                    conversations[session_id] = messages
                    return jsonify({
                        'message': final_content,
                        'events_changed': events_changed,
                        'created_count': created_count,
                        'deleted_count': deleted_count,
                    })
            else:
                # 最终回复
                final_content = assistant_msg.content or '操作完成'
                conversations[session_id] = messages
                return jsonify({
                    'message': final_content,
                    'events_changed': events_changed,
                    'created_count': created_count,
                    'deleted_count': deleted_count,
                })

        return jsonify({'message': '处理超时，请重试', 'events_changed': False})

    except Exception as e:
        return jsonify({
            'error': str(e),
            'message': f'出错了：{e}',
            'events_changed': False
        }), 500


@app.route('/api/chat/reset', methods=['POST'])
def reset_chat():
    data = request.get_json() or {}
    session_id = data.get('session_id', 'default')
    conversations.pop(session_id, None)
    return jsonify({'success': True})


@app.route('/api/config', methods=['GET'])
def get_config():
    return jsonify(load_config())


@app.route('/api/config', methods=['PUT'])
def update_config():
    data = request.get_json()
    if not data:
        return jsonify({'error': '无数据'}), 400
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return jsonify({'success': True})


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    print(f'HoyoCalendar Backend starting on http://127.0.0.1:{port}', flush=True)
    app.run(host='127.0.0.1', port=port, debug=False, threaded=True)
