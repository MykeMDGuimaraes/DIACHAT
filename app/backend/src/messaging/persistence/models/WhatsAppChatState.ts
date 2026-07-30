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

@Table({
  tableName: "WhatsAppChatStates",
  schema: "messaging",
  indexes: [
    {
      name: "whatsapp_chat_states_company_connection_jid_unique",
      unique: true,
      fields: ["companyId", "whatsappId", "jid"]
    }
  ]
})
class WhatsAppChatState extends Model<WhatsAppChatState> {
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
  @Column(DataType.STRING(191))
  jid: string;

  @Column(DataType.STRING(191))
  lid: string;

  @Default(false)
  @AllowNull(false)
  @Column(DataType.BOOLEAN)
  isGroup: boolean;

  @Default(false)
  @AllowNull(false)
  @Column(DataType.BOOLEAN)
  archived: boolean;

  @Default(false)
  @AllowNull(false)
  @Column(DataType.BOOLEAN)
  pinned: boolean;

  @Column(DataType.DATE)
  mutedUntil: Date;

  @Default(0)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  unreadCount: number;

  @Column(DataType.STRING)
  lastMessageId: string;

  @Column(DataType.DATE)
  lastMessageAt: Date;

  @Column(DataType.TEXT)
  lastMessagePreview: string;

  @Default(0)
  @AllowNull(false)
  @Column(DataType.BIGINT)
  revision: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default WhatsAppChatState;
