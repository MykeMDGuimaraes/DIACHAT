import { Router } from "express";
import { live, ready } from "../controllers/HealthController";

const healthRoutes = Router();

healthRoutes.get("/health/live", live);
healthRoutes.get("/health/ready", ready);

export default healthRoutes;
