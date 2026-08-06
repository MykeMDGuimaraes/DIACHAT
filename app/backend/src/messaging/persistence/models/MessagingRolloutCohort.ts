import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull
} from "sequelize-typescript";

// Coorte de rollout por empresa (Hardening T9): uma row por (capability,
// companyId). capability='auth_store' guarda o modo de armazenamento do
// auth-state daquela empresa (json | dual_write | postgres); sem row vale o
// default global (env MESSAGING_AUTH_STORE_MODE).
@Table({ tableName: "MessagingRolloutCohorts", schema: "messaging" })
class MessagingRolloutCohort extends Model<MessagingRolloutCohort> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  capability: string;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  companyId: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  mode: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default MessagingRolloutCohort;
