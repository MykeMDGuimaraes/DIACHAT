import {
  Table,
  Column,
  CreatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
  DataType,
  AllowNull,
  Default
} from "sequelize-typescript";
import Company from "./Company";

@Table({ tableName: "AuditLogs", updatedAt: false })
class AuditLog extends Model<AuditLog> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id: number;

  @ForeignKey(() => Company)
  @AllowNull(true)
  @Column
  companyId: number | null;

  @BelongsTo(() => Company)
  company: Company;

  @AllowNull(false)
  @Column
  actorType: string;

  @AllowNull(true)
  @Column
  actorId: string | null;

  @AllowNull(false)
  @Column
  action: string;

  @AllowNull(true)
  @Column
  targetType: string | null;

  @AllowNull(true)
  @Column
  targetId: string | null;

  @AllowNull(false)
  @Default("success")
  @Column
  outcome: string;

  @AllowNull(true)
  @Column
  ip: string | null;

  @AllowNull(true)
  @Column(DataType.JSONB)
  metadata: Record<string, unknown> | null;

  @CreatedAt
  createdAt: Date;
}

export default AuditLog;
