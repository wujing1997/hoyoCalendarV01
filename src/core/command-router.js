'use strict';

const { parseQuickCommand } = require('./quick-parser');

class CommandRouter {
  constructor(eventStore, options = {}) {
    this.eventStore = eventStore;
    this.onLocalChange = options.onLocalChange || null;
  }

  preview(text, contextDate) {
    return parseQuickCommand(text, { contextDate });
  }

  execute(text, contextDate) {
    const parsed = this.preview(text, contextDate);
    if (parsed.intent === 'empty') {
      return { handled: false, route: 'empty', parsed };
    }
    if (parsed.requiresAgent || parsed.intent === 'agent') {
      return { handled: false, route: 'agent', parsed };
    }
    if (parsed.intent === 'query') {
      const events = this.eventStore.getEventsByDate(parsed.date);
      const openEvents = events.filter((event) => !event.isCompleted);
      const message = openEvents.length
        ? `${parsed.date} 有 ${openEvents.length} 项待完成日程。`
        : `${parsed.date} 没有待完成日程。`;
      return {
        handled: true,
        route: 'local-query',
        parsed,
        events: openEvents,
        message,
      };
    }
    if (parsed.intent === 'create') {
      const event = this.eventStore.addEvent(parsed.event);
      if (!event) {
        return {
          handled: true,
          route: 'local-create',
          success: false,
          parsed,
          message: '保存日程失败，请稍后重试。',
        };
      }
      if (this.onLocalChange) this.onLocalChange(event.id, 'upsert');
      return {
        handled: true,
        route: 'local-create',
        success: true,
        parsed,
        event,
        message: `已添加“${event.event}”`,
        undo: { type: 'delete', id: event.id },
      };
    }
    return { handled: false, route: 'agent', parsed };
  }
}

module.exports = { CommandRouter };
