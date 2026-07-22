/**
 * Tools: signalwire_add_knowledge and signalwire_search_knowledge.
 *
 * add_knowledge creates one URL-backed Datasphere document and reads it back
 * once, reporting the asynchronous ingestion status truthfully without
 * polling. search_knowledge performs one read-only semantic search.
 */

import { executeTool, writeGateBlocked, confirmationRequiredEnvelope, complete, partial, op, type ToolContext } from "./runtime.js";
import { addKnowledgeResult, searchKnowledgeResult, pickId, type AddKnowledgeInput, type SearchKnowledgeInput } from "./contracts.js";
import { errorResult, type McpToolResult } from "../core/output.js";
import type { Params } from "../signalwire/client.js";

/** Add one URL-backed Datasphere document. */
export async function signalwireAddKnowledge(ctx: ToolContext, input: AddKnowledgeInput): Promise<McpToolResult> {
  return executeTool("signalwire_add_knowledge", ctx, "mutation", async () => {
    const blocked = writeGateBlocked(ctx);
    if (blocked) return blocked;

    if (input.confirm_ingestion !== true) {
      return confirmationRequiredEnvelope({
        operation: "ingest a Datasphere document from the given URL",
        target: input.url,
        impact: "SignalWire will fetch and index the URL; ingestion is asynchronous and may consume Datasphere quota.",
        confirmationField: "confirm_ingestion",
      });
    }

    const createParams: Params = { url: input.url };
    if (input.tags) createParams.tags = input.tags;
    const created = await ctx.client.datasphere.documents.create(createParams);
    const id = pickId(created, "id", "document_id", "uuid");
    if (!id) {
      return errorResult(
        "Document ingestion submitted but no document id was returned; the document may already have been created.",
        { category: "platform", message: "SignalWire accepted the document creation but returned no document id." },
        {
          operations: [op("add_knowledge_document", "datasphere.documents.create", "unknown", "The document creation request was submitted but no document id was returned; the outcome is unknown.")],
          safe_to_retry: false,
          next_step: "Do not resend automatically; ingestion may already be running and a repeat call can create a duplicate. Inspect Datasphere documents in the SignalWire Dashboard before retrying.",
        },
      );
    }
    let readback: unknown;
    try {
      readback = await ctx.client.datasphere.documents.get(id);
    } catch {
      return partial(
        `Document ${id} was submitted for asynchronous ingestion, but the readback failed.`,
        [op("add_knowledge_document", "datasphere.documents.create", "complete", `Submitted document ${id} for asynchronous ingestion.`, id)],
        {
          resource_id: id,
          safe_to_retry: false,
          next_step: "Do not resend automatically; a repeat call can create a duplicate document. Re-run discovery or inspect Datasphere documents in the SignalWire Dashboard to confirm ingestion status.",
        },
      );
    }
    const parsed = addKnowledgeResult(readback);
    return complete("Datasphere document submitted for asynchronous ingestion.", parsed);
  });
}

/** Read-only semantic search. */
export async function signalwireSearchKnowledge(ctx: ToolContext, input: SearchKnowledgeInput): Promise<McpToolResult> {
  return executeTool("signalwire_search_knowledge", ctx, "read", async () => {
    const count = input.count ?? 5;
    const body: Params = { query_string: input.query, count };
    if (input.document_id) body.document_id = input.document_id;
    if (input.tags) body.tags = input.tags;
    const raw = await ctx.client.datasphere.documents.search(body);
    const { items } = searchKnowledgeResult(raw, count);
    if (items.length === 0) {
      return complete("No matching chunks were found.", { items });
    }
    return complete(`Found ${items.length} matching chunk(s).`, { items });
  });
}
