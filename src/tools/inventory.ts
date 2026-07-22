/**
 * Tool: signalwire_find_resources — read-only discovery.
 *
 * Maps the requested resource type to the relevant public list/get/search SDK
 * method, projects results into bounded discovery items, and never mutates.
 */

import { executeTool, complete, notFound, type ToolContext } from "./runtime.js";
import { asArray, findResourcesResult, toItem, type FindResourcesInput } from "./contracts.js";
import type { McpToolResult } from "../core/output.js";
import type { Params } from "../signalwire/client.js";
import { isNotFoundError } from "../core/errors.js";

/** Fetch a single resource by exact id. */
async function fetchOne(ctx: ToolContext, type: FindResourcesInput["resource_type"], id: string, parentId?: string): Promise<unknown> {
  const c = ctx.client;
  switch (type) {
    case "phone_number":
      return c.phoneNumbers.get(id);
    case "ai_agent":
      return c.fabric.aiAgents.get(id);
    case "call_flow":
      return c.fabric.callFlows.get(id);
    case "swml_script":
      return c.fabric.swmlScripts.get(id);
    case "relay_application":
      return c.fabric.relayApplications.get(id);
    case "datasphere_document":
      return c.datasphere.documents.get(id);
    case "swml_webhook":
    case "cxml_webhook":
      return c.fabric.resources.get(id);
    case "call_flow_version": {
      if (!parentId) throw new Error("call_flow_version requires parent_id to locate a version");
      const versions = asArray(await c.fabric.callFlows.listVersions(parentId));
      return versions.find((v) => typeof v === "object" && v !== null && (v as Record<string, unknown>)["id"] === id) ?? null;
    }
    case "available_phone_number":
      throw new Error("available_phone_number cannot be fetched by resource_id; search instead");
  }
}

/** List or search resources. */
async function listMany(ctx: ToolContext, input: FindResourcesInput): Promise<unknown> {
  const c = ctx.client;
  const nameParams: Params | undefined = input.name ? { name: input.name } : undefined;
  switch (input.resource_type) {
    case "available_phone_number": {
      const params: Params = {};
      if (input.area_code) params.areacode = input.area_code;
      if (input.contains) params.contains = input.contains;
      return c.phoneNumbers.search(params);
    }
    case "phone_number":
      return c.phoneNumbers.list(nameParams);
    case "ai_agent":
      return c.fabric.aiAgents.list(nameParams);
    case "call_flow":
      return c.fabric.callFlows.list(nameParams);
    case "call_flow_version": {
      if (!input.parent_id) throw new Error("call_flow_version requires parent_id");
      return c.fabric.callFlows.listVersions(input.parent_id);
    }
    case "swml_script":
      return c.fabric.swmlScripts.list(nameParams);
    case "relay_application":
      return c.fabric.relayApplications.list(nameParams);
    case "swml_webhook":
    case "cxml_webhook":
      return c.fabric.resources.list(nameParams);
    case "datasphere_document":
      return c.datasphere.documents.list(nameParams);
  }
}

/** Discovery handler. */
export async function signalwireFindResources(ctx: ToolContext, input: FindResourcesInput): Promise<McpToolResult> {
  return executeTool("signalwire_find_resources", ctx, "read", async () => {
    const limitCount = input.limit ?? 10;

    if (input.resource_id) {
      let raw: unknown;
      try {
        raw = await fetchOne(ctx, input.resource_type, input.resource_id, input.parent_id);
      } catch (err) {
        if (isNotFoundError(err)) {
          return notFound(
            `No ${input.resource_type} found for identifier ${input.resource_id}.`,
            `Verify the identifier exists in this Project and retry.`,
          );
        }
        throw err;
      }
      const item = toItem(raw, input.resource_type);
      if (!item) {
        return notFound(
          `No ${input.resource_type} found for identifier ${input.resource_id}.`,
          `Verify the identifier exists in this Project and retry.`,
        );
      }
      return complete(`Found 1 ${input.resource_type}.`, { items: [item] });
    }

    const raw = await listMany(ctx, input);
    const { items } = findResourcesResult(raw, input.resource_type, limitCount);
    const filtered = input.name ? items.filter((i) => i.name && i.name.toLowerCase().includes(input.name!.toLowerCase())) : items;
    if (filtered.length === 0) {
      return notFound(
        `No ${input.resource_type} matched the request.`,
        `Adjust the name or search filters and retry.`,
      );
    }
    return complete(`Found ${filtered.length} ${input.resource_type}.`, { items: filtered });
  });
}
