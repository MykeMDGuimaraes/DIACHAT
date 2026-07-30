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

@Table({ tableName: "ConversationCommands", schema: "messaging" })
class ConversationCommand extends Model<ConversationCommand> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  companyId: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  conversationId: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  externalTicketId: string;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  automationEpoch: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  action: string;

  @Column(DataType.STRING)
  queueId: string;

  @Column(DataType.STRING)
  userId: string;

  @Default(false)
  @AllowNull(false)
  @Column(DataType.BOOLEAN)
  sendNativeSurvey: boolean;

  @AllowNull(false)
  @Column(DataType.STRING)
  idempotencyScope: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  idempotencyKey: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  requestFingerprint: string;

  @AllowNull(false)
  @Column(DataType.JSONB)
  requestPayload: Record<string, unknown>;

  @Column(DataType.JSONB)
  responseSnapshot: Record<string, unknown>;

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
  errorCode: string;

  @Column(DataType.JSONB)
  errorDetails: Record<string, unknown>;

  @Column(DataType.DATE)
  completedAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ConversationCommand;
