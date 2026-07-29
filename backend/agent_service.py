import json
import re
import threading
from copy import deepcopy
from datetime import date, datetime

from openai import OpenAI


def parse_date(value: str):
    try:
        return datetime.strptime(str(value), '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return None


def is_recurring_on(event: dict, target: date) -> bool:
    start = parse_date(event.get('startDate') or event.get('date'))
    end = parse_date(event.get('endDate'))
    if not start or not end or target < start or target > end:
        return False
    recurring_type = event.get('recurringType', 'daily')
    if recurring_type == 'weekly':
        js_weekday = (target.weekday() + 1) % 7
        return js_weekday in (event.get('recurringDays') or [])
    if recurring_type == 'monthly':
        return target.day == start.day
    return True


def event_occurs_on(event: dict, target_date: str) -> bool:
    target = parse_date(target_date)
    if not target:
        return False
    if event.get('isDeadline'):
        if event.get('isDeadlineCompleted'):
            return event.get('deadlineCompletedDate') == target_date
        start = parse_date(event.get('startDate') or event.get('date'))
        deadline = parse_date(event.get('deadlineDate') or event.get('endDate'))
        return bool(start and deadline and start <= target <= deadline)
    if event.get('isRecurring'):
        return is_recurring_on(event, target)
    return event.get('date') == target_date


def normalize_create_args(args: dict, today: str) -> dict:
    title = str(args.get('event') or args.get('title') or '新日程').strip()
    event_date = str(args.get('date') or today)
    event = {
        'event': title,
        'date': event_date,
        'time': str(args.get('time') or ''),
        'location': str(args.get('location') or ''),
        'urgency': 'high' if args.get('urgency') == 'high' else 'normal',
        'calendar': str(args.get('calendar') or '个人'),
        'note': str(args.get('note') or ''),
    }
    duration = args.get('targetDurationMinutes')
    if isinstance(duration, (int, float)) and duration > 0:
        event['targetDurationMinutes'] = round(duration)

    if args.get('isDeadline'):
        event.update({
            'isDeadline': True,
            'date': str(args.get('startDate') or today),
            'startDate': str(args.get('startDate') or today),
            'deadlineDate': str(args.get('deadlineDate') or event_date),
            'isDeadlineCompleted': False,
        })
    elif args.get('isRecurring'):
        event.update({
            'isRecurring': True,
            'date': str(args.get('startDate') or event_date),
            'startDate': str(args.get('startDate') or event_date),
            'endDate': str(args.get('endDate') or event_date),
            'recurringType': args.get('recurringType') or 'daily',
            'recurringDays': args.get('recurringDays') or [],
            'completedDates': [],
        })
    return event


TOOL_DEFINITIONS = {
    'list_events': {
        'type': 'function',
        'function': {
            'name': 'list_events',
            'description': '查询当前日程。修改或删除前必须先查询以取得准确 ID。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'date': {
                        'type': 'string',
                        'description': '特定日期，格式 YYYY-MM-DD。',
                    },
                    'start_date': {
                        'type': 'string',
                        'description': '范围起始日期，格式 YYYY-MM-DD。',
                    },
                    'end_date': {
                        'type': 'string',
                        'description': '范围结束日期，格式 YYYY-MM-DD。',
                    },
                    'keyword': {
                        'type': 'string',
                        'description': '标题关键词。',
                    },
                    'include_completed': {
                        'type': 'boolean',
                        'description': '是否包含已完成日程，默认 true。',
                    },
                },
            },
        },
    },
    'create_event': {
        'type': 'function',
        'function': {
            'name': 'create_event',
            'description': '规划创建一条日程。动作会由本地数据层统一执行。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'event': {'type': 'string', 'description': '简洁任务标题。'},
                    'date': {'type': 'string', 'description': '日期 YYYY-MM-DD。'},
                    'time': {'type': 'string', 'description': '时间 HH:mm，可省略。'},
                    'location': {'type': 'string'},
                    'note': {'type': 'string'},
                    'calendar': {'type': 'string'},
                    'urgency': {'type': 'string', 'enum': ['normal', 'high']},
                    'targetDurationMinutes': {'type': 'number'},
                    'isRecurring': {'type': 'boolean'},
                    'recurringType': {
                        'type': 'string',
                        'enum': ['daily', 'weekly', 'monthly'],
                    },
                    'recurringDays': {
                        'type': 'array',
                        'items': {'type': 'integer', 'minimum': 0, 'maximum': 6},
                    },
                    'startDate': {'type': 'string'},
                    'endDate': {'type': 'string'},
                    'isDeadline': {'type': 'boolean'},
                    'deadlineDate': {'type': 'string'},
                },
                'required': ['event', 'date'],
            },
        },
    },
    'update_event': {
        'type': 'function',
        'function': {
            'name': 'update_event',
            'description': '规划修改已有日程。必须使用 list_events 返回的真实 ID。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'id': {'description': '日程 ID，可为字符串或数字。'},
                    'event': {'type': 'string'},
                    'date': {'type': 'string'},
                    'time': {'type': 'string'},
                    'location': {'type': 'string'},
                    'note': {'type': 'string'},
                    'calendar': {'type': 'string'},
                    'urgency': {'type': 'string', 'enum': ['normal', 'high']},
                    'targetDurationMinutes': {'type': 'number'},
                    'startDate': {'type': 'string'},
                    'endDate': {'type': 'string'},
                    'deadlineDate': {'type': 'string'},
                    'isDeadline': {'type': 'boolean'},
                    'isRecurring': {'type': 'boolean'},
                    'recurringType': {
                        'type': 'string',
                        'enum': ['daily', 'weekly', 'monthly'],
                    },
                    'recurringDays': {
                        'type': 'array',
                        'items': {'type': 'integer', 'minimum': 0, 'maximum': 6},
                    },
                },
                'required': ['id'],
            },
        },
    },
    'delete_event': {
        'type': 'function',
        'function': {
            'name': 'delete_event',
            'description': '规划删除已有日程。必须使用 list_events 返回的真实 ID。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'id': {'description': '日程 ID，可为字符串或数字。'},
                },
                'required': ['id'],
            },
        },
    },
}


class PlanningContext:
    def __init__(self, events: list, today: str):
        self.events = deepcopy(events if isinstance(events, list) else [])
        self.today = today
        self.actions = []
        self.draft_index = 0

    def find(self, event_id):
        return next(
            (event for event in self.events if str(event.get('id')) == str(event_id)),
            None,
        )

    def execute(self, name: str, args: dict) -> dict:
        if name == 'list_events':
            return self.list_events(args)
        if name == 'create_event':
            return self.create_event(args)
        if name == 'update_event':
            return self.update_event(args)
        if name == 'delete_event':
            return self.delete_event(args)
        return {'success': False, 'message': f'不支持的工具：{name}'}

    def list_events(self, args: dict) -> dict:
        keyword = str(args.get('keyword') or '').lower().strip()
        date_filter = args.get('date')
        range_start = parse_date(args.get('start_date'))
        range_end = parse_date(args.get('end_date'))
        include_completed = args.get('include_completed', True)
        results = []

        for event in self.events:
            if keyword and keyword not in str(event.get('event') or '').lower():
                continue
            if not include_completed:
                if event.get('isCompleted') or event.get('isDeadlineCompleted'):
                    continue
            if date_filter and not event_occurs_on(event, date_filter):
                continue
            if range_start and range_end:
                appears = False
                cursor = range_start
                while cursor <= range_end:
                    if event_occurs_on(event, cursor.strftime('%Y-%m-%d')):
                        appears = True
                        break
                    cursor = date.fromordinal(cursor.toordinal() + 1)
                if not appears:
                    continue
            results.append(deepcopy(event))

        return {
            'success': True,
            'count': len(results),
            'events': results[:100],
            'truncated': len(results) > 100,
        }

    def create_event(self, args: dict) -> dict:
        self.draft_index += 1
        draft_id = f'draft-{self.draft_index}'
        event = normalize_create_args(args, self.today)
        event['id'] = draft_id
        self.events.append(event)
        self.actions.append({
            'type': 'create',
            'draft_id': draft_id,
            'event': {key: value for key, value in event.items() if key != 'id'},
        })
        return {'success': True, 'event': event, 'message': f'已规划创建：{event["event"]}'}

    def update_event(self, args: dict) -> dict:
        event_id = args.get('id')
        event = self.find(event_id)
        if not event:
            return {'success': False, 'message': f'未找到日程 ID {event_id}'}
        allowed = {
            'event', 'date', 'time', 'location', 'note', 'calendar', 'urgency',
            'targetDurationMinutes', 'startDate', 'endDate', 'deadlineDate',
            'isDeadline', 'isRecurring', 'recurringType', 'recurringDays',
        }
        updates = {key: value for key, value in args.items() if key in allowed}
        if not updates:
            return {'success': False, 'message': '没有可修改字段'}
        event.update(deepcopy(updates))

        if str(event_id).startswith('draft-'):
            action = next(
                (item for item in self.actions if item.get('draft_id') == event_id),
                None,
            )
            if action:
                action['event'].update(deepcopy(updates))
        else:
            self.actions.append({'type': 'update', 'id': event_id, 'updates': updates})
        return {'success': True, 'event': deepcopy(event), 'message': f'已规划更新：{event.get("event")}'}

    def delete_event(self, args: dict) -> dict:
        event_id = args.get('id')
        event = self.find(event_id)
        if not event:
            return {'success': False, 'message': f'未找到日程 ID {event_id}'}
        self.events = [
            item for item in self.events if str(item.get('id')) != str(event_id)
        ]
        if str(event_id).startswith('draft-'):
            self.actions = [
                item for item in self.actions if item.get('draft_id') != event_id
            ]
        else:
            self.actions.append({'type': 'delete', 'id': event_id})
        return {'success': True, 'event': event, 'message': f'已规划删除：{event.get("event")}'}


class AgentService:
    def __init__(self, config_store):
        self.config_store = config_store
        self.sessions = {}
        self.lock = threading.RLock()

    def reset(self, session_id: str):
        with self.lock:
            self.sessions.pop(session_id, None)

    def select_tools(self, message: str) -> list:
        if re.search(r'删除|取消|移除', message):
            names = ['list_events', 'delete_event']
        elif re.search(r'修改|改到|改成|移到|推迟|提前|重命名|调整', message):
            names = ['list_events', 'update_event']
        elif re.search(r'查询|查看|有什么|哪些|冲突|空闲', message):
            names = ['list_events']
        elif re.search(r'添加|新增|创建|安排|提醒|记下', message):
            names = ['create_event']
        else:
            names = ['list_events', 'create_event', 'update_event', 'delete_event']
        return [TOOL_DEFINITIONS[name] for name in names]

    def system_prompt(self, today: str) -> str:
        return (
            '你是 HoYoCalendar 的日程执行助手。'
            f'今天是 {today}。先理解用户目标，再使用工具规划必要动作。'
            '修改或删除前必须先 list_events，禁止猜测 ID。'
            '常见新增由客户端本地处理，你主要负责查询、批量修改和含糊指令。'
            'Deadline 任务设置 isDeadline=true、startDate/date=今天、deadlineDate=截止日期，'
            '不要同时设置 isRecurring。循环任务使用 isRecurring=true。'
            '不要声称已经写入数据；工具成功后用简洁中文说明具体规划结果。'
            '如果信息不足，先提出一个最关键的澄清问题，不调用写工具。'
        )

    def create_client(self):
        settings = self.config_store.ai_settings()
        return OpenAI(
            base_url=settings['base_url'],
            api_key=settings['api_key'],
            timeout=45.0,
            max_retries=1,
        ), settings

    def chat(self, message: str, session_id: str, events: list, today: str) -> dict:
        if not self.config_store.is_ai_configured():
            return {
                'message': 'AI 尚未配置。普通新增、Deadline 和重复任务仍可直接使用。',
                'actions': [],
                'configured': False,
            }

        client, settings = self.create_client()
        context = PlanningContext(events, today)
        with self.lock:
            history = deepcopy(self.sessions.get(session_id, []))[-8:]
        messages = [
            {'role': 'system', 'content': self.system_prompt(today)},
            *history,
            {'role': 'user', 'content': message},
        ]
        tools = self.select_tools(message)
        final_message = ''

        for _round in range(3):
            response = client.chat.completions.create(
                model=settings['model'],
                messages=messages,
                tools=tools,
                tool_choice='auto',
                temperature=0.1,
            )
            choice = response.choices[0]
            assistant = choice.message
            assistant_payload = {'role': 'assistant', 'content': assistant.content or ''}
            if assistant.tool_calls:
                assistant_payload['tool_calls'] = [
                    {
                        'id': call.id,
                        'type': 'function',
                        'function': {
                            'name': call.function.name,
                            'arguments': call.function.arguments,
                        },
                    }
                    for call in assistant.tool_calls
                ]
            messages.append(assistant_payload)

            if not assistant.tool_calls:
                final_message = assistant.content or '处理完成。'
                break

            for call in assistant.tool_calls:
                try:
                    args = json.loads(call.function.arguments or '{}')
                except ValueError:
                    args = {}
                result = context.execute(call.function.name, args)
                messages.append({
                    'role': 'tool',
                    'tool_call_id': call.id,
                    'content': json.dumps(result, ensure_ascii=False),
                })

        if not final_message:
            if context.actions:
                final_message = f'已规划 {len(context.actions)} 项日程变更。'
            else:
                final_message = '已完成查询，没有需要写入的变更。'

        with self.lock:
            session_history = self.sessions.setdefault(session_id, [])
            session_history.extend([
                {'role': 'user', 'content': message},
                {'role': 'assistant', 'content': final_message},
            ])
            self.sessions[session_id] = session_history[-12:]

        return {
            'message': final_message,
            'actions': context.actions,
            'configured': True,
            'route': [tool['function']['name'] for tool in tools],
        }
