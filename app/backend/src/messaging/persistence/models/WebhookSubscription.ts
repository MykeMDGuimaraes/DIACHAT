import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from "sequelize-typescript";

@Table({ tableName: "WebhookSubscriptions", schema: "messaging" })
class WebhookSubscription extends Model<WebhookSubscription> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID) id: string;
  @AllowNull(false) @Column(DataType.INTEGER) companyId: number;
  @AllowNull(false) @Column(DataType.STRING) name: string;
  @AllowNull(false) @Column(DataType.TEXT) url: string;
  @Default(true) @AllowNull(false) @Column(DataType.BOOLEAN) enabled: boolean;
  @AllowNull(false) @Column(DataType.JSONB) events: string[];
  @Default([]) @AllowNull(false) @Column(DataType.JSONB) connectionIds: number[];
  @Default([]) @AllowNull(false) @Column(DataType.JSONB) messageKinds: string[];
  @Default(false) @AllowNull(false) @Column(DataType.BOOLEAN) includeApiOrigin: boolean;
  @AllowNull(false) @Column(DataType.TEXT) secretCiphertext: string;
  @AllowNull(false) @Column(DataType.STRING) keyVersion: string;
  @Default(0) @AllowNull(false) @Column(DataType.INTEGER) consecutiveFailures: number;
  @Column(DataType.DATE) pausedAt: Date;
  @Column(DataType.DATE) lastSuccessAt: Date;
  @Column(DataType.DATE) lastFailureAt: Date;
  @CreatedAt createdAt: Date;
  @UpdatedAt updatedAt: Date;
}

export default WebhookSubscription;
