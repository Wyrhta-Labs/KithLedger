import type { McpTool } from '@wyrhta/core/mcp';
import { peopleTools } from './tools/people.js';
import { interactionTools } from './tools/interactions.js';
import { reminderTools } from './tools/reminders.js';
import { relationshipTools } from './tools/relationships.js';

export const kithTools: McpTool[] = [
  ...peopleTools,
  ...interactionTools,
  ...reminderTools,
  ...relationshipTools,
];
