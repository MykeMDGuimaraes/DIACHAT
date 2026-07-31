import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from "sequelize-typescript";
@Table({ tableName: "MessageTemplates", schema: "messaging", indexes: [{ unique: true, fields: ["companyId", "publicId"] }] })
class MessageTemplate extends Model<MessageTemplate> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID) id: string;
  @AllowNull(false) @Column(DataType.INTEGER) companyId: number;
  @AllowNull(false) @Column(DataType.UUID) publicId: string;
  @AllowNull(false) @Column(DataType.STRING(120)) name: string;
  @AllowNull(false) @Column(DataType.TEXT) content: string;
  @AllowNull(false) @Default([]) @Column(DataType.JSONB) variables: Array<{ name: string; required?: boolean; defaultValue?: string }>;
  @AllowNull(false) @Default(1) @Column(DataType.INTEGER) version: number;
  @AllowNull(false) @Default(true) @Column(DataType.BOOLEAN) active: boolean;
  @Column(DataType.INTEGER) createdBy: number;
  @CreatedAt createdAt: Date; @UpdatedAt updatedAt: Date;
}
export default MessageTemplate;
