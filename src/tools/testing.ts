/**
 * Tools: signalwire_run_call_test and signalwire_run_message_test.
 *
 * Start one bounded outbound development call (SWML say-and-hangup) and send
 * one text-only Compatibility SMS. Both return `accepted` with the real call
 * id / message SID and initial platform status — never claiming completion.
 */

import { executeTool, writeGateBlocked, confirmationRequiredEnvelope, accepted, op, type ToolContext } from "./runtime.js";
import { runCallTestResult, runMessageTestResult, type RunCallTestInput, type RunMessageTestInput } from "./contracts.js";
import { errorResult, type McpToolResult } from "../core/output.js";
import type { Params } from "../signalwire/client.js";

/** Start one bounded outbound development call. */
export async function signalwireRunCallTest(ctx: ToolContext, input: RunCallTestInput): Promise<McpToolResult> {
  return executeTool("signalwire_run_call_test", ctx, "mutation", async () => {
    const blocked = writeGateBlocked(ctx);
    if (blocked) return blocked;

    if (input.confirm_call !== true) {
      return confirmationRequiredEnvelope({
        operation: "place an outbound test call",
        target: `${input.from} → ${input.to}`,
        impact: "A real call is placed and may incur carrier charges. The call speaks the provided text and hangs up.",
        confirmationField: "confirm_call",
      });
    }

    const dial: Params = {
      from: input.from,
      to: input.to,
      swml: {
        version: "1.0.0",
        sections: {
          main: [{ answer: {} }, { play: { url: `say:${input.spoken_text}` } }, { hangup: {} }],
        },
      },
    };
    if (input.ring_timeout_seconds) dial.timeout = input.ring_timeout_seconds;
    if (input.status_callback_url) dial.status_url = input.status_callback_url;

    const raw = await ctx.client.calling.dial(dial);
    const parsed = runCallTestResult(raw);
    if (!parsed.call_id) {
      return errorResult(
        "Call request submitted but no call id was returned; the call may already have been placed.",
        { category: "platform", message: "SignalWire accepted the dial but returned no call id." },
        {
          operations: [op("place_test_call", "calling.dial", "unknown", "The dial request was submitted but no call id was returned; the call outcome is unknown.")],
          safe_to_retry: false,
          next_step: "Do not resend automatically. Inspect the call logs in the SignalWire Dashboard for a call from this number before retrying.",
        },
      );
    }
    return accepted(`Test call ${parsed.call_id} submitted; initial status: ${parsed.platform_status ?? "unknown"}.`, {
      call_id: parsed.call_id,
      platform_status: parsed.platform_status,
    });
  });
}

/** Send one text-only development SMS via the Compatibility API. */
export async function signalwireRunMessageTest(ctx: ToolContext, input: RunMessageTestInput): Promise<McpToolResult> {
  return executeTool("signalwire_run_message_test", ctx, "mutation", async () => {
    const blocked = writeGateBlocked(ctx);
    if (blocked) return blocked;

    if (input.confirm_message !== true) {
      return confirmationRequiredEnvelope({
        operation: "send a Compatibility API SMS",
        target: `${input.from} → ${input.to}`,
        impact: "A real SMS is sent and may incur carrier charges.",
        confirmationField: "confirm_message",
      });
    }

    const body: Params = { From: input.from, To: input.to, Body: input.body };
    if (input.status_callback_url) body.StatusCallback = input.status_callback_url;
    const raw = await ctx.client.compat.messages.create(body);
    const parsed = runMessageTestResult(raw);
    if (!parsed.message_sid) {
      return errorResult(
        "SMS submitted but no message SID was returned; the message may already have been sent.",
        { category: "platform", message: "SignalWire accepted the SMS but returned no message SID." },
        {
          operations: [op("send_test_message", "compat.messages.create", "unknown", "The message request was submitted but no message SID was returned; the message outcome is unknown.")],
          safe_to_retry: false,
          next_step: "Do not resend automatically. Inspect the message logs in the SignalWire Dashboard for a message from this number to the destination before retrying.",
        },
      );
    }
    return accepted(
      `Compatibility SMS ${parsed.message_sid} submitted; initial status: ${parsed.platform_status ?? "unknown"}. This result is from the Compatibility (LAML) messaging API.`,
      { message_sid: parsed.message_sid, platform_status: parsed.platform_status },
    );
  });
}
