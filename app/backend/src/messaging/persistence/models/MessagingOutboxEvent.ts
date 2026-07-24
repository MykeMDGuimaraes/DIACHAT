import {
  AllowNull,
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt
} from "sequelize-typescript";

@Table({ tableName: "MessagingOutboxEvents", schema: "messaging" })
class MessagingOutboxEvent extends Model<MessagingOutboxEvent> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  companyId: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  eventType: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  aggregateId: string;

  @AllowNull(false)
  @Column(DataType.JSONB)
  payload: Record<string, unknown>;

  @Default("ready")
  @AllowNull(false)
  @Column(DataType.STRING)
  status: string;

  @Default(0)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  attemptCount: number;

  @Default(DataType.NOW)
  @AllowNull(false)
  @Column(DataType.DATE)
  availableAt: Date;

  @Column(DataType.DATE)
  leaseExpiresAt: Date;

  @Column(DataType.TEXT)
  lastError: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default MessagingOutboxEvent;
