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

@Table({ tableName: "MessagingInboxEvents", schema: "messaging" })
class MessagingInboxEvent extends Model<MessagingInboxEvent> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  companyId: number;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  whatsappId: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  provider: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  dedupeKey: string;

  @AllowNull(false)
  @Column(DataType.JSONB)
  payload: Record<string, unknown>;

  @Default("received")
  @AllowNull(false)
  @Column(DataType.STRING)
  status: string;

  @Column(DataType.DATE)
  processedAt: Date;

  @Default(0)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  attemptCount: number;

  @Column(DataType.DATE)
  leaseExpiresAt: Date;

  @Default(DataType.NOW)
  @AllowNull(false)
  @Column(DataType.DATE)
  availableAt: Date;

  @Column(DataType.TEXT)
  lastError: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default MessagingInboxEvent;
