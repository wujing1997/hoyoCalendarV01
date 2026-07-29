import os
import sys
import tempfile
import unittest


BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from agent_service import AgentService, PlanningContext, event_occurs_on
from config_store import ConfigStore


class PlanningContextTests(unittest.TestCase):
    def test_deadline_occurrence(self):
        event = {
            'id': 1,
            'event': '写完论文',
            'date': '2026-07-30',
            'startDate': '2026-07-30',
            'deadlineDate': '2026-08-10',
            'isDeadline': True,
            'isDeadlineCompleted': False,
        }
        self.assertTrue(event_occurs_on(event, '2026-08-01'))
        self.assertFalse(event_occurs_on(event, '2026-08-11'))

    def test_update_and_delete_actions_do_not_write_files(self):
        context = PlanningContext([
            {'id': 7, 'event': '项目周会', 'date': '2026-07-31', 'time': '09:00'},
        ], '2026-07-30')
        found = context.execute('list_events', {'date': '2026-07-31'})
        self.assertEqual(found['count'], 1)
        updated = context.execute('update_event', {'id': 7, 'time': '10:00'})
        self.assertTrue(updated['success'])
        deleted = context.execute('delete_event', {'id': 7})
        self.assertTrue(deleted['success'])
        self.assertEqual(context.actions, [
            {'type': 'update', 'id': 7, 'updates': {'time': '10:00'}},
            {'type': 'delete', 'id': 7},
        ])

    def test_draft_update_merges_into_create_action(self):
        context = PlanningContext([], '2026-07-30')
        created = context.execute('create_event', {
            'event': '新任务',
            'date': '2026-07-31',
        })
        draft_id = created['event']['id']
        context.execute('update_event', {'id': draft_id, 'time': '14:00'})
        self.assertEqual(len(context.actions), 1)
        self.assertEqual(context.actions[0]['event']['time'], '14:00')


class AgentRoutingTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = ConfigStore(self.temp_dir.name)
        self.agent = AgentService(self.store)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_routes_queries_to_read_only_tool(self):
        tools = self.agent.select_tools('明天有什么安排')
        self.assertEqual(
            [tool['function']['name'] for tool in tools],
            ['list_events'],
        )

    def test_routes_mutation_to_list_then_update(self):
        tools = self.agent.select_tools('把明天会议改到下午三点')
        self.assertEqual(
            [tool['function']['name'] for tool in tools],
            ['list_events', 'update_event'],
        )

    def test_routes_schedule_command_to_create(self):
        tools = self.agent.select_tools('安排下周五的项目会议')
        self.assertEqual(
            [tool['function']['name'] for tool in tools],
            ['create_event'],
        )

    def test_unconfigured_agent_returns_without_network(self):
        result = self.agent.chat('查看明天日程', 'test', [], '2026-07-30')
        self.assertFalse(result['configured'])
        self.assertEqual(result['actions'], [])


if __name__ == '__main__':
    unittest.main()
