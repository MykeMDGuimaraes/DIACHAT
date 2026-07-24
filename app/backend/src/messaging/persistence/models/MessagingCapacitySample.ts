import {
  AllowNull,
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table
} from "sequelize-typescript";

@Table({
  tableName: "MessagingCapacitySamples",
  schema: "messaging",
  updatedAt: false
})
class MessagingCapacitySample extends Model<MessagingCapacitySample> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  companyId: number;

  @AllowNull(false)
  @Column(DataType.UUID)
  runId: string;

  @Default("ready")
  @AllowNull(false)
  @Column(DataType.STRING)
  status: string;

  @Column(DataType.DATE)
  observedAt: Date;

  @CreatedAt
  createdAt: Date;
}

export default MessagingCapacitySample;
