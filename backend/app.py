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
from datetime import datetime, date, timedelta
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
            "description": "创建一条新日程。支持一次性日程和长期循环任务（如每天背单词、每周健身等）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "event": {"type": "string", "description": "日程名称"},
                    "date": {"type": "string", "description": "日期，格式 YYYY-MM-DD。对于循环任务，这是开始日期。"},
                    "time": {"type": "string", "description": "时间，格式 HH:mm（24小时制），没有则不填"},
                    "location": {"type": "string", "description": "地点，没有则不填"},
                    "urgency": {
                        "type": "string",
                        "enum": ["normal", "high"],
                        "description": "紧急程度，默认 normal"
                    },
                    "isRecurring": {
                        "type": "boolean",
                        "description": "是否为长期循环任务，默认 false"
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
                    "urgency": {"type": "string", "enum": ["normal", "high"]}
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
        new_event = {
            'id': generate_id(),
            'event': args['event'],
            'date': args['date'],
            'time': args.get('time', ''),
            'location': args.get('location', ''),
            'urgency': args.get('urgency', 'normal'),
            'createdAt': datetime.now().isoformat(),
        }
        if args.get('isRecurring'):
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
        if new_event.get('isRecurring'):
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
                for field in ('event', 'date', 'time', 'location', 'urgency'):
                    if field in args:
                        e[field] = args[field]
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
        '当用户提到"每天""每周""每月"或表达长期习惯/计划时，请设置 isRecurring=true 并选择合适的 recurringType。'
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
        if e.get('isRecurring'):
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
    new_event: dict = {
        'id': generate_id(),
        'event': data['event'],
        'date': data['date'],
        'time': data.get('time', ''),
        'location': data.get('location', ''),
        'urgency': data.get('urgency', 'normal'),
        'createdAt': datetime.now().isoformat(),
    }
    if data.get('isRecurring'):
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
            for field in ('event', 'date', 'time', 'location', 'urgency', 'startDate', 'endDate'):
                if field in data:
                    e[field] = data[field]
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
        f'time（HH:mm，可选）、location（可选）、urgency（normal/high）。\n'
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
        'location（可选）、urgency（normal/high）。\n'
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

    cfg = get_ai_config()
    if not cfg['model']:
        return jsonify({
            'error': '未配置模型',
            'message': '请先在设置中配置 AI 模型名称',
            'events_changed': False
        }), 400
    client = make_client()
    messages = [dict(m) for m in history]

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
                for tool_call in assistant_msg.tool_calls:
                    func_name = tool_call.function.name
                    try:
                        func_args = json.loads(tool_call.function.arguments)
                    except Exception:
                        func_args = {}
                    result = execute_function(func_name, func_args)
                    messages.append({
                        'role': 'tool',
                        'tool_call_id': tool_call.id,
                        'content': json.dumps(result, ensure_ascii=False),
                    })
            else:
                # 最终回复
                final_content = assistant_msg.content or '操作完成'
                conversations[session_id] = messages
                return jsonify({'message': final_content, 'events_changed': True})

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
