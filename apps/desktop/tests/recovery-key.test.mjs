import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

test("new recovery keys are masked and blurred before explicit reveal", async () => {
  const result = await build({
    stdin: { contents: 'import { renderToStaticMarkup } from "react-dom/server"; import { RecoveryKeyDisplay } from "./src/components/RecoveryKeyDisplay"; export function render(value) { return renderToStaticMarkup(<RecoveryKeyDisplay value={value} />); }', loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(process.cwd() + '/package.json');" },
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const value = "AZLA-TEST-PRIVATE-KEY";
  const markup = module.render(value);
  assert.ok(!markup.includes(value));
  assert.ok(markup.includes("blur(5px)"));
  assert.ok(markup.includes('aria-expanded="false"'));
  assert.ok(markup.includes("Show recovery key"));
});
