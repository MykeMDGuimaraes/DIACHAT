import { Readable } from "stream";

/**
 * Anti-SSRF (Task 4): o fetcher de midia remota e o UNICO caminho de URLs
 * externas para o dispatcher. Estes testes provam que alvos privados,
 * loopback, link-local e redirects maliciosos sao rejeitados ANTES de
 * qualquer fetch/conexao.
 */
const mockAxiosGet = jest.fn();
const mockLookup = jest.fn();
const mockStage = jest.fn();

jest.mock("axios", () => ({
  get: (url: string, options: unknown) => mockAxiosGet(url, options)
}));

jest.mock("dns", () => {
  const actual = jest.requireActual("dns");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      lookup: (...args: unknown[]) => mockLookup(...args)
    }
  };
});

jest.mock("../application/persistMessagingUpload", () => ({
  stageMessagingMedia: (sourcePath: string, originalName?: string) =>
    mockStage(sourcePath, originalName)
}));

// eslint-disable-next-line import/first
import { fetchRemoteMediaSecurely } from "../application/fetchRemoteMediaSecurely";

describe("fetchRemoteMediaSecurely (anti-SSRF)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ["nao-HTTPS", "http://cdn.example.com/x.pdf"],
    ["localhost", "https://localhost/x.pdf"],
    ["subdominio localhost", "https://evil.localhost/x.pdf"],
    ["host single-label (interno)", "https://intranet/x.pdf"],
    ["sufixo .internal", "https://files.corp.internal/x.pdf"],
    ["literal loopback", "https://127.0.0.1/x.pdf"],
    ["literal link-local (metadata cloud)", "https://169.254.169.254/latest"],
    ["literal RFC1918", "https://192.168.1.10/x.pdf"],
    ["literal CGNAT", "https://100.64.0.1/x.pdf"],
    ["literal IPv6 loopback", "https://[::1]/x.pdf"]
  ])("rejeita %s antes de qualquer fetch", async (_label, url) => {
    await expect(fetchRemoteMediaSecurely(url)).rejects.toMatchObject({
      message: expect.any(String)
    });
    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("rejeita host cujo DNS resolve para IP privado", async () => {
    mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

    await expect(
      fetchRemoteMediaSecurely("https://cdn.example.com/x.pdf")
    ).rejects.toMatchObject({ message: "Host de midia remota nao permitido" });
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it("rejeita quando QUALQUER endereco resolvido e privado (rebinding)", async () => {
    mockLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "172.16.0.9", family: 4 }
    ]);

    await expect(
      fetchRemoteMediaSecurely("https://cdn.example.com/x.pdf")
    ).rejects.toMatchObject({ message: "Host de midia remota nao permitido" });
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it("rejeita redirect para alvo privado", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mockAxiosGet.mockResolvedValue({
      status: 302,
      headers: { location: "https://169.254.169.254/latest/meta-data" },
      data: { destroy: jest.fn() }
    });

    await expect(
      fetchRemoteMediaSecurely("https://cdn.example.com/x.pdf")
    ).rejects.toMatchObject({ message: "Host de midia remota nao permitido" });
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });

  it("rejeita redirect com downgrade para HTTP", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mockAxiosGet.mockResolvedValue({
      status: 301,
      headers: { location: "http://files.example.com/x.pdf" },
      data: { destroy: jest.fn() }
    });

    await expect(
      fetchRemoteMediaSecurely("https://cdn.example.com/x.pdf")
    ).rejects.toMatchObject({
      message: "URL de midia remota deve ser HTTPS"
    });
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });

  it("rejeita cadeia de redirects acima do limite", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mockAxiosGet.mockImplementation((url: string) => {
      const next = url.replace(
        /x(\d*)\.pdf/,
        (_m, n) => `x${(n || 0) + 1}.pdf`
      );
      return Promise.resolve({
        status: 302,
        headers: { location: next },
        data: { destroy: jest.fn() }
      });
    });

    await expect(
      fetchRemoteMediaSecurely("https://cdn.example.com/x.pdf")
    ).rejects.toMatchObject({
      message: "URL de midia remota excedeu o limite de redirecionamentos"
    });
  });

  it("rejeita midia acima do tamanho maximo (content-length)", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mockAxiosGet.mockResolvedValue({
      status: 200,
      headers: { "content-length": String(65 * 1024 * 1024) },
      data: { destroy: jest.fn() }
    });

    await expect(
      fetchRemoteMediaSecurely("https://cdn.example.com/big.mp4")
    ).rejects.toMatchObject({
      message: "Midia remota excede o tamanho maximo"
    });
  });

  it("nao honra HTTP(S)_PROXY do ambiente (proxy burlaria o DNS pinado)", async () => {
    process.env.HTTP_PROXY = "http://127.0.0.1:8080";
    process.env.HTTPS_PROXY = "http://169.254.169.254:8080";
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mockAxiosGet.mockResolvedValue({
      status: 200,
      headers: { "content-length": "3" },
      data: Readable.from([Buffer.from("abc")])
    });
    mockStage.mockResolvedValue("messaging/staged-x.pdf");

    try {
      await fetchRemoteMediaSecurely("https://cdn.example.com/x.pdf");
    } finally {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
    }

    // A requisicao SAI com proxy desabilitado: a conexao usa o agente com
    // lookup pinado nos enderecos validados, nunca o proxy do ambiente.
    expect(mockAxiosGet).toHaveBeenCalledWith(
      "https://cdn.example.com/x.pdf",
      expect.objectContaining({ proxy: false })
    );
  });

  it("faz staging local de midia publica e retorna localPath", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mockAxiosGet.mockResolvedValue({
      status: 200,
      headers: { "content-length": "3" },
      data: Readable.from([Buffer.from("abc")])
    });
    mockStage.mockResolvedValue("messaging/staged-x.pdf");

    const localPath = await fetchRemoteMediaSecurely(
      "https://cdn.example.com/x.pdf"
    );

    expect(mockAxiosGet).toHaveBeenCalledWith(
      "https://cdn.example.com/x.pdf",
      expect.objectContaining({ maxRedirects: 0, responseType: "stream" })
    );
    expect(mockStage).toHaveBeenCalledWith(expect.any(String), "x.pdf");
    expect(localPath).toBe("messaging/staged-x.pdf");
  });
});
