import WhatsAppSessionLease from "../models/WhatsAppSessionLease";
import {
  acquireSessionLease,
  renewSessionLease,
  releaseSessionLease
} from "../WhatsAppSessionLeaseRepository";

jest.mock("../models/WhatsAppSessionLease", () => ({
  __esModule: true,
  default: { sequelize: { query: jest.fn() } }
}));

const mockQuery = WhatsAppSessionLease.sequelize.query as jest.Mock;

describe("WhatsAppSessionLeaseRepository", () => {
  describe("acquireSessionLease", () => {
    it("acquires atomically with INSERT ... ON CONFLICT and returns the lease", async () => {
      mockQuery.mockResolvedValueOnce([
        {
          whatsappId: 7,
          ownerId: "owner-a",
          fencingToken: "3",
          expiresAt: new Date(),
          heartbeatAt: new Date()
        }
      ]);

      const lease = await acquireSessionLease({
        whatsappId: 7,
        ownerId: "owner-a",
        ttlMs: 30000
      });

      const [sql, options] = mockQuery.mock.calls[0];
      expect(sql).toContain("ON CONFLICT");
      expect(sql).toContain('WHERE messaging."WhatsAppSessionLeases"');
      expect(sql).toContain('"expiresAt" < NOW()');
      expect(options.replacements).toMatchObject({
        whatsappId: 7,
        ownerId: "owner-a",
        ttlMs: 30000
      });
      expect(lease).toMatchObject({
        whatsappId: 7,
        ownerId: "owner-a",
        fencingToken: "3"
      });
    });

    it("returns null when another owner holds a valid lease (fail closed)", async () => {
      mockQuery.mockResolvedValueOnce([]);

      const lease = await acquireSessionLease({
        whatsappId: 7,
        ownerId: "owner-b",
        ttlMs: 30000
      });

      expect(lease).toBeNull();
    });

    it("always increments the fencing token on conflict acquire (monotonic generations)", async () => {
      mockQuery.mockResolvedValueOnce([
        {
          whatsappId: 7,
          ownerId: "owner-a",
          fencingToken: "4",
          expiresAt: new Date(),
          heartbeatAt: new Date()
        }
      ]);

      await acquireSessionLease({
        whatsappId: 7,
        ownerId: "owner-a",
        ttlMs: 30000
      });

      const [sql, options] = mockQuery.mock.calls[0];
      expect(sql).toContain('"fencingToken" + 1');
      expect(options.replacements).not.toHaveProperty("bump");
    });
  });

  describe("renewSessionLease", () => {
    it("renews only when ownerId and fencingToken still match", async () => {
      mockQuery.mockResolvedValueOnce([{ whatsappId: 7 }]);

      const renewed = await renewSessionLease({
        whatsappId: 7,
        ownerId: "owner-a",
        fencingToken: "3",
        ttlMs: 30000
      });

      const [sql, options] = mockQuery.mock.calls[0];
      expect(sql).toContain('"fencingToken" = :fencingToken');
      expect(sql).toContain('"ownerId" = :ownerId');
      expect(options.replacements.fencingToken).toBe("3");
      expect(renewed).toBe(true);
    });

    it("returns false after a takeover (stale token)", async () => {
      mockQuery.mockResolvedValueOnce([]);

      const renewed = await renewSessionLease({
        whatsappId: 7,
        ownerId: "owner-a",
        fencingToken: "3",
        ttlMs: 30000
      });

      expect(renewed).toBe(false);
    });
  });

  describe("releaseSessionLease", () => {
    it("expires the row without deleting it (preserves token lineage)", async () => {
      mockQuery.mockResolvedValueOnce([{ whatsappId: 7 }]);

      const released = await releaseSessionLease({
        whatsappId: 7,
        ownerId: "owner-a",
        fencingToken: "3"
      });

      const [sql, options] = mockQuery.mock.calls[0];
      expect(sql).toContain("UPDATE");
      expect(sql).not.toContain("DELETE");
      expect(sql).toContain("interval '1 millisecond'");
      expect(sql).toContain('"fencingToken" = :fencingToken');
      expect(options.replacements).toMatchObject({
        whatsappId: 7,
        ownerId: "owner-a",
        fencingToken: "3"
      });
      expect(released).toBe(true);
    });

    it("does not expire a successor lease (stale owner/token)", async () => {
      mockQuery.mockResolvedValueOnce([]);

      const released = await releaseSessionLease({
        whatsappId: 7,
        ownerId: "owner-a",
        fencingToken: "1"
      });

      expect(released).toBe(false);
    });
  });
});
