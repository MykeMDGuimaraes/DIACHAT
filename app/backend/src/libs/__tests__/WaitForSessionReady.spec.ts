import waitForSessionReady from "../waitForSessionReady";
import AppError from "../../errors/AppError";

describe("waitForSessionReady", () => {
  it("returns immediately when the session is already ready", async () => {
    const session = { id: 1 };
    const result = await waitForSessionReady(() => session, 1000, 10);
    expect(result).toBe(session);
  });

  it("waits for the session to come back and then returns it", async () => {
    const session = { id: 1 };
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 60);

    const result = await waitForSessionReady(
      () => (ready ? session : undefined),
      2000,
      10
    );
    expect(result).toBe(session);
  });

  it("throws ERR_WAPP_NOT_AVAILABLE (503) when the window expires", async () => {
    const finder = jest.fn(() => undefined);

    await expect(waitForSessionReady(finder, 80, 10)).rejects.toMatchObject({
      message: "ERR_WAPP_NOT_AVAILABLE",
      statusCode: 503
    });
    expect(finder.mock.calls.length).toBeGreaterThan(1);

    try {
      await waitForSessionReady(finder, 20, 10);
      fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
    }
  });
});
