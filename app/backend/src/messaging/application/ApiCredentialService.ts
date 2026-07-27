import { randomBytes } from "crypto";
import AppError from "../../errors/AppError";
import { hashApiKeySecret } from "../domain/PublicApiKey";
import ApiCredential from "../persistence/models/ApiCredential";
import Whatsapp from "../../models/Whatsapp";
import { Op } from "sequelize";

export interface IssueApiCredentialInput {
  companyId: number;
  name: string;
  scopes: string[];
  connectionIds: number[];
}

interface ApiCredentialRepository {
  create: (data: Record<string, unknown>) => Promise<any>;
  countConnections?: (companyId: number, ids: number[]) => Promise<number>;
}

const defaultRepository: ApiCredentialRepository = {
  create: data => ApiCredential.create(data as any),
  countConnections: (companyId, ids) =>
    Whatsapp.count({ where: { companyId, id: { [Op.in]: ids } } })
};

const createTokenPart = (): string => randomBytes(24).toString("hex");

class ApiCredentialService {
  constructor(
    private readonly repository = defaultRepository,
    private readonly getPepper = () => process.env.API_KEY_PEPPER || "",
    private readonly tokenPart = createTokenPart
  ) {}

  async issue(input: IssueApiCredentialInput): Promise<{ credential: any; apiKey: string }> {
    const pepper = this.getPepper();
    if (!pepper) {
      throw new AppError("API_KEY_PEPPER nao configurado", 500);
    }
    const connectionIds = [...new Set(input.connectionIds || [])];
    const allowedScopes = new Set(["messages:write"]);
    if (
      !input.name.trim() ||
      input.scopes.length === 0 ||
      input.scopes.some(scope => !allowedScopes.has(scope)) ||
      connectionIds.length === 0 ||
      connectionIds.some(id => !Number.isInteger(id) || id <= 0)
    ) {
      throw new AppError("Nome e ao menos um escopo sao obrigatorios", 400);
    }
    if (
      this.repository.countConnections &&
      await this.repository.countConnections(input.companyId, connectionIds) !==
        connectionIds.length
    ) {
      throw new AppError("Uma ou mais conexoes nao pertencem a empresa", 403);
    }

    const tokenId = this.tokenPart();
    const secret = this.tokenPart();
    const credential = await this.repository.create({
      companyId: input.companyId,
      name: input.name.trim(),
      tokenId,
      secretHash: hashApiKeySecret(secret, pepper),
      scopes: input.scopes,
      connectionIds
    });

    return { credential, apiKey: `dch_live_${tokenId}.${secret}` };
  }
}

export default ApiCredentialService;
