import test from "node:test";
import assert from "node:assert/strict";
import { searchDocuments, queryKnowledge } from "../dist/knowledge.js";
test("full-text search handles body text, AND terms, aliases, ranking, limits and invalid queries", () => {
  const component = (name, docPath, doc) => ({
    name,
    id: name.toLowerCase(),
    label: name,
    docPath,
    doc,
  });
  const data = {
    components: [
      component("Button", "button.md", "body press tap"),
      component("Col", "layout.md", "Column body press"),
      component("Row", "layout.md", "Column body press"),
    ],
    guides: { llms: { title: "Guide", content: "platform body press" } },
  };
  assert.equal(searchDocuments(data, "column")[0].id, "col");
  const results = searchDocuments(data, "body press");
  assert.equal(results.length, 3);
  assert.equal(results.find((item) => item.id === "col").components.length, 2);
  assert.equal(searchDocuments(data, "body press", 1).length, 1);
  assert.equal(searchDocuments(data, "body nonexistent").length, 0);
  for (const limit of [0, 21, 1.2, NaN])
    assert.throws(() => searchDocuments(data, "body", limit));
  assert.throws(() => searchDocuments(data, "   "));
  assert(
    queryKnowledge("search", ["onTap"], { version: "latest", limit: 3 }).results
      .length,
  );
});
