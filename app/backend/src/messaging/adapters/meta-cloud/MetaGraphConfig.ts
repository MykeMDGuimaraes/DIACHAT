export interface MetaGraphConfig {
  graphVersion: string;
  apiBaseUrl: string;
}

export const loadMetaGraphConfig = (
  environment: Record<string, string | undefined> = process.env
): MetaGraphConfig => {
  const graphVersion = environment.META_GRAPH_VERSION;
  if (!graphVersion || !/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error("META_GRAPH_VERSION invÃ¡lida");
  }

  return { graphVersion, apiBaseUrl: "https://graph.facebook.com" };
};
