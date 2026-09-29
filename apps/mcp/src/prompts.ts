import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { GUIDE } from './guide.js';

/**
 * Prompts are the slash-command surface: in Claude Code they appear as
 * /mcp__wixzel-voice__<name>. Each one is a worked procedure, phrased as a
 * request the user would make.
 */
export function registerPrompts(server: McpServer): void {
    server.registerPrompt(
        'quickstart',
        {
            title: 'Set up Wixzel Voice from nothing',
            description:
                'Walk through connecting a carrier, registering a number, building an agent and placing a first call, checking in with the user at each step that costs money or needs their credentials.',
            argsSchema: {
                goal: z
                    .string()
                    .optional()
                    .describe('What the agent should do on calls, e.g. "confirm dental appointments". Optional.'),
            },
        },
        ({ goal }) => ({
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text:
                            `${GUIDE}\n\n---\n\n` +
                            `Set up my Wixzel Voice account so an agent can make calls${goal ? ` to ${goal}` : ''}. ` +
                            'Start by checking what already exists (list_sip_trunks, list_phone_numbers, list_agents, get_balance) so nothing is duplicated. ' +
                            'Then follow the setup order in the guide. Ask me for carrier credentials rather than inventing them, ' +
                            'and stop to confirm before anything that spends money or dials a phone. ' +
                            'At the end, tell me exactly what was created (with ids) and what I still have to do at my carrier.',
                    },
                },
            ],
        }),
    );

    server.registerPrompt(
        'diagnose_call',
        {
            title: 'Diagnose a failed or odd call',
            description: 'Pull the call record, its usage events, the trunk status and recent SIP logs, and explain what happened and what to change.',
            argsSchema: {
                call_id: z.string().describe('The call id from list_calls or place_call.'),
            },
        },
        ({ call_id }) => ({
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text:
                            `Diagnose Wixzel Voice call ${call_id}. ` +
                            'Fetch it with get_call and read status, failure_code, failure_reason, errors and transfers. ' +
                            'Pull list_usage_events with its session_id to see what was billed. ' +
                            'If it did not connect, find the phone number and trunk it used (list_phone_numbers, get_sip_trunk), run check_sip_trunk_status and get_sip_trunk_logs, ' +
                            'and read the transcript if there is one. ' +
                            'Report: what happened in one paragraph, the evidence (quote codes and log lines), and the concrete fix, ' +
                            'distinguishing carrier-side configuration (allowlisting platform_ip, origination URI, credentials) from agent configuration. ' +
                            'Do not place any new calls while diagnosing.',
                    },
                },
            ],
        }),
    );

    server.registerPrompt(
        'spend_report',
        {
            title: 'Explain recent spend',
            description: 'Summarise what the account spent over a period, by component and by call, in plain dollars.',
            argsSchema: {
                period: z
                    .string()
                    .optional()
                    .describe('Human phrase such as "this month", "last 7 days", or an ISO date range. Defaults to this month.'),
            },
        },
        ({ period }) => ({
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text:
                            `Explain my Wixzel Voice spend for ${period ?? 'this month'}. ` +
                            'Use get_usage_summary for the totals by component and model, get_balance for what is left, and list_calls (with started_after/started_before) to find the most expensive calls, ' +
                            'then list_usage_events by session_id for the top two or three. ' +
                            'Convert micro-USD to dollars (1,000,000 = $1.00). Present a short table by component, the top calls with duration and cost, and one or two suggestions for reducing cost, ' +
                            'such as a cheaper model from list_engines or a lower max_tokens.',
                    },
                },
            ],
        }),
    );
}
