#!/usr/bin/env node
import { createCliProgram } from "./app.js";
try {
  await createCliProgram().parseAsync(process.argv);
} catch (error) {
  process.stderr.write(
    `daisu: ${error instanceof Error ? error.message : "操作失败"}\n`,
  );
  process.exitCode = 1;
}
