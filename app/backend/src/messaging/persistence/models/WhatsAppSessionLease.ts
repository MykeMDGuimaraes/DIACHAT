import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AllowNull
} from "sequelize-typescript";

@Table({ tableName: "WhatsAppSessionLeases", schema: "messaging" })
class WhatsAppSessionLease extends Model<WhatsAppSessionLease> {
  @PrimaryKey
  @Column(DataType.INTEGER)
  whatsappId: number;

  @AllowNull(false)
  @Column(DataType.UUID)
  ownerId: string;

  // BIGINT mapeado como string para nao perder precisao acima de 2^53.
  @AllowNull(false)
  @Column(DataType.BIGINT)
  fencingToken: string;

  @AllowNull(false)
  @Column(DataType.DATE)
  expiresAt: Date;

  @AllowNull(false)
  @Column(DataType.DATE)
  heartbeatAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default WhatsAppSessionLease;
