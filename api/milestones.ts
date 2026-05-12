import { assertMethod, readJsonBody, readQueryString, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import {
  createMilestoneChain,
  linkPaymentToStep,
  listMilestoneChains,
  readMilestoneChain,
  unlockNextStep,
  type CreateMilestoneInput
} from "../server/milestones.js";

/**
 * Milestone Invoice Chain API
 *
 * GET  /api/milestones                    — list chains (optional ?recipient=0x...)
 * GET  /api/milestones?id=<chainId>       — get a specific chain with steps
 * POST /api/milestones                    — create a new milestone chain
 * POST /api/milestones?action=unlock      — present a PSP to unlock the next step
 * POST /api/milestones?action=link        — link a payment request to a step
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method === "GET") {
      const id = readQueryString(request, "id");
      if (id) {
        const chain = await readMilestoneChain(id);
        sendJson(response, 200, chain);
      } else {
        const recipient = readQueryString(request, "recipient");
        const chains = await listMilestoneChains(recipient || undefined);
        sendJson(response, 200, { chains });
      }
      return;
    }

    assertMethod(request, "POST");
    const action = readQueryString(request, "action");
    const body = readJsonBody(request);

    if (action === "unlock") {
      // Unlock next step by presenting a PSP
      const chainId = body.chain_id as string;
      const pspUid = body.psp_uid as string;
      if (!chainId || !pspUid) {
        sendJson(response, 400, { error: "chain_id and psp_uid are required." });
        return;
      }
      const chain = await unlockNextStep(chainId, pspUid);
      sendJson(response, 200, chain);
      return;
    }

    if (action === "link") {
      // Link a payment request to a milestone step
      const chainId = body.chain_id as string;
      const stepNumber = body.step_number as number;
      const requestId = body.request_id as string;
      if (!chainId || !stepNumber || !requestId) {
        sendJson(response, 400, { error: "chain_id, step_number, and request_id are required." });
        return;
      }
      const step = await linkPaymentToStep(chainId, stepNumber, requestId);
      sendJson(response, 200, step);
      return;
    }

    // Default POST: create a new chain
    const input: CreateMilestoneInput = {
      title: body.title as string,
      description: body.description as string | undefined,
      recipient: body.recipient as string,
      counterparty: body.counterparty as string | undefined,
      token: (body.token as "USDC" | "EURC") || "USDC",
      steps: (body.steps as { label: string; description?: string; amount: string }[]) || []
    };

    const chain = await createMilestoneChain(input);
    sendJson(response, 201, chain);
  } catch (error) {
    sendError(response, error);
  }
}
