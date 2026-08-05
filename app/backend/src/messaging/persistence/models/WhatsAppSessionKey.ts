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

@Table({ tableName: "WhatsAppSessionKeys", schema: "messaging" })
class WhatsAppSessionKey extends Model<WhatsAppSessionKey> {
  @PrimaryKey
  @Column(DataType.INTEGER)
  whatsappId: number;

  @PrimaryKey
  @Column(DataType.STRING)
  keyType: string;

  @PrimaryKey
  @Column(DataType.TEXT)
  keyId: string;

  // Payload cifrado (AES-256-GCM via MessagingSecretCipher): nunca JSON em
  // claro. Formato keyId.iv.tag.ciphertext do keyring de mensageria.
  @AllowNull(false)
  @Column(DataType.TEXT)
  ciphertext: string;

  // Fencing (BIGINT como string para nao perder precisao acima de 2^53):
  // (generation, revision) monotonicos; escrita vencida nao sobrescreve.
  @AllowNull(false)
  @Column(DataType.BIGINT)
  revision: string;

  @AllowNull(false)
  @Column(DataType.BIGINT)
  generation: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default WhatsAppSessionKey;
