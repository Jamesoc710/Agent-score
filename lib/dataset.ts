// Which slice of the append-only result tables this deployment publishes.
//
// Both result tables are keyed by batch_label, so a smoke run and a published run coexist
// without polluting each other. Bump ACTIVE_BATCH deliberately: per docs/METHODOLOGY.md a
// changed agent loop forks the dataset (new agent_id or batch), it is never amended in place.

export const ACTIVE_BATCH = process.env.ACTIVE_BATCH ?? "dev";

// The headline agent of the v1 panel: the lite tier is what production agent traffic
// actually runs, and its failures are the discriminative signal. gemini-3.6-flash runs
// the identical loop as a second agent_id; select it here (or via env) to publish it.
export const ACTIVE_AGENT_ID = process.env.ACTIVE_AGENT_ID ?? "gemini-3.5-flash-lite";
