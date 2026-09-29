import { isSelfHosted } from '../site.js';
import type { ToolDef } from '../tooling.js';
import { agentTools } from './agents.js';
import { apiKeyTools } from './api-keys.js';
import { appointmentTools } from './appointments.js';
import { billingTools } from './billing.js';
import { callTools } from './calls.js';
import { realtimeTools } from './realtime.js';
import { campaignTools } from './campaigns.js';
import { engineTools } from './engines.js';
import { knowledgeBaseTools } from './knowledge-bases.js';
import { leadTools } from './leads.js';
import { phoneNumberTools } from './phone-numbers.js';
import { sipTrunkTools } from './sip-trunks.js';
import { webhookTools } from './webhooks.js';

/** Every tool the server exposes, in the order a client lists them. */
export const allTools: ToolDef<any>[] = [
    ...engineTools,
    ...agentTools,
    ...callTools,
    ...realtimeTools,
    ...sipTrunkTools,
    ...phoneNumberTools,
    ...leadTools,
    ...campaignTools,
    ...knowledgeBaseTools,
    ...appointmentTools,
    ...webhookTools,
    ...billingTools,
    ...apiKeyTools,
];

/** Tools with nothing to do on a self-hosted install, where no one buys credit. */
const HOSTED_ONLY = new Set(['create_topup']);

/** The tools this server registers, for the edition it runs as. */
export function toolsFor(env: NodeJS.ProcessEnv = process.env): ToolDef<any>[] {
    return isSelfHosted(env) ? allTools.filter((tool) => !HOSTED_ONLY.has(tool.name)) : allTools;
}
