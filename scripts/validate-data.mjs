import { fileURLToPath } from "node:url";
import { checkDataDirectory } from "../dist/data-validation.js";
const result = checkDataDirectory(
  fileURLToPath(new URL("../data", import.meta.url)),
);
console.log(
  `PASS: ${result.versions.length} 份知识快照，latest=${result.latest}，结构与摘要校验通过。`,
);
