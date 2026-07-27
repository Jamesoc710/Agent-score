// Which slice of the append-only result tables this deployment publishes.
//
// Both result tables are keyed by batch_label, so a smoke run and a published run coexist
// without polluting each other. Bump ACTIVE_BATCH deliberately: per docs/METHODOLOGY.md a
// changed agent loop forks the dataset (new agent_id or batch), it is never amended in place.

export const ACTIVE_BATCH = process.env.ACTIVE_BATCH ?? "dev";

export const ACTIVE_AGENT_ID = process.env.ACTIVE_AGENT_ID ?? "gemini-2.0-flash";
