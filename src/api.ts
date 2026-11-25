export {
  availableVersions,
  loadKnowledge,
  findComponent,
  queryKnowledge,
  listComponents,
  searchDocuments,
  detectLibraryVersion,
} from "./knowledge.js";
export {
  analyzeProject,
  usageProject,
  lintProject,
  doctorProject,
} from "./scanner.js";
export { createMcpServer, serveMcp } from "./mcp.js";
export {
  clientList,
  onboardingPlan,
  detectedClientList,
  applyOnboarding,
  onboardingStatus,
  onboardingDoctor,
  onboardingPrint,
} from "./onboarding.js";
export { createCliProgram } from "./app.js";
export type * from "./types.js";
export type { AgentOptions } from "./onboarding.js";

export { detectClients, resolveClients } from "./detection.js";
export { verifyClientRegistration } from "./registration.js";

export { checkDataDirectory, validateKnowledge } from "./data-validation.js";
export { updateStatus } from "./updates.js";

export { exportSiteDocs, renderSiteDocs } from "./site-docs.js";
