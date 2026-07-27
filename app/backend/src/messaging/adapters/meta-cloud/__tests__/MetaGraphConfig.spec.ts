import { loadMetaGraphConfig } from "../MetaGraphConfig";

describe("loadMetaGraphConfig", () => {
  it("loads an explicit Graph API version", () => {
    expect(loadMetaGraphConfig({ META_GRAPH_VERSION: "v23.0" })).toEqual({
      graphVersion: "v23.0",
      apiBaseUrl: "https://graph.facebook.com"
    });
  });

  it("rejects a missing or moving Graph API version", () => {
    expect(() => loadMetaGraphConfig({})).toThrow(
      "META_GRAPH_VERSION inválida"
    );
    expect(() => loadMetaGraphConfig({ META_GRAPH_VERSION: "latest" })).toThrow(
      "META_GRAPH_VERSION inválida"
    );
  });
});
