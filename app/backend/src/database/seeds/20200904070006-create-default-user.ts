import { QueryInterface } from "sequelize";
import { hash } from "bcryptjs";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.sequelize.transaction(async t => {
      // Idempotente: o start do repl roda os seeds a cada boot — sem a
      // guarda, a unique de Users.email derruba o pretest do npm test.
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM "Users" WHERE email = 'admin@admin.com' LIMIT 1`,
        { transaction: t }
      );
      if (existing.length > 0) {
        return null;
      }
      const passwordHash = await hash("123456", 8);
      return Promise.all([
        queryInterface.bulkInsert(
          "Users",
          [
            {
              name: "Admin",
              email: "admin@admin.com",
              profile: "admin",
              passwordHash,
              companyId: 1,
              createdAt: new Date(),
              updatedAt: new Date(),
              super: true
            }
          ],
          { transaction: t }
        )
      ]);
    });
  },

  down: async (queryInterface: QueryInterface) => {
    return queryInterface.bulkDelete("Users", {});
  }
};
