import express from "express";
import request from "supertest";
import healthRoutes from "../healthRoutes";

describe("healthRoutes", () => {
  it("exposes an unauthenticated liveness endpoint for the deployment platform", async () => {
    const app = express();
    app.use(healthRoutes);

    const response = await request(app).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "diachat-backend"
    });
  });
});
