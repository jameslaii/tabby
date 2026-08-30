import Anthropic from "@anthropic-ai/sdk";

/**
 * The one place an Anthropic client is constructed.
 *
 * A personal or service-account key that isn't scoped to a single workspace
 * ("identity-linked") is rejected by the API unless every request names the
 * workspace it acts in via the `anthropic-workspace-id` header. A
 * workspace-scoped key needs no header. Setting ANTHROPIC_WORKSPACE_ID makes
 * either kind of key work; leaving it unset is correct for a scoped key.
 */
export function anthropicClient(): Anthropic {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  return new Anthropic(
    workspaceId
      ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } }
      : {},
  );
}
