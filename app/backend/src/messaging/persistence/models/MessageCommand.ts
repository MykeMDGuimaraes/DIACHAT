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

@Table({ tableName: "MessageCommands", schema: "messaging" })
class MessageCommand extends Model<MessageCommand> {
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
  messageKind: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  recipient: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  idempotencyScope: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  idempotencyKey: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  requestFingerprint: string;

  @Default("queued")
  @AllowNull(false)
  @Column(DataType.STRING)
  status: string;

  @Default(0)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  attemptCount: number;

  @Column(DataType.DATE)
  leaseExpiresAt: Date;

  @Column(DataType.UUID)
  leaseToken: string;

  @Column(DataType.STRING)
  messageId: string;

  @Column(DataType.STRING)
  providerMessageId: string;

  @Column(DataType.STRING)
  errorCode: string;

  @Column(DataType.JSONB)
  errorDetails: Record<string, unknown>;

  @AllowNull(false)
  @Column(DataType.JSONB)
  requestPayload: Record<string, unknown>;

  @Column(DataType.DATE)
  completedAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default MessageCommand;
