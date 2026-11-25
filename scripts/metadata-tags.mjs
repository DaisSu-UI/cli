import ts from "typescript";
export function metadataTags(symbol, checker) {
  const tags = symbol?.getJsDocTags(checker) || [];
  const text = (name) =>
    tags
      .filter((tag) => tag.name === name)
      .map((tag) => ts.displayPartsToString(tag.text || []).trim())
      .filter(Boolean)
      .join(" ");
  const deprecated = tags.some((tag) => tag.name === "deprecated");
  return {
    ...(text("since") ? { since: text("since") } : {}),
    ...(deprecated
      ? {
          deprecated: true,
          ...(text("deprecated")
            ? { deprecationMessage: text("deprecated") }
            : {}),
        }
      : {}),
    ...(text("replacement") ? { replacement: text("replacement") } : {}),
  };
}
