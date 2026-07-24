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

@Table({ tableName: "ApiCredentials", schema: "messaging" })
class ApiCredential extends Model<ApiCredential> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  companyId: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  name: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  tokenId: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  secretHash: string;

  @Default([])
  @AllowNull(false)
  @Column(DataType.JSONB)
  scopes: string[];

  @Default([])
  @AllowNull(false)
  @Column(DataType.JSONB)
  connectionIds: number[];

  @Column(DataType.DATE)
  revokedAt: Date;

  @Column(DataType.DATE)
  lastUsedAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ApiCredential;
