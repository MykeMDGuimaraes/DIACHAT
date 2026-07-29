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

@Table({ tableName: "ConversationAutomationStates", schema: "messaging" })
class ConversationAutomationState extends Model<ConversationAutomationState> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  companyId: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  externalTicketId: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  conversationId: string;

  @Default(0)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  automationEpoch: number;

  @Default("automation")
  @AllowNull(false)
  @Column(DataType.STRING)
  state: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ConversationAutomationState;
