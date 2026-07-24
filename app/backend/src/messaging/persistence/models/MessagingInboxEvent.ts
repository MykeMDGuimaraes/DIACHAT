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

  @Column(DataType.TEXT)
  lastError: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default MessagingInboxEvent;
