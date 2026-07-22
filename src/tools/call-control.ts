/**
 * Tools: signalwire_control_call, signalwire_exercise_call_feature, and
 * signalwire_control_ai_call — live call control.
 *
 * Lifecycle actions map to high-level commands; media-feature starts generate
 * a per-invocation control id with crypto.randomUUID() so a later stateless
 * stop can reference it. AI-call actions target an AI session already running
 * on the call.
 */

import { randomUUID } from "node:crypto";
import { executeTool, writeGateBlocked, confirmationRequiredEnvelope, complete, type ToolContext } from "./runtime.js";
import {
  controlCallResult,
  exerciseCallFeatureResult,
  controlAiCallResult,
  type ControlCallInput,
  type ExerciseCallFeatureInput,
  type ControlAiCallInput,
} from "./contracts.js";
import type { McpToolResult } from "../core/output.js";
import type { Params } from "../signalwire/client.js";

/** High-level lifecycle action on a live call. */
export async function signalwireControlCall(ctx: ToolContext, input: ControlCallInput): Promise<McpToolResult> {
  return executeTool("signalwire_control_call", ctx, "mutation", async () => {
    const blocked = writeGateBlocked(ctx);
    if (blocked) return blocked;

    if (input.action === "end") {
      if (input.confirm_end !== true) {
        return confirmationRequiredEnvelope({
          operation: "end the live call",
          target: input.call_id,
          impact: "The call is terminated immediately and cannot be resumed.",
          confirmationField: "confirm_end",
        });
      }
      const raw = await ctx.client.calling.end(input.call_id, {});
      const parsed = controlCallResult(raw);
      return complete(`End requested for call ${input.call_id}.`, { call_id: input.call_id, platform_status: parsed.platform_status });
    }

    // transfer
    if (input.confirm_transfer !== true) {
      return confirmationRequiredEnvelope({
        operation: "transfer the live call",
        target: `${input.call_id} → ${input.to}`,
        impact: "The call is redirected to the destination and may incur carrier charges.",
        confirmationField: "confirm_transfer",
      });
    }
    const raw = await ctx.client.calling.transfer(input.call_id, { dest: input.to });
    const parsed = controlCallResult(raw);
    return complete(`Transfer requested for call ${input.call_id} to ${input.to}.`, { call_id: input.call_id, platform_status: parsed.platform_status });
  });
}

/** Exercise one non-AI media feature on a live call. */
export async function signalwireExerciseCallFeature(ctx: ToolContext, input: ExerciseCallFeatureInput): Promise<McpToolResult> {
  return executeTool("signalwire_exercise_call_feature", ctx, "mutation", async () => {
    const blocked = writeGateBlocked(ctx);
    if (blocked) return blocked;
    const c = ctx.client.calling;
    const callId = input.call_id;

    switch (input.action) {
      case "play_audio": {
        const control_id = randomUUID();
        await c.play(callId, { control_id, play: [{ type: "audio", params: { url: input.audio_url } }] });
        return complete("Playback started.", { call_id: callId, control_id });
      }
      case "stop_playback": {
        await c.playStop(callId, { control_id: input.control_id });
        return complete("Playback stopped.", { call_id: callId, control_id: input.control_id });
      }
      case "collect_digits": {
        const control_id = randomUUID();
        const digits: Params = { max: input.max_digits };
        if (input.timeout_seconds) digits.digit_timeout = input.timeout_seconds;
        await c.collect(callId, { control_id, digits });
        return complete("Digit collection started.", { call_id: callId, control_id });
      }
      case "stop_collect": {
        await c.collectStop(callId, { control_id: input.control_id });
        return complete("Digit collection stopped.", { call_id: callId, control_id: input.control_id });
      }
      case "start_recording": {
        if (input.confirm_recording !== true) {
          return confirmationRequiredEnvelope({
            operation: "start recording the call",
            target: callId,
            impact: "Call audio is recorded and stored; recordings may contain sensitive data.",
            confirmationField: "confirm_recording",
          });
        }
        const control_id = randomUUID();
        await c.record(callId, { control_id, record: { audio: {} } });
        return complete("Recording started.", { call_id: callId, control_id });
      }
      case "stop_recording": {
        await c.recordStop(callId, { control_id: input.control_id });
        return complete("Recording stopped and finalized.", { call_id: callId, control_id: input.control_id });
      }
      case "start_detection": {
        const control_id = randomUUID();
        await c.detect(callId, { control_id, detect: { type: input.detector } });
        return complete(`${input.detector} detection started.`, { call_id: callId, control_id });
      }
      case "stop_detection": {
        await c.detectStop(callId, { control_id: input.control_id });
        return complete("Detection stopped.", { call_id: callId, control_id: input.control_id });
      }
      case "start_transcription": {
        if (input.confirm_transcription !== true) {
          return confirmationRequiredEnvelope({
            operation: "start transcribing the call",
            target: callId,
            impact: "Live speech is transcribed and sent to the callback URL; transcripts may contain sensitive data.",
            confirmationField: "confirm_transcription",
          });
        }
        const control_id = randomUUID();
        await c.transcribe(callId, { control_id, transcribe: {}, status_url: input.status_callback_url });
        return complete("Transcription started.", { call_id: callId, control_id });
      }
      case "stop_transcription": {
        await c.transcribeStop(callId, { control_id: input.control_id });
        return complete("Transcription stopped.", { call_id: callId, control_id: input.control_id });
      }
    }
  });
}

/** Interact with an AI session already running on a live call. */
export async function signalwireControlAiCall(ctx: ToolContext, input: ControlAiCallInput): Promise<McpToolResult> {
  return executeTool("signalwire_control_ai_call", ctx, "mutation", async () => {
    const blocked = writeGateBlocked(ctx);
    if (blocked) return blocked;
    const c = ctx.client.calling;
    const callId = input.call_id;

    if (input.confirm_ai_action !== true) {
      const op = input.action === "message" ? "send a message to the AI session" : input.action === "hold" ? "pause AI turn-taking" : input.action === "unhold" ? "resume the AI session" : "terminate the AI session";
      return confirmationRequiredEnvelope({
        operation: op,
        target: callId,
        impact: "The running AI session's behavior changes immediately.",
        confirmationField: "confirm_ai_action",
      });
    }

    let raw: unknown;
    switch (input.action) {
      case "message":
        raw = await c.aiMessage(callId, { role: input.role, message_text: input.text });
        break;
      case "hold": {
        const params: Params = {};
        if (input.prompt) params.prompt = input.prompt;
        if (input.timeout_seconds) params.timeout = String(input.timeout_seconds);
        raw = await c.aiHold(callId, params);
        break;
      }
      case "unhold":
        raw = await c.aiUnhold(callId, {});
        break;
      case "stop":
        raw = await c.aiStop(callId, {});
        break;
    }
    const parsed = controlAiCallResult(raw);
    return complete(`AI '${input.action}' requested for call ${callId}.`, { call_id: callId, platform_status: parsed.platform_status });
  });
}
