import { EventEmitter } from "events";
import https from "https";
import { classifyMetaSendError } from "../MetaCloudMessageCommandProvider";
import {
  HttpsMetaGraphTransport,
  MetaGraphTransportError
} from "../MetaGraphApiClient";

type FakeSocket = EventEmitter & { connecting: boolean };

const buildFakeRequest = () => {
  const request = new EventEmitter() as EventEmitter & {
    setTimeout: (ms: number, handler: () => void) => void;
    destroy: (error: Error) => void;
    write: jest.Mock;
    end: jest.Mock;
    timeoutHandler?: () => void;
  };
  request.setTimeout = (_ms: number, handler: () => void) => {
    request.timeoutHandler = handler;
  };
  request.destroy = (error: Error) => {
    request.emit("error", error);
  };
  request.write = jest.fn();
  request.end = jest.fn();
  return request;
};

const startRequest = () => {
  const fakeRequest = buildFakeRequest();
  jest
    .spyOn(https, "request")
    .mockImplementation((() => fakeRequest) as unknown as typeof https.request);
  const transport = new HttpsMetaGraphTransport("https://graph.facebook.com");
  const pending = transport.request({
    method: "POST",
    path: "/v23.0/phone/messages",
    accessToken: "token",
    body: { text: "oi" }
  });
  pending.catch(() => undefined);
  return { fakeRequest, pending };
};

describe("HttpsMetaGraphTransport phase detection", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("treats failures before the TLS connect as before_transmission (retryable)", async () => {
    const { fakeRequest, pending } = startRequest();
    const socket = new EventEmitter() as FakeSocket;
    socket.connecting = true;
    fakeRequest.emit("socket", socket);

    const dnsError = new Error(
      "getaddrinfo ENOTFOUND"
    ) as NodeJS.ErrnoException;
    dnsError.code = "ENOTFOUND";
    fakeRequest.emit("error", dnsError);

    const error = (await pending.then(
      () => null,
      caught => caught
    )) as MetaGraphTransportError;
    expect(error.phase).toBe("before_transmission");
    expect(classifyMetaSendError(error).classification).toBe("retryable");
  });

  it("treats timeout after the TLS connect as after_transmission (unknown, nunca retry)", async () => {
    const { fakeRequest, pending } = startRequest();
    const socket = new EventEmitter() as FakeSocket;
    socket.connecting = true;
    fakeRequest.emit("socket", socket);
    socket.emit("secureConnect");

    fakeRequest.timeoutHandler!();

    const error = (await pending.then(
      () => null,
      caught => caught
    )) as MetaGraphTransportError;
    expect(error.phase).toBe("after_transmission");
    expect(classifyMetaSendError(error).classification).toBe("unknown");
  });

  it("treats connection reset after connect as after_transmission (unknown)", async () => {
    const { fakeRequest, pending } = startRequest();
    const socket = new EventEmitter() as FakeSocket;
    socket.connecting = false; // socket keep-alive ja conectado
    fakeRequest.emit("socket", socket);

    const resetError = new Error("read ECONNRESET") as NodeJS.ErrnoException;
    resetError.code = "ECONNRESET";
    fakeRequest.emit("error", resetError);

    const error = (await pending.then(
      () => null,
      caught => caught
    )) as MetaGraphTransportError;
    expect(error.phase).toBe("after_transmission");
    expect(classifyMetaSendError(error).classification).toBe("unknown");
  });
});
