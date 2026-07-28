import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from "sequelize-typescript";

@Table({ tableName: "WebhookDeliveries", schema: "messaging" })
class WebhookDelivery extends Model<WebhookDelivery> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID) id: string;
  @AllowNull(false) @Column(DataType.UUID) subscriptionId: string;
  @AllowNull(false) @Column(DataType.INTEGER) companyId: number;
  @AllowNull(false) @Column(DataType.STRING) eventId: string;
  @AllowNull(false) @Column(DataType.STRING) eventType: string;
  @AllowNull(false) @Column(DataType.TEXT) urlSnapshot: string;
  @Default("POST") @AllowNull(false) @Column(DataType.STRING) methodSnapshot: string;
  @AllowNull(false) @Column(DataType.TEXT) secretCiphertextSnapshot: string;
  @AllowNull(false) @Column(DataType.STRING) keyVersion: string;
  @AllowNull(false) @Column(DataType.JSONB) payload: Record<string, unknown>;
  @Default("ready") @AllowNull(false) @Column(DataType.STRING) status: string;
  @Default(0) @AllowNull(false) @Column(DataType.INTEGER) attemptCount: number;
  @Default(DataType.NOW) @AllowNull(false) @Column(DataType.DATE) availableAt: Date;
  @Column(DataType.DATE) leaseExpiresAt: Date;
  @Column(DataType.INTEGER) responseStatus: number;
  @Column(DataType.TEXT) responseBody: string;
  @Column(DataType.TEXT) lastError: string;
  @Column(DataType.DATE) deliveredAt: Date;
  @CreatedAt createdAt: Date;
  @UpdatedAt updatedAt: Date;
}

export default WebhookDelivery;
