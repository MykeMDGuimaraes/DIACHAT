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

@Table({ tableName: "MetaCloudCredentials", schema: "messaging" })
class MetaCloudCredential extends Model<MetaCloudCredential> {
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
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  publicId: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  appId: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  wabaId: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  phoneNumberId: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  accessTokenCiphertext: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  appSecretCiphertext: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  verifyTokenHash: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  keyVersion: string;

  @Default("PENDING_WEBHOOK")
  @AllowNull(false)
  @Column(DataType.STRING)
  validationStatus: string;

  @Column(DataType.DATE)
  webhookVerifiedAt: Date;

  @Column(DataType.DATE)
  lastValidatedAt: Date;

  @Column(DataType.TEXT)
  lastError: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default MetaCloudCredential;
